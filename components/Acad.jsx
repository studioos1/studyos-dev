import { useState, useEffect, Fragment } from "react";
import { iso, du } from "@/lib/time";
import { courseNameFor, findMatchingCourse, norm, prettyCourseCode } from "@/lib/courses";
import { computeTermStatuses, uid } from "@/lib/data";
import { calcGPA, letterFromPct } from "@/lib/grades";
import {
  estimateDifficulty,
  estimateStudyHours,
  computeEstimateFields,
  computePriorityScore,
  DIFFICULTY_BANDS,
} from "@/lib/planner";
import { CI } from "@/lib/api";
import { PDF } from "@/lib/pdf";
import { reclassifyMisplacedQuizzes } from "@/lib/syllabus";
import { DS, CC } from "@/lib/constants";
import {
  useConfirm,
  Sp,
  TableHead,
  GradeInput,
  DiffPill,
  HoursInput,
  InfoModal,
  SyncResultModal,
  ExtractionVerifyModal,
  DelBtn,
  DiffBadge,
  PdfDrop,
  DayPick,
} from "@/components/shared";

// ── ACADEMICS ────────────────────────────────────────────────────────────────
export function Acad({data,upd,ai,busy,planning,toast2,progress,setProgress,refreshQuarterPlan,planMsg}){
  const {confirm,modal}=useConfirm();
  const [view,setView]=useState("assignments");
  const [showDiffHelp,setShowDiffHelp]=useState(false);
  const [showAddAssign,setShowAddAssign]=useState(false);
  const [showAddExam,setShowAddExam]=useState(false);
  const [editId,setEditId]=useState(null);
  const [na,setNa]=useState({course:"",title:"",dueDate:"",estimatedHours:2,status:"not-started"});
  const [ed,setEd]=useState({course:"",title:"",dueDate:"",estimatedHours:2}); // separate edit state
  const [ne,setNe]=useState({course:"",date:"",topics:"",prepDays:7});
  const [editExamId,setEditExamId]=useState(null);
  const termStatuses=computeTermStatuses(data.terms,iso());
  const currentTerm=termStatuses.find(t=>t.status==="current")||null;
  // Which term Academics is showing/adding into — defaults to whichever term is current, but can
  // be switched (e.g. to Upcoming) to prep a future term's syllabus in advance, in isolation from
  // the current term's own courses. Re-defaults if the previously-viewed term no longer exists
  // (e.g. was the only term and got replaced by the legacy migration).
  const [viewingTermId,setViewingTermId]=useState(()=>currentTerm?.id||null);
  const [showTermSwitcher,setShowTermSwitcher]=useState(false);
  useEffect(()=>{
    if(!viewingTermId&&currentTerm)setViewingTermId(currentTerm.id);
  },[currentTerm?.id]); // eslint-disable-line
  const [ee,setEe]=useState({course:"",topics:"",date:"",prepDays:7});
  const [sylPdfs,setSylPdfs]=useState([]);
  const [syncing,setSyncing]=useState(false);
  const [syncResult,setSyncResult]=useState(null);
  const [pendingVerify,setPendingVerify]=useState(null); // {parsed, fileNames} — awaiting student confirmation before saving
  const [rawExtracting,setRawExtracting]=useState(false);
  const [rawExtractResult,setRawExtractResult]=useState(null);
  const [showManualClass,setShowManualClass]=useState(false);
  const [assignSort,setAssignSort]=useState("due"); // "class" | "due" | "weight" | "hours"
  const [examSort,setExamSort]=useState("due"); // "class" | "due" | "weight" | "prep"
  // Difficulty tab state — lifted up from the old modal so it persists across tab switches
  // within the session, and so the Save button can compare against a baseline to know if
  // anything's actually changed (dirty-tracking), same pattern as Settings' Save & Replan.
  const [diffRatings,setDiffRatings]=useState(null); // {itemKey: {estimatorValue, userValue, aiHours, userHours, kind, id, courseId, courseName, title, weight, dueDate}}
  const [diffComputing,setDiffComputing]=useState(true);
  const [diffSortBy,setDiffSortBy]=useState("due");
  const [diffBaseline,setDiffBaseline]=useState(null); // JSON snapshot of {userValue,userHours} at last load/save

  // Study Preferences table is grouped by class with foldable sections (Class column removed —
  // every row's class is implied by its group). Fold state is a transient viewing preference, not
  // account data: sessionStorage keeps it while switching between tabs in this session, but a
  // fresh visit (reload, new session) always starts fully expanded rather than risking a stale
  // folded state the student doesn't remember setting.
  const FOLD_KEY="studyos_difftab_folded";
  const [foldedClasses,setFoldedClasses]=useState(()=>{
    try{return new Set(JSON.parse(sessionStorage.getItem(FOLD_KEY)||"[]"));}catch{return new Set();}
  });
  function persistFolded(next){try{sessionStorage.setItem(FOLD_KEY,JSON.stringify([...next]));}catch{}}
  function toggleFold(courseId){
    setFoldedClasses(prev=>{
      const next=new Set(prev);
      if(next.has(courseId))next.delete(courseId);else next.add(courseId);
      persistFolded(next);
      return next;
    });
  }
  function setAllFolded(courseIds,folded){
    const next=folded?new Set(courseIds):new Set();
    persistFolded(next);
    setFoldedClasses(next);
  }

  // Computes Low/Mid/High + suggested hours for every active assignment/exam — but only for items
  // that have NEVER had an estimate computed at all (estimatorValue==null). As of this version,
  // that computation now happens once at item-CREATION time (syllabus sync, manual add — see
  // computeEstimateFields calls in finalizeSync/addAssignment/addExam), one of the agreed
  // replan/estimate triggers, not whenever this tab happens to be opened. The check here is
  // deliberately NOT based on reviewedAt (which only becomes true after the student clicks Save) —
  // using reviewedAt would mean every visit before the first Save still recomputes everything from
  // scratch. Checking estimatorValue directly means a genuinely-already-computed item is reused
  // instantly regardless of whether the student has reviewed/saved it yet.
  //
  // Items that predate this change (created before computeEstimateFields existed) still have no
  // stored estimate the first time this runs post-update. Rather than leaving those to recompute on
  // every single visit until the student happens to click Save, whatever gets freshly computed here
  // is immediately written back to data as a lightweight cache (estimatorValue/aiHours only — NOT
  // userValue/userHours/reviewedAt, which stay untouched until the student actually reviews the
  // item). This is a cache write, not a review — it just means "this is now a genuinely one-time
  // migration," not a recurring one.
  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      const next={};
      // Cache back to data when a value is newly computed OR the hours suggestion has drifted
      // (e.g. the estimator formula changed) — so the planner reads current numbers without
      // needing a Save. estimateStudyHours is a cheap sync lookup, so we always refresh it from
      // the item's EFFECTIVE rating (student override if any, else the AI rating); estimateDifficulty
      // (async, may hit the network later) still only runs for items that have never had a rating.
      const freshA={},freshE={};
      for(const a of data.assignments){
        if(a.status==="done")continue;
        const course=data.courses.find(c=>c.id===a.courseId);
        const key=`a_${a.id}`;
        let estimatorValue=a.estimatorValue;
        if(estimatorValue==null){
          estimatorValue=(await estimateDifficulty(a,course)).value;
        }
        const userValue=a.userValue||null;
        const aiHours=estimateStudyHours(a,course,"homework",userValue||estimatorValue);
        next[key]={kind:"assignment",type:a.type==="project"?"project":"homework",
          id:a.id,courseId:a.courseId,courseName:course?.name||"(unknown)",title:a.title,
          weight:a.weight,dueDate:a.dueDate,estimatorValue,userValue,aiHours,userHours:a.userHours??null};
        if(a.estimatorValue==null||aiHours!==a.aiHours)freshA[a.id]={estimatorValue,aiHours};
      }
      for(const e of data.exams){
        const course=data.courses.find(c=>c.id===e.courseId);
        const key=`e_${e.id}`;
        let estimatorValue=e.estimatorValue;
        if(estimatorValue==null){
          estimatorValue=(await estimateDifficulty(e,course)).value;
        }
        const userValue=e.userValue||null;
        const aiHours=estimateStudyHours(e,course,"exam",userValue||estimatorValue);
        next[key]={kind:"exam",id:e.id,courseId:e.courseId,courseName:course?.name||"(unknown)",title:e.title||"Exam",
          weight:e.weight,dueDate:e.date,estimatorValue,userValue,aiHours,userHours:e.userHours??null};
        if(e.estimatorValue==null||aiHours!==e.aiHours)freshE[e.id]={estimatorValue,aiHours};
      }
      if(!cancelled){
        setDiffRatings(next);
        setDiffComputing(false);
        setDiffBaseline(JSON.stringify(Object.fromEntries(Object.entries(next).map(([k,r])=>[k,{u:r.userValue,h:r.userHours}]))));
        if(Object.keys(freshA).length||Object.keys(freshE).length){
          upd({
            assignments:data.assignments.map(a=>freshA[a.id]?{...a,...freshA[a.id]}:a),
            exams:data.exams.map(e=>freshE[e.id]?{...e,...freshE[e.id]}:e),
          });
        }
      }
    })();
    return()=>{cancelled=true;};
  },[]);

  // Changing the difficulty band is a fresh statement that the current hours aren't right — so it
  // re-derives the suggestion (aiHours) AND drops any hours the student had typed, letting the new
  // (usually higher) suggestion become the demand the planner uses. They can still type a new
  // number afterward if they want more than the suggestion.
  function setDiffOverride(key,value){
    setDiffRatings(r=>{
      const row=r[key];
      const course=data.courses.find(c=>c.id===row.courseId);
      const aiHours=estimateStudyHours({weight:row.weight},course,row.kind==="exam"?"exam":"homework",value||row.estimatorValue);
      return{...r,[key]:{...row,userValue:value,aiHours,userHours:null}};
    });
  }
  // Receives an already-parsed number|null from HoursInput's commit (blur/Enter) — HoursInput
  // handles all typing/parsing/validation itself via its own local state, so this just stores
  // the final committed value. No per-keystroke involvement here at all.
  function setHoursOverride(key,value){
    setDiffRatings(r=>({...r,[key]:{...r[key],userHours:value}}));
  }
  // Homework ⇄ Project. This is a structural classification (it changes HOW the planner schedules
  // the item — projects get steady early work, not a last-few-days sprint), not a tunable estimate,
  // so it persists immediately rather than waiting for the Save button, and marks the plan stale.
  function setItemType(key,rawId,newType){
    setDiffRatings(r=>({...r,[key]:{...r[key],type:newType}}));
    upd({
      assignments:data.assignments.map(a=>a.id===rawId?{...a,type:newType==="project"?"project":undefined}:a),
      planStale:true,
    });
  }
  const diffDirty=diffRatings&&diffBaseline!==null&&JSON.stringify(Object.fromEntries(Object.entries(diffRatings).map(([k,r])=>[k,{u:r.userValue,h:r.userHours}])))!==diffBaseline;

  function saveDifficulty(){
    if(!diffRatings)return;
    const now=new Date().toISOString();
    const aUpdates={},eUpdates={};
    Object.values(diffRatings).forEach(r=>{
      const effectiveValue=r.userValue||r.estimatorValue;
      const effectiveHours=r.userHours??r.aiHours;
      const payload={estimatorValue:r.estimatorValue,userValue:r.userValue,effectiveValue,
        aiHours:r.aiHours,userHours:r.userHours,estimatedHours:effectiveHours,reviewedAt:now};
      if(r.kind==="assignment")aUpdates[r.id]=payload;else eUpdates[r.id]=payload;
    });
    upd({
      assignments:data.assignments.map(a=>aUpdates[a.id]?{...a,...aUpdates[a.id]}:a),
      exams:data.exams.map(e=>eUpdates[e.id]?{...e,...eUpdates[e.id]}:e),
      planStale:true,
    });
    setDiffBaseline(JSON.stringify(Object.fromEntries(Object.entries(diffRatings).map(([k,r])=>[k,{u:r.userValue,h:r.userHours}]))));
    toast2("Study preferences saved!");
  }

  async function saveDifficultyAndReplan(){
    saveDifficulty();
    await refreshQuarterPlan();
  }


  // Clears academic data only (courses/assignments/exams + cached briefing) — keeps profile, History, and all habit logs intact.
  async function resetAcademic(){
    const total=termCourses.length+termAssignments.length+termExams.length;
    if(total===0){toast2("Nothing academic to clear for this term — you're already starting fresh.");return;}
    const ok=await confirm(`Clear ${termCourses.length} course${termCourses.length!==1?"s":""}, ${termAssignments.length} assignment${termAssignments.length!==1?"s":""}, and ${termExams.length} exam${termExams.length!==1?"s":""} for this term only? Other terms, your profile, routine settings, History, and habit logs (gym/check-ins/focus sessions) will NOT be touched. This can't be undone.`);
    if(!ok)return;
    upd({
      courses:data.courses.filter(c=>!termCourseIds.has(c.id)),
      assignments:data.assignments.filter(a=>!termCourseIds.has(a.courseId)),
      exams:data.exams.filter(e=>!termCourseIds.has(e.courseId)),
      briefCache:null,briefDate:null,
    });
    toast2("This term's academic data cleared — other terms, profile, and history kept!");
  }
  const [ncCourse,setNcCourse]=useState({name:"",days:[],startTime:"09:00",endTime:"10:30",difficulty:5,weeklyHours:4,format:"in-person"});

  // Read-only, scoped to whichever term is being viewed — used for everything the student SEES
  // (lists, dropdowns, counts, GPA). Every save/delete operation below continues to use the full
  // data.courses/assignments/exams directly, since replacing those arrays with a term-filtered
  // subset would silently drop every other term's data on the next save.
  const termCourses=data.courses.filter(c=>c.termId===viewingTermId);
  const termCourseIds=new Set(termCourses.map(c=>c.id));
  const termAssignments=data.assignments.filter(a=>termCourseIds.has(a.courseId));
  const termExams=data.exams.filter(e=>termCourseIds.has(e.courseId));

  const missing=termAssignments.filter(a=>!a.dueDate&&a.status!=="done");
  function sortAssignments(list){
    return [...list].sort((a,b)=>{
      const an=courseNameFor(data.courses,a.courseId),bn=courseNameFor(data.courses,b.courseId);
      const ad=a.dueDate&&a.dueDate.length===10,bd=b.dueDate&&b.dueDate.length===10;
      if(assignSort==="class")return an.localeCompare(bn)||(ad?a.dueDate:"9999").localeCompare(bd?b.dueDate:"9999");
      if(assignSort==="weight")return(b.weight??-1)-(a.weight??-1);
      // "due" default
      if(!ad&&!bd)return 0;if(!ad)return 1;if(!bd)return -1;
      return new Date(a.dueDate)-new Date(b.dueDate);
    });
  }
  const active=sortAssignments(termAssignments.filter(a=>a.status!=="done"));
  const done=sortAssignments(termAssignments.filter(a=>a.status==="done"));
  const total=termAssignments.length;

  function startEdit(a){
    setEditId(a.id);
    const cn=courseNameFor(data.courses,a.courseId);
    setEd({course:cn!=="(unknown course)"?cn:"",title:a.title||"",dueDate:a.dueDate||"",estimatedHours:a.estimatedHours||2});
    setShowAddAssign(false); // close add form if open
  }
  function cancelEdit(){setEditId(null);setEd({course:"",title:"",dueDate:"",estimatedHours:2});}
  function saveEdit(){
    if(!ed.title||!ed.course)return;
    const course=findMatchingCourse(termCourses,ed.course);
    if(!course){toast2("Couldn't find that course",true);return;}
    upd({assignments:data.assignments.map(x=>x.id===editId?{...x,courseId:course.id,title:ed.title,dueDate:ed.dueDate,estimatedHours:ed.estimatedHours}:x)});
    cancelEdit();toast2("Saved!");
  }
  async function addAssignment(){
    if(!na.title||!na.course)return;
    const course=findMatchingCourse(termCourses,na.course);
    if(!course){toast2("Couldn't find that course",true);return;}
    const est=await computeEstimateFields({weight:null,dueDate:na.dueDate},course,"homework");
    upd({assignments:[...data.assignments,{id:uid(),courseId:course.id,title:na.title,dueDate:na.dueDate,weight:null,estimatedHours:na.estimatedHours,status:"not-started",...est,userHours:na.estimatedHours}]});
    setNa({course:"",title:"",dueDate:"",estimatedHours:2,status:"not-started"});
    setShowAddAssign(false);toast2("Assignment added!");
  }
  async function addExam(){
    if(!ne.course||!ne.date)return;
    const course=findMatchingCourse(termCourses,ne.course);
    if(!course){toast2("Couldn't find that course",true);return;}
    const est=await computeEstimateFields({weight:null,dueDate:ne.date},course,"exam");
    upd({exams:[...data.exams,{id:uid(),courseId:course.id,title:ne.title||"",date:ne.date,topics:ne.topics||"",weight:null,prepDays:ne.prepDays||7,status:"not-started",estimatedHours:est.aiHours,...est}]});
    setNe({course:"",date:"",topics:"",prepDays:7});
    setShowAddExam(false);toast2("Exam added!");
  }
  function startEditExam(e){
    setEditExamId(e.id);
    const cn=courseNameFor(data.courses,e.courseId);
    setEe({course:cn!=="(unknown course)"?cn:"",topics:e.topics||"",date:e.date||"",prepDays:e.prepDays||7});
    setShowAddExam(false);
  }
  function cancelEditExam(){setEditExamId(null);setEe({course:"",topics:"",date:"",prepDays:7});}
  function saveEditExam(){
    if(!ee.course||!ee.date)return;
    const course=findMatchingCourse(termCourses,ee.course);
    if(!course){toast2("Couldn't find that course",true);return;}
    upd({exams:data.exams.map(x=>x.id===editExamId?{...x,courseId:course.id,topics:ee.topics,date:ee.date,prepDays:ee.prepDays}:x)});
    cancelEditExam();toast2("Exam updated!");
  }

  // DIAGNOSTIC ONLY — calls the exact same AI prompt as syncSyl, but does NOT save, merge,
  // dedup, or create courses. Pure "what does the AI actually return right now" check, so we
  // can verify extraction accuracy in isolation from all the app's downstream logic.
  async function rawExtract(){
    if(!sylPdfs.length)return;setRawExtracting(true);setRawExtractResult(null);
    const fileNames=sylPdfs.map(f=>f.name);
    try{
      const texts=await Promise.all(sylPdfs.map(async f=>{const t=await PDF(f);return `\n=== ${f.name} ===\n${t.slice(0,16000)}`;}));
      const t=await ai("Parse updated syllabi. Return ONLY valid JSON. Be exhaustive — extract every single dated item, not a representative sample.",
        `Extract EVERY deadline for EVERY course in this document. Today: ${iso()}.

CRITICAL RULES:
1. Go through the syllabus week-by-week or item-by-item. Do NOT summarize or sample — extract EVERY dated assignment, lab, homework, problem set, quiz, and exam you see.
2. Courses commonly have 2-4 exams each (e.g. Midterm 1, Midterm 2, Final Exam) — these are SEPARATE exam entries, not one.
3. If a course lists 8 weekly problem sets, you must return 8 separate assignment entries, not 1.
4. Count the dated items in the source text before answering, and make sure your output has that many entries.
5. Also extract the grading weight (% of final grade) for each assignment/exam from the syllabus's grading breakdown section (e.g. "Midterm 1 25% | Midterm 2 25% | Final 30%"). If no weight is stated for an item, use null.
6. Use the exact course code as it appears in the syllabus (e.g. "DSC 10", "MATH 180A") for courseName — do not add descriptive titles or CRNs to it, so it matches consistently across separate extractions.
7. Also extract the class meeting schedule if stated (often in a "Format:" line, e.g. "Lecture: Mon/Wed/Fri, 10:00–10:50 AM, Center Hall 101"). Return days as an array of 0-6 (0=Sunday, 1=Monday, ... 6=Saturday), and times in 24-hour HH:MM format. If a discussion/lab section is also listed, include it as a second entry in meetingTimes. If no meeting schedule is stated anywhere in the syllabus, return an empty meetingTimes array — do not guess or invent one.
8. The "exams" list is ONLY for Midterm(s) and the Final Exam — items with those exact words (or unambiguous synonyms like "Midterm Exam", "Final") in their title. Weekly reading quizzes, in-class pop quizzes, lecture quizzes, and any other small recurring "Quiz" item belong in "assignments", NEVER in "exams" — even though they are graded and have a due date. When in doubt whether something is a quiz or a midterm, it is a quiz — put it in assignments.

Example of a CORRECT response shape for a course with 8 weekly assignments and 3 exams (yours should look like this in structure, with real data from the syllabus):
{"courses":[{"courseName":"DSC 10","meetingTimes":[
  {"days":[1,3,5],"startTime":"10:00","endTime":"10:50","location":"Center Hall 101","type":"Lecture"},
  {"days":[2],"startTime":"17:00","endTime":"17:50","location":"York Hall 2622","type":"Discussion Section"}
],"assignments":[
  {"title":"Problem Set 1","dueDate":"2026-09-25","estimatedHours":2,"weight":3},
  {"title":"Reading Quiz 1","dueDate":"2026-09-28","estimatedHours":0.5,"weight":2},
  {"title":"Problem Set 2","dueDate":"2026-10-02","estimatedHours":2,"weight":3},
  {"title":"Problem Set 3","dueDate":"2026-10-09","estimatedHours":2,"weight":3},
  {"title":"Problem Set 4","dueDate":"2026-10-16","estimatedHours":2,"weight":3},
  {"title":"Problem Set 5","dueDate":"2026-10-30","estimatedHours":2,"weight":3},
  {"title":"Problem Set 6","dueDate":"2026-11-06","estimatedHours":2,"weight":3},
  {"title":"Problem Set 7","dueDate":"2026-11-13","estimatedHours":2,"weight":3},
  {"title":"Problem Set 8","dueDate":"2026-12-04","estimatedHours":2,"weight":3}
],"exams":[
  {"title":"Midterm 1","date":"2026-10-23","topics":"Ch 1-3","prepDays":5,"weight":25},
  {"title":"Midterm 2","date":"2026-11-20","topics":"Ch 4-6","prepDays":5,"weight":25},
  {"title":"Final Exam","date":"2026-12-09","topics":"All chapters","prepDays":7,"weight":30}
]}]}

Now extract the real data from the syllabi below, following that same exhaustive pattern for EACH course found:
SYLLABI:\n${texts.join("\n")}`,8000,{model:"claude-opus-5"});
      if(t){
        const p=JSON.parse(t.replace(/```json|```/g,"").trim());
        setRawExtractResult({parsed:p,fileNames});
      }
    }catch(e){setRawExtractResult({error:e.message,fileNames});}
    setRawExtracting(false);
  }

  async function syncSyl(){
    if(!sylPdfs.length)return;setSyncing(true);
    const fileNames=sylPdfs.map(f=>f.name);
    setProgress?.({label:"Reading PDF...",detail:fileNames.join(", ")});
    try{
      const texts=await Promise.all(sylPdfs.map(async f=>{const t=await PDF(f);return `\n=== ${f.name} ===\n${t.slice(0,16000)}`;}));
      setProgress?.({label:"Extracting syllabus with AI (classes, assignments & exams)...",detail:fileNames.join(", ")});
      const t=await ai("Parse updated syllabi. Return ONLY valid JSON. Be exhaustive — extract every single dated item, not a representative sample.",
        `Extract EVERY deadline for EVERY course in this document. Today: ${iso()}.

CRITICAL RULES:
1. Go through the syllabus week-by-week or item-by-item. Do NOT summarize or sample — extract EVERY dated assignment, lab, homework, problem set, quiz, and exam you see.
2. Courses commonly have 2-4 exams each (e.g. Midterm 1, Midterm 2, Final Exam) — these are SEPARATE exam entries, not one.
3. If a course lists 8 weekly problem sets, you must return 8 separate assignment entries, not 1.
4. Count the dated items in the source text before answering, and make sure your output has that many entries.
5. Also extract the grading weight (% of final grade) for each assignment/exam from the syllabus's grading breakdown section (e.g. "Midterm 1 25% | Midterm 2 25% | Final 30%"). If no weight is stated for an item, use null.
6. Use the exact course code as it appears in the syllabus (e.g. "DSC 10", "MATH 180A") for courseName — do not add descriptive titles or CRNs to it, so it matches consistently across separate extractions.
7. Also extract the class meeting schedule if stated (often in a "Format:" line, e.g. "Lecture: Mon/Wed/Fri, 10:00–10:50 AM, Center Hall 101"). Return days as an array of 0-6 (0=Sunday, 1=Monday, ... 6=Saturday), and times in 24-hour HH:MM format. If a discussion/lab section is also listed, include it as a second entry in meetingTimes. If no meeting schedule is stated anywhere in the syllabus, return an empty meetingTimes array — do not guess or invent one.
8. The "exams" list is ONLY for Midterm(s) and the Final Exam — items with those exact words (or unambiguous synonyms like "Midterm Exam", "Final") in their title. Weekly reading quizzes, in-class pop quizzes, lecture quizzes, and any other small recurring "Quiz" item belong in "assignments", NEVER in "exams" — even though they are graded and have a due date. When in doubt whether something is a quiz or a midterm, it is a quiz — put it in assignments.

Example of a CORRECT response shape for a course with 8 weekly assignments and 3 exams (yours should look like this in structure, with real data from the syllabus):
{"courses":[{"courseName":"DSC 10","meetingTimes":[
  {"days":[1,3,5],"startTime":"10:00","endTime":"10:50","location":"Center Hall 101","type":"Lecture"},
  {"days":[2],"startTime":"17:00","endTime":"17:50","location":"York Hall 2622","type":"Discussion Section"}
],"assignments":[
  {"title":"Problem Set 1","dueDate":"2026-09-25","estimatedHours":2,"weight":3},
  {"title":"Reading Quiz 1","dueDate":"2026-09-28","estimatedHours":0.5,"weight":2},
  {"title":"Problem Set 2","dueDate":"2026-10-02","estimatedHours":2,"weight":3},
  {"title":"Problem Set 3","dueDate":"2026-10-09","estimatedHours":2,"weight":3},
  {"title":"Problem Set 4","dueDate":"2026-10-16","estimatedHours":2,"weight":3},
  {"title":"Problem Set 5","dueDate":"2026-10-30","estimatedHours":2,"weight":3},
  {"title":"Problem Set 6","dueDate":"2026-11-06","estimatedHours":2,"weight":3},
  {"title":"Problem Set 7","dueDate":"2026-11-13","estimatedHours":2,"weight":3},
  {"title":"Problem Set 8","dueDate":"2026-12-04","estimatedHours":2,"weight":3}
],"exams":[
  {"title":"Midterm 1","date":"2026-10-23","topics":"Ch 1-3","prepDays":5,"weight":25},
  {"title":"Midterm 2","date":"2026-11-20","topics":"Ch 4-6","prepDays":5,"weight":25},
  {"title":"Final Exam","date":"2026-12-09","topics":"All chapters","prepDays":7,"weight":30}
]}]}

Now extract the real data from the syllabi below, following that same exhaustive pattern for EACH course found:
SYLLABI:\n${texts.join("\n")}`,8000,{model:"claude-opus-5"});
      if(t){
        const parsed=JSON.parse(t.replace(/```json|```/g,"").trim());
        const{courses:reclassified,moved}=reclassifyMisplacedQuizzes(parsed.courses);
        const p={...parsed,courses:reclassified};
        if(moved>0)console.log(`StudyOS: reclassified ${moved} quiz-titled item(s) from exams to assignments (safety check, not an error)`);
        // Pause here — show the student what was found before anything is saved. finalizeSync()
        // (below) does the actual save, once they confirm (with any corrections) or cancel.
        setPendingVerify({parsed:p,fileNames});
      }
    }catch(e){setSyncResult({error:e.message,fileNames});}
    setSyncing(false);
    setProgress?.(null);
  }

  // The actual save — runs only after the student confirms the ExtractionVerifyModal (with
  // whatever corrections they made). This is the same matching/creating/dedup logic syncSyl used
  // to run immediately; now it's a separate step, gated on human confirmation.
  async function finalizeSync(p,fileNames){
    setSyncing(true);
    setProgress?.({label:"Matching courses, saving & estimating study time...",detail:fileNames.join(", ")});
    let added=0,skippedDuplicate=0,coursesCreated=0;
    const nA=[],nE=[],newCourses=[];
    const itemsByCourse={};
    let workingCourses=[...data.courses];

    for(const c of (p.courses||[])){
      // Prefer a "Lecture" meeting time as the course's primary schedule; fall back to
      // whatever meeting time was found first if none is explicitly labeled Lecture.
      const meetings=c.meetingTimes||[];
      const primary=meetings.find(m=>/lecture/i.test(m.type||""))||meetings[0]||null;

      let course=findMatchingCourse(workingCourses.filter(c=>c.termId===viewingTermId),c.courseName);
      if(!course){
        // No matching course exists yet — create one instead of silently dropping its
        // assignments/exams. This is the common case right after a fresh reset or when a
        // syllabus is uploaded before the class schedule has been imported.
        const info=await CI(c.courseName,null,data.profile?.schoolName);
        course={
          id:uid(),
          termId:viewingTermId,
          name:prettyCourseCode(c.courseName),
          days:primary?.days||[],
          startTime:primary?.startTime||"09:00",
          endTime:primary?.endTime||"10:00",
          professor:"",room:primary?.location||"",units:4,
          difficulty:info.difficultyScore||5,difficultyLabel:info.difficultyLabel||"Medium",
          weeklyHours:info.weeklyStudyHours||5,startExamPrepDays:info.startExamPrepDays||5,
          description:info.description||"",tips:info.tips||[],
          difficultyConfidence:info.confidence||"low",difficultyRationale:info.rationale||"",
          color:CC[workingCourses.length%CC.length],
        };
        workingCourses=[...workingCourses,course];
        newCourses.push(course);
        coursesCreated++;
      }else if((!course.days||course.days.length===0)&&primary){
        // Course already exists but has no schedule data yet (e.g. was created from an
        // earlier syllabus-only sync before this meeting-time extraction existed) — backfill
        // it now rather than leaving the gap, without touching any other field on the course.
        workingCourses=workingCourses.map(x=>x.id===course.id?{...x,days:primary.days||[],startTime:primary.startTime||x.startTime,endTime:primary.endTime||x.endTime,room:x.room||primary.location||""}:x);
        course=workingCourses.find(x=>x.id===course.id);
      }
      itemsByCourse[c.courseName]={assignments:0,exams:0};
      for(const[i,a]of(c.assignments||[]).entries()){
        if(!a.dueDate)continue;
        const isDup=data.assignments.find(x=>x.courseId===course.id&&norm(x.title)===norm(a.title)&&x.dueDate===a.dueDate);
        if(isDup){skippedDuplicate++;continue;}
        const est=await computeEstimateFields(a,course,"homework");
        // Conservative first guess at project-type work — the student confirms/flips it with the
        // Homework⇄Project toggle in Study Preferences.
        const looksLikeProject=/\b(project|capstone|portfolio|thesis|dissertation|term paper|research paper|final paper)\b/i.test(a.title||"");
        nA.push({id:uid(),courseId:course.id,title:a.title,dueDate:a.dueDate,weight:a.weight??null,estimatedHours:est.aiHours,status:"not-started",...(looksLikeProject?{type:"project"}:{}),...est});
        added++;itemsByCourse[c.courseName].assignments++;
      }
      for(const[i,e]of(c.exams||[]).entries()){
        if(!e.date)continue;
        const isDup=data.exams.find(x=>x.courseId===course.id&&x.date===e.date);
        if(isDup){skippedDuplicate++;continue;}
        const est=await computeEstimateFields(e,course,"exam");
        nE.push({id:uid(),courseId:course.id,title:e.title,date:e.date,topics:e.topics||"",weight:e.weight??null,prepDays:e.prepDays||7,status:"not-started",estimatedHours:est.aiHours,...est});
        added++;itemsByCourse[c.courseName].exams++;
      }
    }

    upd({
      courses:workingCourses,
      assignments:[...data.assignments,...nA],
      exams:[...data.exams,...nE],
      lastSyllabusSync:{at:new Date().toISOString(),files:fileNames,added,coursesFound:p.courses?.map(c=>c.courseName)||[]}
    });
    setSyncResult({added,skippedDuplicate,coursesFound:p.courses?.map(c=>c.courseName)||[],coursesCreated,itemsByCourse,fileNames});
    setSylPdfs([]);
    setPendingVerify(null);
    setSyncing(false);
    setProgress?.(null);
  }


  // Shared box style matching Daily page
  const BOX={background:"var(--card)",borderRadius:12,marginBottom:20};
  const TITLE_ROW={display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 20px 0 20px"};
  const TITLE_LEFT={display:"flex",alignItems:"center",gap:8};
  const TITLE_ICON={fontSize:17,color:"var(--blue)"};
  const TITLE_TEXT={fontSize:13,fontWeight:500,color:"var(--t2)",textTransform:"uppercase",letterSpacing:"0.08em"};
  const DIVIDER={borderTop:"1px solid var(--b1)",margin:"10px 20px 0 20px"};
  const INNER={padding:"14px 20px 18px 20px"};

  // One set of column widths shared by the Active and Completed assignment tables so their
  // columns line up exactly (both sit in the same 20px-inset card). table-layout:fixed makes
  // these authoritative. The Assignment column has no width, so it absorbs all the slack and the
  // action icons sit flush right instead of floating in a wide empty column.
  const ASSIGN_COLS=(
    <colgroup>
      <col style={{width:36}}/>{/* status box */}
      <col style={{width:118}}/>{/* class */}
      <col/>{/* assignment title */}
      <col style={{width:104}}/>{/* due */}
      <col style={{width:70}}/>{/* weight */}
      <col style={{width:132}}/>{/* grade */}
      <col style={{width:88}}/>{/* actions */}
    </colgroup>
  );

  const VIEWS=[
    {id:"courses",    l:"Courses"},
    {id:"assignments",l:"Assignments",warn:missing.length>0},
    {id:"exams",      l:"Exams"},
    {id:"grades",     l:"GPA"},
    {id:"difficulty", l:"Difficulty",warn:diffDirty},
    {id:"sync",       l:"Update Syllabus"},
  ];
  const gpa=calcGPA(termCourses);

  return(
    <div className="fade">
      {/* Page header */}
      <div style={{marginBottom:20}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10,position:"relative"}}>
          <h2>Academics</h2>
          {termStatuses.length>0&&(()=>{
            const viewing=termStatuses.find(t=>t.id===viewingTermId);
            const badgeColor=viewing?.status==="current"?"var(--amber)":viewing?.status==="upcoming"?"var(--blue)":"var(--t3)";
            return(
              <div style={{position:"relative"}}>
                <button className="btn btn-ghost btn-sm" onClick={()=>setShowTermSwitcher(s=>!s)}
                  style={{display:"flex",alignItems:"center",gap:6,border:`1px solid ${badgeColor}`,color:badgeColor}}>
                  {viewing?.name||"Select term"}
                  <i className="ti ti-chevron-down" style={{fontSize:12}}/>
                </button>
                {showTermSwitcher&&(
                  <div style={{position:"absolute",top:"110%",left:0,zIndex:200,minWidth:220,
                    background:"var(--card)",border:"1px solid var(--b1)",borderRadius:10,
                    boxShadow:"0 12px 30px rgba(0,0,0,0.4)",padding:6}}>
                    {termStatuses.map(t=>{
                      const school=(data.schools||[]).find(s=>s.id===t.schoolId);
                      const color=t.status==="current"?"var(--amber)":t.status==="upcoming"?"var(--blue)":"var(--t3)";
                      return(
                        <button key={t.id} onClick={()=>{setViewingTermId(t.id);setShowTermSwitcher(false);}}
                          style={{display:"block",width:"100%",textAlign:"left",padding:"8px 10px",borderRadius:7,border:"none",
                            background:t.id===viewingTermId?"var(--card2)":"transparent",cursor:"pointer",fontFamily:"inherit"}}>
                          <div style={{display:"flex",alignItems:"center",gap:6}}>
                            <span style={{width:6,height:6,borderRadius:"50%",background:color,flexShrink:0}}/>
                            <span style={{fontSize:13,color:"var(--t1)"}}>{t.name}</span>
                            <span style={{fontSize:10,color,textTransform:"uppercase",marginLeft:"auto"}}>{t.status}</span>
                          </div>
                          {school&&<div style={{fontSize:11,color:"var(--t3)",marginLeft:12}}>{school.name}</div>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
        {/* Tab bar + Review Difficulty button, same row */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
          <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
            {VIEWS.map(v=>(
              <button key={v.id}
                style={{padding:"8px 16px",borderRadius:8,border:"none",cursor:"pointer",
                  fontFamily:"inherit",fontSize:14,fontWeight:400,
                  background:view===v.id?"var(--amber-bg)":"var(--card2)",
                  color:view===v.id?"var(--amber)":"var(--t3)",
                  position:"relative",transition:"all 0.15s"}}
                title={v.id==="sync"?"Upload updated syllabus PDFs":undefined}
                onClick={()=>{setView(v.id);setShowAddAssign(false);setShowAddExam(false);cancelEdit();}}>
                {v.l}
                {v.warn&&<span style={{position:"absolute",top:-3,right:-3,width:7,height:7,borderRadius:"50%",background:"var(--red)"}}/>}
              </button>
            ))}
          </div>
          {(termCourses.length>0||termAssignments.length>0||termExams.length>0)&&(
            <button className="btn btn-ghost btn-sm" style={{color:"var(--amber)"}} onClick={resetAcademic}>
              <i className="ti ti-eraser"/> Reset academic data
            </button>
          )}
        </div>
      </div>

      {/* ══════════════ ASSIGNMENTS ══════════════ */}
      {view==="assignments"&&(
        <div>
          {/* Progress bar */}
          {total>0&&(
            <div style={{...BOX,padding:"14px 20px"}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                <span style={{fontSize:14,color:"var(--t2)"}}>Progress</span>
                <span style={{fontSize:14,color:"var(--a-study-t)"}}>{done.length} / {total} completed</span>
              </div>
              <div className="bar"><div className="bar-fill" style={{width:`${done.length/total*100}%`,background:"var(--a-study-t)"}}/></div>
            </div>
          )}

          {/* Active assignments */}
          <div style={BOX}>
            <div style={TITLE_ROW}>
              <div style={TITLE_LEFT}>
                <i className="ti ti-clipboard-list" style={TITLE_ICON}/>
                <span style={TITLE_TEXT}>Active — {active.length} remaining</span>
              </div>
              {/* "+" button to toggle add form */}
              <button
                className="tt" data-tt="Add new assignment"
                onClick={()=>{setShowAddAssign(v=>!v);cancelEdit();}}
                style={{width:32,height:32,borderRadius:"50%",border:"none",cursor:"pointer",
                  background:showAddAssign?"var(--amber)":"var(--card2)",
                  color:showAddAssign?"#1a0e00":"var(--t2)",
                  fontSize:20,display:"flex",alignItems:"center",justifyContent:"center",
                  transition:"all 0.15s",flexShrink:0}}>
                {showAddAssign?"×":"+"}
              </button>
            </div>
            <div style={DIVIDER}/>
            <div style={INNER}>

              {/* Add form — shown when + clicked */}
              {showAddAssign&&(
                <div style={{background:"var(--card2)",borderRadius:10,padding:"16px 18px",marginBottom:16}}>
                  <div style={{fontSize:13,color:"var(--amber)",marginBottom:12,fontWeight:500}}>New assignment</div>
                  {/* Course FIRST */}
                  <div style={{marginBottom:10}}>
                    <label>Course</label>
                    <select value={na.course} onChange={e=>setNa(a=>({...a,course:e.target.value}))}>
                      <option value="">Select course...</option>
                      {termCourses.map(c=><option key={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  {/* Title second */}
                  <div style={{marginBottom:10}}>
                    <label>Assignment description</label>
                    <input value={na.title} onChange={e=>setNa(a=>({...a,title:e.target.value}))} placeholder="e.g. Problem Set 3, Lab Report"/>
                  </div>
                  <div className="g3" style={{marginBottom:12}}>
                    <div><label>Due date</label><input type="date" value={na.dueDate} onChange={e=>setNa(a=>({...a,dueDate:e.target.value}))}/></div>
                    <div><label>Est. hours</label><input type="number" min="0.5" max="40" step="0.5" value={na.estimatedHours} onChange={e=>setNa(a=>({...a,estimatedHours:+e.target.value}))}/></div>
                  </div>
                  <div style={{display:"flex",gap:9}}>
                    <button className="btn btn-action" style={{flex:1}} onClick={addAssignment} disabled={!na.title||!na.course}>
                      <i className="ti ti-plus"/> Add Assignment
                    </button>
                    <button className="btn btn-ghost" onClick={()=>{setShowAddAssign(false);setNa({course:"",title:"",dueDate:"",estimatedHours:2,status:"not-started"});}}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {active.length===0&&!showAddAssign&&(
                <div style={{fontSize:15,color:"var(--t3)",textAlign:"center",padding:"12px 0"}}>
                  No active assignments — press <strong style={{color:"var(--amber)"}}>+</strong> to add one
                </div>
              )}

              {active.length>0&&(
               <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
                <table style={{width:"100%",minWidth:680,borderCollapse:"collapse",tableLayout:"fixed"}}>
                  {ASSIGN_COLS}
                  <thead>
                    <tr style={{borderBottom:"1px solid var(--b1)"}}>
                      <th></th>
                      <TableHead label="Class" col="class" sortBy={assignSort} setSortBy={setAssignSort}/>
                      <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"left",padding:"0 8px 8px",fontWeight:600}}>Assignment</th>
                      <TableHead label="Due" col="due" sortBy={assignSort} setSortBy={setAssignSort}/>
                      <TableHead label="Weight" col="weight" sortBy={assignSort} setSortBy={setAssignSort}/>
                      <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"left",padding:"0 8px 8px",fontWeight:600}}>Grade</th>
                      <th style={{padding:"0 6px 8px"}}></th>
                    </tr>
                  </thead>
                  <tbody>
              {active.map((a,i,arr)=>{
                const d=(a.dueDate&&a.dueDate.length===10)?du(a.dueDate):null;
                const isEditing=editId===a.id;

                if(isEditing) return(
                  <tr key={a.id}>
                    <td colSpan={7} style={{padding:0}}>
                    <div style={{background:"var(--card2)",borderRadius:10,padding:"14px 16px",
                      margin:"6px 0"}}>
                    <div style={{fontSize:13,color:"var(--amber)",marginBottom:10}}>Editing: {a.title}</div>
                    <div style={{marginBottom:8}}>
                      <label>Course</label>
                      <select value={ed.course} onChange={e=>setEd(x=>({...x,course:e.target.value}))}>
                        <option value="">Select course...</option>
                        {termCourses.map(c=><option key={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                    <div style={{marginBottom:8}}>
                      <label>Description</label>
                      <input value={ed.title} onChange={e=>setEd(x=>({...x,title:e.target.value}))}/>
                    </div>
                    <div className="g3" style={{marginBottom:12}}>
                      <div><label>Due date</label><input type="date" value={ed.dueDate} onChange={e=>setEd(x=>({...x,dueDate:e.target.value}))}/></div>
                      <div><label>Est. hours</label><input type="number" min="0.5" max="40" step="0.5" value={ed.estimatedHours} onChange={e=>setEd(x=>({...x,estimatedHours:+e.target.value}))}/></div>
                    </div>
                    <div style={{display:"flex",gap:9}}>
                      <button className="btn btn-action" style={{flex:1}} onClick={saveEdit}
                        disabled={!ed.title||!ed.course}>
                        <i className="ti ti-device-floppy"/> Save changes
                      </button>
                      <button className="btn btn-ghost" onClick={cancelEdit}>Cancel</button>
                    </div>
                    </div>
                    </td>
                  </tr>
                );

                return(
                  <tr key={a.id} style={{borderBottom:i<arr.length-1?"1px solid var(--b1)":"none"}}>
                    <td style={{padding:"9px 8px"}}>
                      <div
                        title="Mark as completed"
                        onClick={()=>upd({assignments:data.assignments.map(x=>x.id===a.id?{...x,status:"done"}:x)})}
                        style={{width:20,height:20,borderRadius:6,border:"2px solid var(--t3)",
                          background:"var(--card2)",cursor:"pointer",flexShrink:0,
                          display:"flex",alignItems:"center",justifyContent:"center",
                          transition:"all 0.15s",color:"transparent",fontSize:12,fontWeight:600}}
                        onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--green)";e.currentTarget.style.background="var(--green-bg)";e.currentTarget.style.color="var(--green)";e.currentTarget.textContent="✓";}}
                        onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--t3)";e.currentTarget.style.background="var(--card2)";e.currentTarget.style.color="transparent";e.currentTarget.textContent="";}}
                      />
                    </td>
                    <td style={{padding:"9px 8px",fontSize:13,color:"var(--t2)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{courseNameFor(data.courses,a.courseId)}</td>
                    <td style={{padding:"9px 8px",fontSize:14,color:"var(--t1)"}}>{a.title}</td>
                    <td style={{padding:"9px 8px",whiteSpace:"nowrap"}}>
                      {d===null?(
                        <span
                          title="Click to add due date"
                          onClick={()=>startEdit(a)}
                          style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:12,
                            color:"var(--red)",background:"var(--red-bg)",
                            padding:"3px 8px",borderRadius:7,whiteSpace:"nowrap",
                            cursor:"pointer",userSelect:"none"}}>
                          <i className="ti ti-alert-triangle" style={{fontSize:11}}/>
                          Enter date
                        </span>
                      ):(
                        <span style={{fontSize:12,
                          color:d<0?"var(--red)":d<=2?"var(--red)":d<=5?"var(--amber)":"var(--blue)",
                          background:d<0?"var(--red-bg)":d<=2?"var(--red-bg)":d<=5?"var(--amber-bg)":"var(--blue-bg)",
                          padding:"3px 8px",borderRadius:7,whiteSpace:"nowrap"}}>
                          {new Date(a.dueDate+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}
                        </span>
                      )}
                    </td>
                    <td style={{padding:"9px 8px",fontSize:13,color:"var(--t2)",whiteSpace:"nowrap"}}>{a.weight!=null?a.weight+"%":"—"}</td>
                    <td style={{padding:"6px 8px"}}>
                      <GradeInput value={a.grade} onChange={v=>upd({assignments:data.assignments.map(x=>x.id===a.id?{...x,grade:v}:x)})}/>
                    </td>
                    <td style={{padding:"9px 6px",whiteSpace:"nowrap",textAlign:"right"}}>
                      <button
                        className="tt" data-tt="Edit this assignment"
                        onClick={()=>startEdit(a)}
                        style={{width:30,height:30,borderRadius:7,border:"none",cursor:"pointer",
                          background:"var(--blue-bg)",color:"var(--blue)",marginRight:6,
                          fontFamily:"inherit",display:"inline-flex",alignItems:"center",justifyContent:"center"}}>
                        <i className="ti ti-pencil" style={{fontSize:15}}/>
                      </button>
                      <button
                        className="tt" data-tt="Delete this assignment"
                        onClick={async()=>{if(await confirm(`Delete "${a.title}"?`,{confirmLabel:"Delete",confirmIcon:"ti-trash"}))upd({assignments:data.assignments.filter(x=>x.id!==a.id)});}}
                        style={{width:30,height:30,borderRadius:7,border:"none",cursor:"pointer",
                          background:"var(--red)",color:"#fff",
                          fontFamily:"inherit",display:"inline-flex",alignItems:"center",justifyContent:"center"}}>
                        <i className="ti ti-trash" style={{fontSize:15}}/>
                      </button>
                    </td>
                  </tr>
                );
              })}
                  </tbody>
                </table>
               </div>
              )}
            </div>
          </div>

          {/* ── Completed assignments — separate box, no strikethrough ── */}
          {done.length>0&&(
            <div style={{background:"var(--card)",borderRadius:12,marginBottom:20}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                padding:"12px 20px",borderBottom:"1px solid var(--b1)"}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <i className="ti ti-circle-check" style={{fontSize:16,color:"var(--green)"}}/>
                  <span style={{fontSize:13,color:"var(--t2)",textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:500}}>
                    Completed — {done.length}
                  </span>
                </div>
              </div>
              <div style={{padding:"4px 20px 14px 20px"}}>
               <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
                <table style={{width:"100%",minWidth:680,borderCollapse:"collapse",tableLayout:"fixed"}}>
                  {ASSIGN_COLS}
                  <tbody>
                {done.map((a,i,arr)=>(
                  <tr key={a.id} style={{borderBottom:i<arr.length-1?"1px solid var(--b1)":"none"}}>
                    <td style={{padding:"9px 8px"}}>
                      <div style={{width:20,height:20,borderRadius:6,background:"var(--green)",
                        flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                        <i className="ti ti-check" style={{fontSize:12,color:"#052e16",fontWeight:700}}/>
                      </div>
                    </td>
                    <td style={{padding:"9px 8px",fontSize:13,color:"var(--t3)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{courseNameFor(data.courses,a.courseId)}</td>
                    <td style={{padding:"9px 8px",fontSize:14,color:"var(--t2)",overflow:"hidden",textOverflow:"ellipsis"}}>{a.title}</td>
                    <td style={{padding:"9px 8px",fontSize:12,color:"var(--t3)",whiteSpace:"nowrap"}}>{a.dueDate?new Date(a.dueDate+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"}):"—"}</td>
                    <td style={{padding:"9px 8px",fontSize:13,color:"var(--t3)",whiteSpace:"nowrap"}}>{a.weight!=null?a.weight+"%":"—"}</td>
                    <td style={{padding:"6px 8px"}}>
                      <GradeInput value={a.grade} onChange={v=>upd({assignments:data.assignments.map(x=>x.id===a.id?{...x,grade:v}:x)})}/>
                    </td>
                    <td style={{padding:"9px 6px",whiteSpace:"nowrap",textAlign:"right"}}>
                      <button
                        className="tt" data-tt="Move back to active"
                        onClick={()=>upd({assignments:data.assignments.map(x=>x.id===a.id?{...x,status:"not-started"}:x)})}
                        style={{width:30,height:30,borderRadius:7,border:"none",cursor:"pointer",
                          background:"var(--card2)",color:"var(--t3)",fontFamily:"inherit",marginRight:6,
                          display:"inline-flex",alignItems:"center",justifyContent:"center"}}>
                        <i className="ti ti-arrow-up" style={{fontSize:15}}/>
                      </button>
                      <button
                        className="tt" data-tt="Delete permanently"
                        onClick={async()=>{if(await confirm(`Delete "${a.title}"?`,{confirmLabel:"Delete",confirmIcon:"ti-trash"}))upd({assignments:data.assignments.filter(x=>x.id!==a.id)});}}
                        style={{width:30,height:30,borderRadius:7,border:"none",cursor:"pointer",
                          background:"var(--red)",color:"#fff",fontFamily:"inherit",
                          display:"inline-flex",alignItems:"center",justifyContent:"center"}}>
                        <i className="ti ti-trash" style={{fontSize:15}}/>
                      </button>
                    </td>
                  </tr>
                ))}
                  </tbody>
                </table>
               </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════ EXAMS ══════════════ */}
      {view==="exams"&&(
        <div>
          <div style={BOX}>
            <div style={TITLE_ROW}>
              <div style={TITLE_LEFT}>
                <i className="ti ti-file-text" style={TITLE_ICON}/>
                <span style={TITLE_TEXT}>Exams</span>
              </div>
              <button className="tt" data-tt="Add new exam" onClick={()=>{setShowAddExam(v=>!v);cancelEditExam();}}
                style={{width:32,height:32,borderRadius:"50%",border:"none",cursor:"pointer",
                  background:showAddExam?"var(--amber)":"var(--card2)",
                  color:showAddExam?"#1a0e00":"var(--t2)",
                  fontSize:20,display:"flex",alignItems:"center",justifyContent:"center",
                  transition:"all 0.15s",flexShrink:0}}>
                {showAddExam?"×":"+"}
              </button>
            </div>
            <div style={DIVIDER}/>
            <div style={INNER}>

              {/* Add form */}
              {showAddExam&&(
                <div style={{background:"var(--card2)",borderRadius:10,padding:"16px 18px",marginBottom:16,borderLeft:"2px solid var(--amber)"}}>
                  <div style={{fontSize:13,color:"var(--amber)",marginBottom:12}}>New exam</div>
                  <div style={{marginBottom:10}}>
                    <label>Course</label>
                    <select value={ne.course} onChange={e=>setNe(x=>({...x,course:e.target.value}))}>
                      <option value="">Select course...</option>
                      {termCourses.map(c=><option key={c.id} value={c.name}>{c.name}</option>)}
                    </select>
                  </div>
                  <div style={{marginBottom:10}}>
                    <label>Topics covered</label>
                    <input value={ne.topics} onChange={e=>setNe(x=>({...x,topics:e.target.value}))} placeholder="e.g. Ch.1–5, linear regression"/>
                  </div>
                  <div className="g2" style={{marginBottom:12}}>
                    <div><label>Exam date</label><input type="date" value={ne.date} onChange={e=>setNe(x=>({...x,date:e.target.value}))}/></div>
                    <div><label>Start prep (days before)</label><input type="number" min="1" max="21" value={ne.prepDays} onChange={e=>setNe(x=>({...x,prepDays:+e.target.value}))}/></div>
                  </div>
                  <div style={{display:"flex",gap:9}}>
                    <button className="btn btn-action" style={{flex:1}} onClick={addExam} disabled={!ne.course||!ne.date}>
                      <i className="ti ti-plus"/> Add Exam
                    </button>
                    <button className="btn btn-ghost" onClick={()=>{setShowAddExam(false);setNe({course:"",date:"",topics:"",prepDays:7});}}>Cancel</button>
                  </div>
                </div>
              )}

              {data.exams.length===0&&!showAddExam&&(
                <div style={{fontSize:15,color:"var(--t3)",textAlign:"center",padding:"12px 0"}}>
                  No exams yet — press <strong style={{color:"var(--amber)"}}>+</strong> to add one
                </div>
              )}

              {(()=>{
                const today=iso();
                const sortExams=list=>[...list].sort((a,b)=>{
                  if(examSort==="class")return courseNameFor(data.courses,a.courseId).localeCompare(courseNameFor(data.courses,b.courseId))||(a.date||"").localeCompare(b.date||"");
                  if(examSort==="weight")return(b.weight??-1)-(a.weight??-1);
                  if(examSort==="prep")return(b.prepDays??0)-(a.prepDays??0);
                  return(a.date||"9999").localeCompare(b.date||"9999"); // "due" default
                });
                const upcoming=sortExams(termExams.filter(e=>!e.date||e.date>=today));
                const completed=sortExams(termExams.filter(e=>e.date&&e.date<today));

                function ExamRow(e,i,arr,isPast){
                  const hasDate=e.date&&e.date.length===10;
                  const d=hasDate?du(e.date):null;
                  const prep=hasDate&&d>0&&d<=e.prepDays;
                  const isEditing=editExamId===e.id;

                  if(isEditing) return(
                    <tr key={e.id}>
                      <td colSpan={7} style={{padding:0}}>
                      <div style={{background:"var(--card2)",borderRadius:10,padding:"14px 16px",margin:"6px 0"}}>
                        <div style={{fontSize:13,color:"var(--amber)",marginBottom:10}}>Editing: {courseNameFor(data.courses,e.courseId)}</div>
                        <div style={{marginBottom:8}}>
                          <label>Course</label>
                          <select value={ee.course} onChange={ev=>setEe(x=>({...x,course:ev.target.value}))}>
                            <option value="">Select course...</option>
                            {termCourses.map(c=><option key={c.id} value={c.name}>{c.name}</option>)}
                          </select>
                        </div>
                        <div style={{marginBottom:8}}>
                          <label>Topics covered</label>
                          <input value={ee.topics} onChange={ev=>setEe(x=>({...x,topics:ev.target.value}))}/>
                        </div>
                        <div className="g2" style={{marginBottom:12}}>
                          <div><label>Exam date</label><input type="date" value={ee.date} onChange={ev=>setEe(x=>({...x,date:ev.target.value}))}/></div>
                          <div><label>Start prep (days before)</label><input type="number" min="1" max="21" value={ee.prepDays} onChange={ev=>setEe(x=>({...x,prepDays:+ev.target.value}))}/></div>
                        </div>
                        <div style={{display:"flex",gap:9}}>
                          <button className="btn btn-action" style={{flex:1}} onClick={saveEditExam} disabled={!ee.course||!ee.date}>
                            <i className="ti ti-device-floppy"/> Save changes
                          </button>
                          <button className="btn btn-ghost" onClick={cancelEditExam}>Cancel</button>
                        </div>
                      </div>
                      </td>
                    </tr>
                  );

                  return(
                    <tr key={e.id} style={{borderBottom:i<arr.length-1?"1px solid var(--b1)":"none",opacity:isPast?0.55:1}}>
                      <td style={{padding:"9px 8px",fontSize:13,color:"var(--t2)",whiteSpace:"nowrap"}}>{courseNameFor(data.courses,e.courseId)}</td>
                      <td style={{padding:"9px 8px",fontSize:14,color:"var(--t1)"}}>{e.title||"Exam"}</td>
                      <td style={{padding:"9px 8px",fontSize:13,color:"var(--t3)"}}>{e.topics||"—"}</td>
                      <td style={{padding:"9px 8px",whiteSpace:"nowrap"}}>
                        {!hasDate?(
                          <span className="tt" data-tt="Click to add exam date" onClick={()=>startEditExam(e)}
                            style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:12,
                              color:"var(--red)",background:"var(--red-bg)",
                              padding:"3px 8px",borderRadius:7,whiteSpace:"nowrap",
                              cursor:"pointer",userSelect:"none"}}>
                            <i className="ti ti-alert-triangle" style={{fontSize:11}}/>
                            Enter date
                          </span>
                        ):(
                          <span style={{fontSize:12,
                            color:isPast?"var(--t3)":d===0||d<=3?"var(--red)":d<=7?"var(--amber)":"var(--blue)",
                            background:isPast?"var(--card2)":d===0||d<=3?"var(--red-bg)":d<=7?"var(--amber-bg)":"var(--blue-bg)",
                            padding:"3px 8px",borderRadius:7,whiteSpace:"nowrap"}}>
                            {new Date(e.date+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}
                            {!isPast&&d===0&&" · TODAY"}
                          </span>
                        )}
                        {prep&&<div style={{fontSize:11,color:"var(--amber)",marginTop:3}}>Prep starts now — {d}d left</div>}
                      </td>
                      <td style={{padding:"9px 8px",fontSize:13,color:"var(--t2)",whiteSpace:"nowrap"}}>{e.weight!=null?e.weight+"%":"—"}</td>
                      <td style={{padding:"6px 8px"}}>
                        <GradeInput value={e.grade} onChange={v=>upd({exams:data.exams.map(x=>x.id===e.id?{...x,grade:v}:x)})}/>
                      </td>
                      <td style={{padding:"9px 8px",whiteSpace:"nowrap"}}>
                        <button className="tt" data-tt="Edit this exam" onClick={()=>startEditExam(e)}
                          style={{width:30,height:30,borderRadius:7,border:"none",cursor:"pointer",
                            background:"var(--blue-bg)",color:"var(--blue)",marginRight:6,
                            fontFamily:"inherit",display:"inline-flex",alignItems:"center",justifyContent:"center"}}>
                          <i className="ti ti-pencil" style={{fontSize:15}}/>
                        </button>
                        <button className="tt" data-tt="Delete this exam" onClick={async()=>{if(await confirm(`Delete "${courseNameFor(data.courses,e.courseId)} — Exam"?`,{confirmLabel:"Delete",confirmIcon:"ti-trash"}))upd({exams:data.exams.filter(x=>x.id!==e.id)});}}
                          style={{width:30,height:30,borderRadius:7,border:"none",cursor:"pointer",
                            background:"var(--red)",color:"#fff",
                            fontFamily:"inherit",display:"inline-flex",alignItems:"center",justifyContent:"center"}}>
                          <i className="ti ti-trash" style={{fontSize:15}}/>
                        </button>
                      </td>
                    </tr>
                  );
                }

                return(
                  <>
                    {upcoming.length>0&&(
                      <>
                        <div style={{fontSize:12,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8,marginTop:4}}>Upcoming</div>
                        <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch",marginBottom:20}}>
                        <table style={{width:"100%",minWidth:680,borderCollapse:"collapse"}}>
                          <thead>
                            <tr style={{borderBottom:"1px solid var(--b1)"}}>
                              <TableHead label="Class" col="class" sortBy={examSort} setSortBy={setExamSort}/>
                              <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"left",padding:"0 8px 8px",fontWeight:600}}>Exam</th>
                              <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"left",padding:"0 8px 8px",fontWeight:600}}>Topics</th>
                              <TableHead label="Due" col="due" sortBy={examSort} setSortBy={setExamSort}/>
                              <TableHead label="Weight" col="weight" sortBy={examSort} setSortBy={setExamSort}/>
                              <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"left",padding:"0 8px 8px",fontWeight:600}}>Grade</th>
                              <th style={{width:90}}></th>
                            </tr>
                          </thead>
                          <tbody>
                            {upcoming.map((e,i,arr)=>ExamRow(e,i,arr,false))}
                          </tbody>
                        </table>
                        </div>
                      </>
                    )}
                    {completed.length>0&&(
                      <>
                        <div style={{fontSize:12,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Completed</div>
                        <table style={{width:"100%",borderCollapse:"collapse"}}>
                          <tbody>
                            {completed.map((e,i,arr)=>ExamRow(e,i,arr,true))}
                          </tbody>
                        </table>
                      </>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════ COURSES ══════════════ */}
      {view==="courses"&&(
        <div>
          {termCourses.length===0&&(
            <div style={{...BOX,padding:"20px",textAlign:"center"}}>
              <div style={{fontSize:15,color:"var(--t3)"}}>No courses yet — upload a schedule PDF or add one manually below</div>
            </div>
          )}
          {termCourses.map((c,i)=>(
            <div key={c.id} style={BOX}>
              <div style={TITLE_ROW}>
                <div style={TITLE_LEFT}>
                  <div style={{width:10,height:10,borderRadius:"50%",background:c.color.border}}/>
                  <span style={{...TITLE_TEXT,color:"var(--t1)",fontSize:16,textTransform:"none",letterSpacing:"normal",fontWeight:500}}>{c.name}</span>
                </div>
                <DelBtn onClick={()=>upd({courses:data.courses.filter(x=>x.id!==c.id)})} title="Remove course"/>
              </div>
              <div style={DIVIDER}/>
              <div style={INNER}>
                <div style={{fontSize:14,color:"var(--t2)",marginBottom:8}}>
                  {(!c.days||!c.days.length)?(
                    <span style={{display:"flex",alignItems:"center",gap:6,color:"var(--red)"}}>
                      <i className="ti ti-alert-triangle" style={{fontSize:14}}/>
                      No class days/times set — planner may book study time over your real class. Import the schedule PDF to fix this.
                    </span>
                  ):(
                    <>
                      <span style={{color:"var(--amber)"}}>{c.days.map(d=>DS[d]).join(" · ")}</span>
                      {" "}{c.startTime} – {c.endTime}
                    </>
                  )}
                  {c.professor&&<span style={{color:"var(--t3)"}}> · {c.professor}</span>}
                </div>
                <div style={{display:"flex",gap:7,flexWrap:"wrap",alignItems:"center",marginBottom:c.description||c.tips?.length?10:0}}>
                  <DiffBadge score={c.difficulty} label={c.difficultyLabel}/>
                  <span className="badge badge-blue">{c.weeklyHours}h/wk study</span>
                  <span className="badge badge-teal">prep {c.startExamPrepDays||5}d before exams</span>
                  {c.difficultyConfidence&&(
                    <span className="tt" data-tt={`Web-researched difficulty, ${c.difficultyConfidence} confidence.${c.difficultyRationale?` ${c.difficultyRationale}`:""} You can always override the score above.`}
                      style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:11,padding:"3px 8px",borderRadius:6,background:"var(--card2)",color:"var(--t3)",cursor:"default"}}>
                      <i className="ti ti-search" style={{fontSize:11}}/>{c.difficultyConfidence} confidence
                    </span>
                  )}
                </div>
                {c.description&&<div style={{fontSize:13,color:"var(--t3)",fontStyle:"italic",marginBottom:c.tips?.length?4:0}}>{c.description}</div>}
                {c.tips?.length>0&&<div style={{fontSize:13,color:"var(--a-study-t)"}}>💡 {c.tips[0]}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ══════════════ GRADES ══════════════ */}
      {view==="grades"&&(
        <div>
          <div style={{...BOX,padding:"18px 20px",textAlign:"center"}}>
            <div style={{fontSize:12,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Overall GPA</div>
            <div style={{fontSize:40,fontFamily:"'Syne',sans-serif",fontWeight:700,color:"var(--amber)"}}>
              {gpa!==null?gpa.toFixed(2):"—"}
            </div>
            <div style={{fontSize:13,color:"var(--t3)",marginTop:4}}>
              {gpa!==null?`Based on ${termCourses.filter(c=>c.grade!=null&&c.grade!=="").length} graded course${termCourses.filter(c=>c.grade!=null&&c.grade!=="").length!==1?"s":""}`:"Enter grades below to calculate"}
            </div>
          </div>

          {termCourses.length===0?(
            <div style={{...BOX,padding:"20px",textAlign:"center"}}>
              <div style={{fontSize:15,color:"var(--t3)"}}>No courses yet — add classes in the Courses tab first</div>
            </div>
          ):(
            <div style={BOX}>
              <div style={TITLE_ROW}>
                <div style={TITLE_LEFT}>
                  <i className="ti ti-report" style={TITLE_ICON}/>
                  <span style={TITLE_TEXT}>Course Grades</span>
                </div>
              </div>
              <div style={DIVIDER}/>
              <div style={{...INNER,overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
                <table style={{width:"100%",minWidth:520,borderCollapse:"collapse"}}>
                  <thead>
                    <tr style={{borderBottom:"1px solid var(--b1)"}}>
                      <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"left",padding:"0 8px 8px",fontWeight:600}}>Class</th>
                      <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"left",padding:"0 8px 8px",fontWeight:600,width:110}}>Grade %</th>
                      <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"left",padding:"0 8px 8px",fontWeight:600,width:80}}>Credits</th>
                      <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"left",padding:"0 8px 8px",fontWeight:600,width:60}}>Letter</th>
                    </tr>
                  </thead>
                  <tbody>
                    {termCourses.map((c,i)=>{
                      const{letter}=letterFromPct(c.grade);
                      return(
                        <tr key={c.id} style={{borderBottom:i<termCourses.length-1?"1px solid var(--b1)":"none"}}>
                          <td style={{padding:"9px 8px"}}>
                            <div style={{display:"flex",alignItems:"center",gap:8}}>
                              <div style={{width:8,height:8,borderRadius:"50%",background:c.color.border,flexShrink:0}}/>
                              <span style={{fontSize:14,color:"var(--t1)"}}>{c.name}</span>
                            </div>
                          </td>
                          <td style={{padding:"6px 8px"}}>
                            <input type="number" min="0" max="100" placeholder="e.g. 91" style={{fontSize:13,padding:"5px 7px",width:80}}
                              value={c.grade??""}
                              onChange={e=>upd({courses:data.courses.map(x=>x.id===c.id?{...x,grade:e.target.value===""?null:+e.target.value}:x)})}/>
                          </td>
                          <td style={{padding:"6px 8px"}}>
                            <input type="number" min="0.5" max="10" step="0.5" placeholder="4" style={{fontSize:13,padding:"5px 7px",width:60}}
                              value={c.credits??4}
                              onChange={e=>upd({courses:data.courses.map(x=>x.id===c.id?{...x,credits:e.target.value===""?4:+e.target.value}:x)})}/>
                          </td>
                          <td style={{padding:"6px 8px"}}>
                            <span className={`badge ${c.grade!=null&&c.grade!==""?"badge-amber":"badge-blue"}`} style={{fontSize:13}}>{letter}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════ REFRESH PLAN ══════════════ */}
      {/* ══════════════ SYNC SYLLABUS ══════════════ */}
      {view==="difficulty"&&(
        <div>
          <div style={BOX}>
            <div style={TITLE_ROW}>
              <div style={TITLE_LEFT}>
                <i className="ti ti-gauge" style={TITLE_ICON}/>
                <span style={TITLE_TEXT}>Study Preferences</span>
              </div>
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                <button className="tt" data-tt="Save changes" onClick={saveDifficulty} disabled={diffComputing||!diffDirty}
                  style={{width:28,height:28,borderRadius:"50%",border:"1px solid var(--b1)",cursor:diffDirty?"pointer":"default",
                    background:diffDirty?"var(--amber-bg)":"var(--card2)",color:diffDirty?"var(--amber)":"var(--t3)",
                    display:"flex",alignItems:"center",justifyContent:"center",padding:0,opacity:diffComputing?0.5:1}}>
                  <i className="ti ti-device-floppy" style={{fontSize:14}}/>
                </button>
                <button className="tt" data-tt="Save & Replan — also updates your calendar right away" onClick={saveDifficultyAndReplan} disabled={diffComputing||(!diffDirty&&!data.planStale)||planning}
                  style={{width:28,height:28,borderRadius:"50%",border:"1px solid var(--b1)",cursor:(diffDirty||data.planStale)?"pointer":"default",
                    background:(diffDirty||data.planStale)?"var(--amber-bg)":"var(--card2)",color:(diffDirty||data.planStale)?"var(--amber)":"var(--t3)",
                    display:"flex",alignItems:"center",justifyContent:"center",padding:0,opacity:diffComputing?0.5:1}}>
                  {planning?<Sp sz={13}/>:<i className="ti ti-sparkles" style={{fontSize:14}}/>}
                </button>
                <button className="tt" data-tt="How this works" onClick={()=>setShowDiffHelp(true)}
                  style={{width:28,height:28,borderRadius:"50%",border:"1px solid var(--b1)",background:"var(--card2)",
                    color:"var(--t2)",fontSize:12,fontWeight:600,cursor:"pointer",display:"flex",
                    alignItems:"center",justifyContent:"center",padding:0}}>
                  ?
                </button>
              </div>
            </div>
            {planning&&planMsg&&<div style={{fontSize:11,color:"var(--t3)",textAlign:"right",padding:"4px 20px 0"}}>{planMsg}</div>}
            {!planning&&data.planStale&&(
              <div style={{fontSize:11,color:"var(--amber)",textAlign:"right",padding:"4px 20px 0",display:"flex",alignItems:"center",justifyContent:"flex-end",gap:5}}>
                <i className="ti ti-alert-triangle" style={{fontSize:12}}/>
                Current plan doesn't reflect your latest saved changes — Save & Replan to apply
              </div>
            )}
            <div style={DIVIDER}/>
            <div style={INNER}>
              {diffComputing?(
                <div style={{display:"flex",alignItems:"center",gap:10,padding:"20px 0",color:"var(--t2)"}}>
                  <Sp/> Computing estimates...
                </div>
              ):(()=>{
                const allItems=diffRatings?Object.entries(diffRatings).filter(([key,r])=>termCourseIds.has(r.courseId)).map(([key,r])=>({key,...r,
                  effectiveValue:r.userValue||r.estimatorValue,
                  effectiveHours:r.userHours??r.aiHours,
                  priority:computePriorityScore(r.dueDate,r.userValue||r.estimatorValue,r.weight)})):[];
                if(allItems.length===0)return <div style={{color:"var(--t3)",padding:"20px 0"}}>No active assignments or exams to review.</div>;

                // Same comparator drives both the row order WITHIN a class and the order of the
                // class groups themselves (by that group's own top item) — grouping removes the
                // repeated Class column, but "what's most urgent" still surfaces at a glance.
                const itemCmp=(a,b)=>{
                  if(diffSortBy==="weight")return(b.weight??-1)-(a.weight??-1);
                  if(diffSortBy==="priority")return b.priority-a.priority;
                  return(a.dueDate||"9999").localeCompare(b.dueDate||"9999");
                };
                const byCourse=new Map();
                allItems.forEach(it=>{
                  if(!byCourse.has(it.courseId))byCourse.set(it.courseId,{courseId:it.courseId,courseName:it.courseName,items:[]});
                  byCourse.get(it.courseId).items.push(it);
                });
                const groups=[...byCourse.values()].map(g=>{
                  const items=[...g.items].sort(itemCmp);
                  const course=termCourses.find(c=>c.id===g.courseId);
                  return{...g,items,color:course?.color?.border||"var(--t3)"};
                }).sort((a,b)=>itemCmp(a.items[0],b.items[0]));

                const allCourseIds=groups.map(g=>g.courseId);
                const allFolded=allCourseIds.length>0&&allCourseIds.every(id=>foldedClasses.has(id));

                return(
                 <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
                  <div style={{display:"flex",justifyContent:"flex-end",marginBottom:8}}>
                    <button className="btn btn-ghost btn-sm" onClick={()=>setAllFolded(allCourseIds,!allFolded)}>
                      <i className={`ti ${allFolded?"ti-chevrons-down":"ti-chevrons-up"}`} style={{marginRight:5}}/>
                      {allFolded?"Expand all":"Collapse all"}
                    </button>
                  </div>
                  <table style={{width:"100%",minWidth:680,borderCollapse:"collapse"}}>
                    <thead>
                      <tr style={{borderBottom:"1px solid var(--b1)"}}>
                        <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"left",padding:"0 8px 8px",fontWeight:600}}>Assignment</th>
                        <TableHead label="Due" col="due" sortBy={diffSortBy} setSortBy={setDiffSortBy} align="center"/>
                        <TableHead label="Weight" col="weight" sortBy={diffSortBy} setSortBy={setDiffSortBy} align="center"/>
                        <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"left",padding:"0 8px 8px",fontWeight:600}}>Type</th>
                        <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"center",padding:"0 8px 8px",fontWeight:600}}>AI Planning</th>
                        <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"center",padding:"0 8px 8px",fontWeight:600,width:104}}>Student Planning</th>
                        <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"left",padding:"0 8px 8px",fontWeight:600}}>Hours</th>
                        <TableHead label="Priority" col="priority" sortBy={diffSortBy} setSortBy={setDiffSortBy}/>
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map(g=>{
                        const folded=foldedClasses.has(g.courseId);
                        const nextDue=g.items.map(it=>it.dueDate).filter(Boolean).sort()[0];
                        return(
                          <Fragment key={g.courseId}>
                            <tr style={{borderBottom:"1px solid var(--b1)",background:"var(--card2)",cursor:"pointer"}}
                              onClick={()=>toggleFold(g.courseId)}>
                              <td colSpan={8} style={{padding:"8px 8px"}}>
                                <div style={{display:"flex",alignItems:"center",gap:8,fontSize:13}}>
                                  <i className={`ti ${folded?"ti-chevron-right":"ti-chevron-down"}`} style={{fontSize:13,color:"var(--t3)",flexShrink:0}}/>
                                  <div style={{width:8,height:8,borderRadius:"50%",background:g.color,flexShrink:0}}/>
                                  <span style={{color:"var(--t1)",fontWeight:600}}>{g.courseName}</span>
                                  <span style={{color:"var(--t3)"}}>· {g.items.length} item{g.items.length!==1?"s":""}</span>
                                  {nextDue&&<span style={{color:"var(--t3)"}}>· next due {nextDue}</span>}
                                  <span style={{marginLeft:"auto",color:"var(--t3)",fontSize:12}}>{folded?"See more":"See less"}</span>
                                </div>
                              </td>
                            </tr>
                            {!folded&&g.items.map(item=>{
                              const isExam=item.kind==="exam";
                              const isProject=item.type==="project";
                              const accent=isExam?"var(--red)":isProject?"#6a5acd":"transparent";
                              return(
                              <tr key={item.key} style={{borderBottom:"1px solid var(--b1)",
                                borderLeft:`3px solid ${accent}`,
                                background:isExam?"var(--red-bg)":isProject?"rgba(106,90,205,0.09)":undefined}}>
                                <td style={{padding:"9px 8px",fontSize:14,color:"var(--t1)"}}>
                                  <i className={`ti ${isExam?"ti-file-text":isProject?"ti-folders":"ti-notebook"}`} style={{fontSize:13,color:"var(--t3)",marginRight:6}}/>
                                  {item.title}
                                  {isExam&&<span style={{marginLeft:7,fontSize:10,fontWeight:700,letterSpacing:"0.05em",color:"var(--red)",background:"var(--red-bg)",padding:"2px 6px",borderRadius:4}}>EXAM</span>}
                                  {isProject&&<span style={{marginLeft:7,fontSize:10,fontWeight:700,letterSpacing:"0.05em",color:"#a89cf0",background:"rgba(106,90,205,0.18)",padding:"2px 6px",borderRadius:4}}>PROJECT</span>}
                                </td>
                                <td style={{padding:"9px 8px",fontSize:13,color:"var(--t2)",whiteSpace:"nowrap",textAlign:"center"}}>{item.dueDate||"—"}</td>
                                <td style={{padding:"9px 8px",fontSize:13,color:"var(--t2)",whiteSpace:"nowrap",textAlign:"center"}}>{item.weight!=null?item.weight+"%":"—"}</td>
                                <td style={{padding:"9px 8px"}}>
                                  {isExam
                                    ?<span style={{fontSize:12,color:"var(--t3)"}}>Exam</span>
                                    :<select value={item.type||"homework"} onChange={e=>setItemType(item.key,item.id,e.target.value)}
                                       title="Projects get steady work across the whole term instead of a last-few-days sprint"
                                       style={{fontSize:12,padding:"4px 7px",width:110,
                                         borderColor:isProject?"#6a5acd":undefined,
                                         color:isProject?"#a89cf0":undefined,fontWeight:isProject?600:400}}>
                                       <option value="homework">Homework</option>
                                       <option value="project">Project</option>
                                     </select>}
                                </td>
                                <td style={{padding:"9px 8px",textAlign:"center"}}><DiffPill value={item.estimatorValue} muted={!!item.userValue}/></td>
                                <td style={{padding:"9px 8px",textAlign:"center"}}>
                                  <select value={item.userValue||""} onChange={e=>setDiffOverride(item.key,e.target.value||null)}
                                    style={{fontSize:12,padding:"4px 6px",width:98,
                                      borderColor:item.userValue?"var(--amber)":undefined,
                                      fontWeight:item.userValue?600:400,
                                      color:item.userValue?"var(--amber)":undefined}}>
                                    <option value="">— none —</option>
                                    {DIFFICULTY_BANDS.map(b=><option key={b} value={b}>{b}</option>)}
                                  </select>
                                </td>
                                <td style={{padding:"9px 8px",whiteSpace:"nowrap"}}>
                                  <HoursInput value={item.userHours??item.aiHours} isOverridden={item.userHours!=null}
                                    onCommit={v=>setHoursOverride(item.key,v)}/>
                                  <span style={{fontSize:11,color:"var(--t3)",marginLeft:4}}>h</span>
                                  {item.userHours!=null&&item.userHours!==item.aiHours&&(
                                    <button onClick={()=>setHoursOverride(item.key,null)}
                                      title={`Reset to suggested ${item.aiHours}h`}
                                      style={{marginLeft:6,fontSize:11,color:"var(--t3)",background:"none",border:"none",
                                        cursor:"pointer",padding:0}}>
                                      ↺ {item.aiHours}h
                                    </button>
                                  )}
                                </td>
                                <td style={{padding:"9px 8px",fontSize:13,color:"var(--t2)"}}>{item.priority}</td>
                              </tr>
                              );
                            })}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                 </div>
                );
              })()}
            </div>
          </div>
          {showDiffHelp&&(
            <InfoModal
              title="Study Preferences"
              onClose={()=>setShowDiffHelp(false)}
              sections={[
                {heading:"",body:"We use AI to estimate two things for every assignment and exam:"},
                {heading:"Difficulty",body:"A Low / Mid / High / Very High band for each item, from how hard the course tends to be plus how much this item counts toward your grade. Very High is for cumulative finals and big projects."},
                {heading:"Hours",body:"Read straight off the difficulty band (Very High takes the most), then nudged a little by grade weight %. Changing an item's band resets its hours to the new suggestion — that's the point of changing it. This is what gets blocked off on your calendar."},
                {heading:"Your inputs always win",body:"Type your own hours to override the suggestion — that number is what the planner uses, and the ↺ chip drops back to the suggestion. Over time we'll use your edits to personalize future estimates to you specifically."},
                {heading:"Save vs. Save & Replan",body:"Save just saves. Save & Replan also updates your calendar right away."},
              ]}
            />
          )}
        </div>
      )}

      {view==="sync"&&(
        <div>
          <div style={BOX}>
          <div style={TITLE_ROW}>
            <div style={TITLE_LEFT}>
              <i className="ti ti-refresh" style={TITLE_ICON}/>
              <span style={TITLE_TEXT}>Update Syllabus</span>
            </div>
          </div>
          <div style={DIVIDER}/>
          <div style={INNER}>
            <p style={{fontSize:14,marginBottom:14,lineHeight:1.6}}>
              Upload a syllabus (or class schedule) PDF — classes, assignments, exams, and grading weights are all extracted from whatever's in the document. Existing courses and deadlines are never duplicated.
            </p>

            {/* Last sync marker — persists across reloads */}
            {data.lastSyllabusSync&&(
              <div style={{
                display:"flex",alignItems:"flex-start",gap:10,
                padding:"10px 13px",background:"var(--green-bg)",borderRadius:9,marginBottom:14
              }}>
                <i className="ti ti-circle-check" style={{color:"var(--green)",fontSize:16,flexShrink:0,marginTop:1}}/>
                <div style={{fontSize:13,color:"var(--green)",lineHeight:1.6}}>
                  <div>Last synced: <strong>{new Date(data.lastSyllabusSync.at).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}</strong></div>
                  <div style={{color:"var(--t2)",marginTop:2}}>
                    {data.lastSyllabusSync.files?.join(", ")||"unknown file"} — {data.lastSyllabusSync.added} new item{data.lastSyllabusSync.added===1?"":"s"} added
                  </div>
                  {data.lastSyllabusSync.coursesFound?.length>0&&(
                    <div style={{color:"var(--t3)",marginTop:2,fontSize:12}}>
                      Courses found: {data.lastSyllabusSync.coursesFound.join(", ")}
                    </div>
                  )}
                </div>
              </div>
            )}

            <PdfDrop label="Syllabus or Schedule PDFs" hint="Select one or more PDF files" files={sylPdfs} onFiles={setSylPdfs} multi/>
            {sylPdfs.length>0&&(
              <>
                <button className="btn btn-action" style={{width:"100%",marginTop:4,justifyContent:"center"}} onClick={syncSyl} disabled={syncing||busy||rawExtracting}>
                  {(syncing||busy)&&progress?<><Sp/> {progress.label}</>:(syncing||busy)?<><Sp/> Working...</>:<><i className="ti ti-refresh"/> Update Syllabus</>}
                </button>
                <button className="btn btn-ghost" style={{width:"100%",marginTop:8,fontSize:13}} onClick={rawExtract} disabled={syncing||busy||rawExtracting}>
                  {rawExtracting?<><Sp/> Extracting (diagnostic — nothing will be saved)...</>:<><i className="ti ti-bug"/> Show Raw AI Extraction (diagnostic — nothing saved)</>}
                </button>
              </>
            )}

            {/* Raw extraction diagnostic result — shows exactly what the AI returned, unfiltered */}
            {rawExtractResult&&(
              <div style={{marginTop:14,background:"var(--card2)",borderRadius:10,padding:"14px 16px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                  <span style={{fontSize:13,fontWeight:600,color:"var(--amber)"}}>Raw AI Extraction Result</span>
                  <button className="btn btn-ghost btn-sm" onClick={()=>setRawExtractResult(null)}>Clear</button>
                </div>
                {rawExtractResult.error?(
                  <div style={{color:"var(--red)",fontSize:13}}>{rawExtractResult.error}</div>
                ):(()=>{
                  const p=rawExtractResult.parsed;
                  const courses=p.courses||[];
                  const totalA=courses.reduce((s,c)=>s+(c.assignments?.length||0),0);
                  const totalE=courses.reduce((s,c)=>s+(c.exams?.length||0),0);
                  return(
                    <>
                      <div style={{fontSize:14,marginBottom:10,color:"var(--t1)"}}>
                        <strong>{courses.length}</strong> courses, <strong>{totalA}</strong> assignments, <strong>{totalE}</strong> exams
                      </div>
                      {courses.map((c,ci)=>(
                        <div key={ci} style={{marginBottom:10,paddingBottom:10,borderBottom:ci<courses.length-1?"1px solid var(--b1)":"none"}}>
                          <div style={{fontSize:14,fontWeight:600,marginBottom:4}}>{c.courseName} — {(c.assignments?.length||0)} assignments, {(c.exams?.length||0)} exams</div>
                          {(c.exams||[]).map((e,ei)=>(
                            <div key={ei} style={{fontSize:12,color:"var(--t3)",paddingLeft:10}}>
                              EXAM: {e.date} — {e.title} {e.weight!=null?`(${e.weight}%)`:""}
                            </div>
                          ))}
                        </div>
                      ))}
                      <details style={{marginTop:8}}>
                        <summary style={{fontSize:12,color:"var(--t3)",cursor:"pointer"}}>Show full raw JSON</summary>
                        <pre style={{fontSize:11,color:"var(--t2)",whiteSpace:"pre-wrap",marginTop:6,maxHeight:300,overflow:"auto"}}>{JSON.stringify(p,null,2)}</pre>
                      </details>
                    </>
                  );
                })()}
              </div>
            )}

            <details style={{marginTop:14}}>
              <summary style={{padding:"8px 13px",background:"var(--card2)",borderRadius:9,fontSize:13,color:"var(--t2)"}}>
                <i className="ti ti-pencil" style={{marginRight:7}}/>Add class manually
              </summary>
              <div className="card" style={{marginTop:8}}>
                <div style={{marginBottom:9}}><label>Course name</label><input value={ncCourse.name} onChange={e=>setNcCourse(c=>({...c,name:e.target.value}))} placeholder="e.g. Principles of Data Science"/></div>
                <div style={{marginBottom:9}}>
                  <label>Format</label>
                  <div className="toggle-group">
                    {[["in-person","In-person"],["hybrid","Hybrid"],["async","Async (no set meetings)"]].map(([v,l])=>(
                      <button key={v} className={`toggle-opt${ncCourse.format===v?" on":""}`}
                        onClick={()=>setNcCourse(c=>({...c,format:v,...(v==="async"?{days:[]}:{})}))}>{l}</button>
                    ))}
                  </div>
                </div>
                {ncCourse.format!=="async"&&(
                  <>
                    <div style={{marginBottom:9}}><label>Class days</label><DayPick val={ncCourse.days} onChange={days=>setNcCourse(c=>({...c,days}))}/></div>
                    <div className="g4" style={{marginBottom:9}}>
                      <div><label>Start</label><input type="time" value={ncCourse.startTime} onChange={e=>setNcCourse(c=>({...c,startTime:e.target.value}))}/></div>
                      <div><label>End</label><input type="time" value={ncCourse.endTime} onChange={e=>setNcCourse(c=>({...c,endTime:e.target.value}))}/></div>
                      <div><label>Difficulty</label><select value={ncCourse.difficulty} onChange={e=>setNcCourse(c=>({...c,difficulty:+e.target.value}))}>{[1,2,3,4,5,6,7,8,9,10].map(n=><option key={n} value={n}>{n}</option>)}</select></div>
                      <div><label>Hrs/wk</label><input type="number" min="1" max="20" value={ncCourse.weeklyHours} onChange={e=>setNcCourse(c=>({...c,weeklyHours:+e.target.value}))}/></div>
                    </div>
                  </>
                )}
                {ncCourse.format==="async"&&(
                  <div className="g2" style={{marginBottom:9}}>
                    <div><label>Difficulty</label><select value={ncCourse.difficulty} onChange={e=>setNcCourse(c=>({...c,difficulty:+e.target.value}))}>{[1,2,3,4,5,6,7,8,9,10].map(n=><option key={n} value={n}>{n}</option>)}</select></div>
                    <div><label>Hrs/wk</label><input type="number" min="1" max="20" value={ncCourse.weeklyHours} onChange={e=>setNcCourse(c=>({...c,weeklyHours:+e.target.value}))}/></div>
                  </div>
                )}
                <button className="btn btn-action btn-sm"
                  onClick={()=>{
                    if(!ncCourse.name)return;
                    if(ncCourse.format!=="async"&&!ncCourse.days.length)return;
                    if(findMatchingCourse(data.courses.filter(c=>c.termId===viewingTermId),ncCourse.name)){toast2("A course with that name already exists",true);return;}
                    upd({courses:[...data.courses,{...ncCourse,name:prettyCourseCode(ncCourse.name),id:uid(),termId:viewingTermId,color:CC[data.courses.length%CC.length]}]});
                    setNcCourse({name:"",days:[],startTime:"09:00",endTime:"10:30",difficulty:5,weeklyHours:4,format:"in-person"});
                    toast2("Class added");
                  }}
                  disabled={!ncCourse.name||(ncCourse.format!=="async"&&!ncCourse.days.length)}>
                  <i className="ti ti-plus"/> Add class
                </button>
              </div>
            </details>
          </div>
          </div>
        </div>
      )}
      {modal}
      <SyncResultModal result={syncResult} planning={planning}
        onClose={()=>{const hadItems=syncResult?.added>0;setSyncResult(null);if(hadItems)setView("difficulty");}}
        onPlanNow={async()=>{await refreshQuarterPlan();setSyncResult(null);setView("difficulty");}}/>
      {pendingVerify&&(
        <ExtractionVerifyModal
          parsed={pendingVerify.parsed}
          courses={data.courses}
          termStart={data.profile?.termStart}
          termEnd={data.profile?.termEnd}
          onConfirm={correctedParsed=>finalizeSync(correctedParsed,pendingVerify.fileNames)}
          onCancel={()=>{setPendingVerify(null);setSylPdfs([]);}}
        />
      )}
    </div>
  );
}
