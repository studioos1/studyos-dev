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
  expectedHoursRange,
} from "@/lib/planner";
import { CI } from "@/lib/api";
import { PDF, MAX_SYLLABUS_CHARS } from "@/lib/pdf";
import { sparkleBurst } from "@/lib/sparkle";
import { reclassifyQuizzesAsExams, applyRecurringSeries, expandRecurringSeries, checkSyllabusExtraction } from "@/lib/syllabus";
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
  ExtractionIssues,
  DelBtn,
  DiffBadge,
  PdfDrop,
  DayPick,
} from "@/components/shared";

// Inline preview of a pending re-research result (B-01) — a shaded strip (background only, no
// border — this is deliberately not another bordered box) directly under the course's own badge
// row. It bleeds edge-to-edge with the card via a negative margin that exactly cancels INNER's
// 20px side padding, so once its own padding is added back, the first badge lands at the same x
// position as the Difficulty badge in the row above — the new values sit exactly under the old
// ones, same order, same gap. Line 1 is the values + actions; line 2 (when present) is the
// rationale. A field only gets the amber highlight (background fill, not an outline) when it
// actually changed — an unchanged field looks exactly like it already did above.
function ResearchPreview({course,info,onApplyAndReplan,onDiscard,planning}){
  const newScore=info.difficultyScore||course.difficulty;
  const newHours=info.weeklyStudyHours||course.weeklyHours;
  const newPrep=info.startExamPrepDays||course.startExamPrepDays;
  const newLabel=info.difficultyLabel||course.difficultyLabel;
  const diffChanged=newScore!==course.difficulty||(info.difficultyLabel&&info.difficultyLabel!==course.difficultyLabel);
  const hoursChanged=newHours!==course.weeklyHours;
  const prepChanged=newPrep!==course.startExamPrepDays;
  const anyChanged=diffChanged||hoursChanged||prepChanged;
  // Deterministic sanity check (not another AI call) — flags when the two numbers this same
  // result claims together don't actually line up, e.g. "Heavy" but well below what Heavy courses
  // typically take. Never blocks Apply; it's a nudge to read the rationale before trusting it.
  const [hMin,hMax]=expectedHoursRange(newScore);
  const hoursOutOfBand=newHours<hMin||newHours>hMax;
  return(
    <div style={{background:"var(--card2)",margin:"2px -20px 10px",padding:"10px 20px"}}>
      <div style={{display:"flex",gap:7,flexWrap:"wrap",alignItems:"center"}}>
        {diffChanged
          ?<span className="badge badge-amber">{newLabel||"Lvl"} {newScore}/10</span>
          :<DiffBadge score={newScore} label={newLabel}/>}
        <span className={`badge ${hoursChanged?"badge-amber":"badge-blue"}`}>{newHours}h/wk study</span>
        {hoursOutOfBand&&(
          <i className="ti ti-alert-triangle tt" data-tt={`${newHours}h/week is unusual for a ${newScore}/10 difficulty — that band is typically ${hMin}–${hMax}h/week. Worth reading the rationale before applying.`}
            style={{fontSize:14,color:"var(--amber)",cursor:"default"}}/>
        )}
        <span className={`badge ${prepChanged?"badge-amber":"badge-teal"}`}>prep {newPrep}d before exams</span>
        {info.confidence&&(
          <span className="tt" data-tt={`Web-researched, ${info.confidence} confidence.${info.rationale?` ${info.rationale}`:""}`}
            style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:11,padding:"3px 8px",borderRadius:6,background:"var(--card)",color:"var(--t3)",cursor:"default"}}>
            <i className="ti ti-search" style={{fontSize:11}}/>{info.confidence} confidence
          </span>
        )}
        <div style={{display:"flex",alignItems:"center",gap:8,marginLeft:"auto"}}>
          {!anyChanged&&!planning&&<span style={{fontSize:11,color:"var(--t3)"}}>no replan needed</span>}
          <button className="btn btn-action btn-sm" onClick={onApplyAndReplan} disabled={planning}>
            {planning?<><Sp sz={12}/> Planning...</>
              :anyChanged?<><i className="ti ti-sparkles"/> Apply &amp; Replan</>
              :<><i className="ti ti-check"/> Confirm</>}
          </button>
        </div>
        <div style={{width:18}}/>
        <button className="tt" data-tt="Cancel — keep current estimate" onClick={onDiscard}
          style={{width:30,height:30,borderRadius:"50%",border:"none",background:"transparent",color:"var(--t3)",
            cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0,flexShrink:0}}>
          <i className="ti ti-x" style={{fontSize:18}}/>
        </button>
      </div>
      {info.rationale&&(
        <div style={{fontSize:11.5,color:"var(--t3)",lineHeight:1.5,marginTop:6}}>{info.rationale}</div>
      )}
    </div>
  );
}

// Shared per-tab "which classes are folded" state — Study Preferences, Assignments, and Exams all
// group their table by class with the same collapse/expand pattern (Class column removed; every
// row's class is implied by its group). Each tab remembers its own folded set independently (a
// distinct sessionStorage key per tab) so folding one tab's classes doesn't affect another's. A
// transient viewing preference, not account data: sessionStorage keeps it while switching tabs in
// this session, but a fresh visit (reload, new session) always starts fully expanded rather than
// risking a stale folded state the student doesn't remember setting.
function useFoldedClasses(storageKey){
  const [folded,setFolded]=useState(()=>{
    try{return new Set(JSON.parse(sessionStorage.getItem(storageKey)||"[]"));}catch{return new Set();}
  });
  function persist(next){try{sessionStorage.setItem(storageKey,JSON.stringify([...next]));}catch{}}
  function toggle(courseId){
    setFolded(prev=>{
      const next=new Set(prev);
      if(next.has(courseId))next.delete(courseId);else next.add(courseId);
      persist(next);
      return next;
    });
  }
  function setAll(courseIds,shouldFold){
    const next=shouldFold?new Set(courseIds):new Set();
    persist(next);
    setFolded(next);
  }
  return{folded,toggle,setAll};
}

// ── ACADEMICS ────────────────────────────────────────────────────────────────
export function Acad({data,upd,ai,busy,planning,toast2,progress,setProgress,refreshQuarterPlan,planMsg,helpJump,viewedTerm:viewedTermProp}){
  const {confirm,modal}=useConfirm();
  const [view,setView]=useState("courses");
  // Deep-link target from the Help drawer's "Take me there" (components/shared/HelpDrawer.jsx) —
  // same {tab,sec,token} shape and same "keyed on token, not the value" reasoning as Sett.jsx's
  // identical effect; see that one's comment for why.
  useEffect(()=>{
    if(helpJump?.tab==="acad"&&helpJump.sec)setView(helpJump.sec);
  },[helpJump?.token]); // eslint-disable-line
  const [showDiffHelp,setShowDiffHelp]=useState(false);
  const [showCourseHelp,setShowCourseHelp]=useState(false);
  const [showAddAssign,setShowAddAssign]=useState(false);
  const [showAddExam,setShowAddExam]=useState(false);
  const [editId,setEditId]=useState(null);
  const [na,setNa]=useState({course:"",title:"",dueDate:"",estimatedHours:2,status:"not-started"});
  const [ed,setEd]=useState({course:"",title:"",dueDate:"",estimatedHours:2}); // separate edit state
  const [ne,setNe]=useState({course:"",date:"",topics:"",prepDays:7});
  const [editExamId,setEditExamId]=useState(null);
  const termStatuses=computeTermStatuses(data.terms);
  const currentTerm=termStatuses.find(t=>t.status==="current")||null;
  // Which term this tab shows/edits — the global term-viewer's header dropdown (App.jsx), passed
  // down as `viewedTerm`. Falls back to Current if App.jsx hasn't resolved one yet (e.g. very first
  // render before data settles) so this never silently shows nothing. `viewingTermId` kept as the
  // name used by every filter below (unchanged from the earlier single-term version) purely to keep
  // this a small diff — it's real, App.jsx-driven state now, not the alias it briefly was.
  const viewedTerm=viewedTermProp||currentTerm;
  const viewingTermId=viewedTerm?.id||null;
  // Archived terms are read-only, full stop (real rule: "Archive - Read Only") — App.jsx's
  // updViewedOrBlock already refuses any write attempted while viewing one (the correctness
  // backstop, in case a control below is missed), this just drives the UI: banner + disabling the
  // clearest "start something new" entry points (Add Course, Upload Syllabus, Reset Academic Data,
  // Add Assignment/Exam) so the student isn't invited to try in the first place.
  const readOnly=viewedTerm?.status==="archived";
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

  // See useFoldedClasses above — one independent fold-state instance per grouped-by-class tab.
  const diffFold=useFoldedClasses("studyos_difftab_folded");
  const assignFold=useFoldedClasses("studyos_assigntab_folded");
  const examFold=useFoldedClasses("studyos_examtab_folded");

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

  // Re-runs the web-search-backed difficulty lookup (B-01) on a course that already exists —
  // courses created before that shipped, or ones a student just wants refreshed, have no
  // confidence/rationale to show otherwise. Rather than overwriting the course silently, the
  // fresh result is held for review (pendingResearch) and shown inline as a ResearchPreview right
  // under that course's own badge row — old vs new, changed fields highlighted — so the student
  // sees exactly what a "Save & Replan" would apply instead of having to notice the planStale dot
  // afterward and guess what changed.
  const [researchingCourseId,setResearchingCourseId]=useState(null);
  const [pendingResearch,setPendingResearch]=useState(null); // {course,info} awaiting review
  async function reResearchCourse(course){
    setResearchingCourseId(course.id);
    try{
      const info=await CI(course.name,null,data.profile?.schoolName);
      setPendingResearch({course,info});
    }catch{
      toast2("Couldn't research this course right now",true);
    }
    setResearchingCourseId(null);
  }
  // Writes the reviewed result onto the course; never touches assignments/exams/grades. Returns
  // whether anything that actually feeds the planner changed, so callers can skip flagging
  // planStale (and skip the "replan" step) when the search just confirmed the existing estimate.
  function commitPendingResearch(){
    const {course,info}=pendingResearch;
    const changed=(info.difficultyScore&&info.difficultyScore!==course.difficulty)
      ||(info.weeklyStudyHours&&info.weeklyStudyHours!==course.weeklyHours)
      ||(info.startExamPrepDays&&info.startExamPrepDays!==course.startExamPrepDays);
    upd({courses:data.courses.map(c=>c.id===course.id?{...c,
      difficulty:info.difficultyScore||c.difficulty,
      difficultyLabel:info.difficultyLabel||c.difficultyLabel,
      weeklyHours:info.weeklyStudyHours||c.weeklyHours,
      startExamPrepDays:info.startExamPrepDays||c.startExamPrepDays,
      description:info.description||c.description,
      tips:info.tips?.length?info.tips:c.tips,
      difficultyConfidence:info.confidence||"low",
      difficultyRationale:info.rationale||"",
    }:c),...(changed?{planStale:true}:{})});
    setPendingResearch(null);
    return changed;
  }
  async function applyResearchAndReplan(){
    const changed=commitPendingResearch();
    if(changed){
      await refreshQuarterPlan();
      toast2("Difficulty updated and plan refreshed");
    }else{
      toast2("Estimate confirmed — nothing changed");
    }
  }
  function discardResearch(){
    setPendingResearch(null);
    toast2("Kept the existing estimate");
  }


  // Clears academic data (courses/assignments/exams + cached briefing) AND this term's own
  // calendar — keeps profile, other terms, History, and habit logs intact (an explicit,
  // established promise of THIS reset — narrower in scope than School Info's own per-term Reset,
  // which also wipes completion history and Pomodoro logs; kept that way on purpose, not touched
  // here). Real, reported bug: "after Reset academic data... the calendar still shows study
  // plans." This used to only clear courses/assignments/exams, leaving every study-plan block that
  // referenced them (or just sat on this term's dates) as calendar debris. Fixed simply now — this
  // term owns its own isolated studyPlan (see applyTermScopedPatch, lib/data/terms.js), so a flat
  // studyPlan:{weeks:{}} here is automatically mirrored into the CURRENT term's own copy, nothing
  // else's. No more date-range scrubbing needed.
  async function resetAcademic(){
    const total=termCourses.length+termAssignments.length+termExams.length;
    if(total===0){toast2("Nothing academic to clear for this term — you're already starting fresh.");return;}
    const ok=await confirm(`Clear ${termCourses.length} course${termCourses.length!==1?"s":""}, ${termAssignments.length} assignment${termAssignments.length!==1?"s":""}, and ${termExams.length} exam${termExams.length!==1?"s":""} for this term only — including this term's own study plan on the calendar? Other terms, your profile, routine settings, History, and habit logs (gym/check-ins/focus sessions) will NOT be touched. This can't be undone.`);
    if(!ok)return;
    upd({
      courses:data.courses.filter(c=>!termCourseIds.has(c.id)),
      assignments:data.assignments.filter(a=>!termCourseIds.has(a.courseId)),
      exams:data.exams.filter(e=>!termCourseIds.has(e.courseId)),
      studyPlan:{weeks:{}},
      briefCache:null,briefPeriod:null,
    });
    toast2("This term's academic data and study plan cleared — other terms, profile, and history kept!");
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
      const ad=a.dueDate&&a.dueDate.length===10,bd=b.dueDate&&b.dueDate.length===10;
      if(assignSort==="weight")return(b.weight??-1)-(a.weight??-1);
      // "due" default
      if(!ad&&!bd)return 0;if(!ad)return 1;if(!bd)return -1;
      return new Date(a.dueDate)-new Date(b.dueDate);
    });
  }
  const active=sortAssignments(termAssignments.filter(a=>a.status!=="done"));
  const done=sortAssignments(termAssignments.filter(a=>a.status==="done"));
  const total=termAssignments.length;

  // Groups an already-sorted flat list by courseId, preserving each course's first-appearance
  // order — since the list is pre-sorted (by due/weight), the group containing the most-urgent/
  // highest-weight item naturally appears first, matching Study Preferences' own group-ordering
  // without a second sort pass. Shared by Assignments and Exams — neither has its own Class
  // column anymore (every row's class is implied by its group instead).
  function groupByCourse(list){
    const byCourse=new Map();
    list.forEach(item=>{
      if(!byCourse.has(item.courseId))byCourse.set(item.courseId,{courseId:item.courseId,courseName:courseNameFor(data.courses,item.courseId),items:[]});
      byCourse.get(item.courseId).items.push(item);
    });
    return[...byCourse.values()].map(g=>{
      const course=termCourses.find(c=>c.id===g.courseId);
      return{...g,color:course?.color?.border||"var(--t3)"};
    });
  }
  const assignGroups=groupByCourse(active);
  const assignGroupIds=assignGroups.map(g=>g.courseId);
  const assignAllFolded=assignGroupIds.length>0&&assignGroupIds.every(id=>assignFold.folded.has(id));
  const doneAssignGroups=groupByCourse(done);

  function sortExams(list){
    return[...list].sort((a,b)=>{
      if(examSort==="weight")return(b.weight??-1)-(a.weight??-1);
      if(examSort==="prep")return(b.prepDays??0)-(a.prepDays??0);
      return(a.date||"9999").localeCompare(b.date||"9999"); // "due" default
    });
  }
  const upcomingExams=sortExams(termExams.filter(e=>!e.date||e.date>=iso()));
  const completedExams=sortExams(termExams.filter(e=>e.date&&e.date<iso()));
  const upcomingExamGroups=groupByCourse(upcomingExams);
  const completedExamGroups=groupByCourse(completedExams);
  const examGroupIds=upcomingExamGroups.map(g=>g.courseId);
  const examAllFolded=examGroupIds.length>0&&examGroupIds.every(id=>examFold.folded.has(id));

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
      const texts=await Promise.all(sylPdfs.map(async f=>{const t=await PDF(f);return `\n=== ${f.name} ===\n${t.slice(0,MAX_SYLLABUS_CHARS)}`;}));
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
8. The "exams" list covers every in-class/timed assessment: Midterm(s), Final Exam, AND any Quiz (weekly reading quiz, in-class pop quiz, lecture quiz, lab-section quiz, etc.) — even a short, low-weight one. Only take-home coursework (problem sets, homework, labs, projects) belongs in "assignments". Give a quiz a short prepDays (2-3), not a Midterm/Final's longer one — it's a low-stakes, low-prep check, not a major exam.
9. NEVER invent or guess a due date. Rules 1/3/4 above ("extract every dated item", "count them", "return that many entries") apply ONLY to items whose real due date is actually written in the source text — they are not license to fabricate one. If the syllabus describes a recurring assignment type in general terms (e.g. "Labs are due weekly on Tuesdays — see the course website for the exact schedule") without ever stating a real calendar date for any individual instance, omit that whole category rather than guessing dates for it — return fewer items, or none for that category, rather than a fabricated schedule. A hard tell that you're about to invent dates: giving several differently-numbered items (Homework 1, Homework 2, Lab 3, ...) the exact same due date — a real weekly series is never all due on one day. If you notice that pattern in your own answer before responding, delete those entries instead of returning them.
10. Before answering, work through the document's own section headers one at a time (Assignments, Homework, Labs, Quizzes, Exams, Projects, Grading/Grades, Schedule/Calendar, or whatever it actually calls them) — for each, either extract its items or note why you didn't. Return that as "extractionNotes": a short array of strings, one per graded category you did NOT get individually dated items for, saying why (e.g. "Midterm Project — mentioned but no due date stated anywhere in this document"). This is a completeness self-report the student will see, not a place to guess — if you genuinely extracted everything gradeable with a real date, return an empty array. A category with an explicit recurring weekly day-of-week pattern (e.g. "due every Tuesday") is NOT an extractionNotes case — see rule 11.
11. If the syllabus states a recurring WEEKLY due-day pattern for a category without individual per-item dates (e.g. "Labs are due weekly on Tuesdays", "Homework due Thursdays") — a real stated pattern, not a guess — return it as a "recurringSeries" entry instead of either inventing dates (rule 9) or only noting it in extractionNotes (rule 10): {"title":<singular category name, e.g. "Lab" or "Homework">,"dayOfWeek":<0-6, 0=Sunday>,"weightTotal":<category's total % weight from the grading table, or null if not stated>}. The app deterministically generates the actual dated instances from this pattern — do NOT also list guessed individual dates for the same category in "assignments", and do NOT duplicate it in extractionNotes. Only use this for a genuinely stated weekly pattern with a clear day of week; an irregular or unspecified-day category still only gets an extractionNotes line.
12. Also extract the instructor and any teaching assistant(s), if the syllabus states them (commonly near the top, in a "Course Staff", "Instructor(s)", "Teaching Team", or "Contacts" section) — "instructor" (the primary instructor's name, or null if not stated) and "ta" (name(s) of TA(s)/tutors, comma-separated if multiple, or null if not stated) on the course object, alongside courseName. Never guess a name that isn't explicitly written in the document.

Example of a CORRECT response shape for a course with 8 weekly assignments and 4 exams — note Reading Quiz 1 is an exam, not an assignment, despite its low weight; Labs have a stated weekly pattern (Tuesdays) so they're a recurringSeries entry, not a guessed date or an extractionNotes line; Midterm Project has no date or pattern at all, so it's an extractionNotes line (yours should look like this in structure, with real data from the syllabus):
{"courses":[{"courseName":"DSC 10","instructor":"Dr. Jane Smith","ta":"Alex Chen, Priya Patel","meetingTimes":[
  {"days":[1,3,5],"startTime":"10:00","endTime":"10:50","location":"Center Hall 101","type":"Lecture"},
  {"days":[2],"startTime":"17:00","endTime":"17:50","location":"York Hall 2622","type":"Discussion Section"}
],"assignments":[
  {"title":"Problem Set 1","dueDate":"2026-09-25","estimatedHours":2,"weight":3},
  {"title":"Problem Set 2","dueDate":"2026-10-02","estimatedHours":2,"weight":3},
  {"title":"Problem Set 3","dueDate":"2026-10-09","estimatedHours":2,"weight":3},
  {"title":"Problem Set 4","dueDate":"2026-10-16","estimatedHours":2,"weight":3},
  {"title":"Problem Set 5","dueDate":"2026-10-30","estimatedHours":2,"weight":3},
  {"title":"Problem Set 6","dueDate":"2026-11-06","estimatedHours":2,"weight":3},
  {"title":"Problem Set 7","dueDate":"2026-11-13","estimatedHours":2,"weight":3},
  {"title":"Problem Set 8","dueDate":"2026-12-04","estimatedHours":2,"weight":3}
],"exams":[
  {"title":"Reading Quiz 1","date":"2026-09-28","topics":"Ch 1","prepDays":2,"weight":2},
  {"title":"Midterm 1","date":"2026-10-23","topics":"Ch 1-3","prepDays":5,"weight":25},
  {"title":"Midterm 2","date":"2026-11-20","topics":"Ch 4-6","prepDays":5,"weight":25},
  {"title":"Final Exam","date":"2026-12-09","topics":"All chapters","prepDays":7,"weight":30}
],"recurringSeries":[{"title":"Lab","dayOfWeek":2,"weightTotal":15}],"extractionNotes":["Midterm Project (10%) — mentioned but no due date stated anywhere in this document"]}]}

Now extract the real data from the syllabi below, following that same exhaustive pattern for EACH course found:
SYLLABI:\n${texts.join("\n")}`,8000,{model:"claude-opus-5"});
      if(t){
        const p=JSON.parse(t.replace(/```json|```/g,"").trim());
        setRawExtractResult({parsed:p,fileNames,sourceText:texts.join("\n")});
      }
    }catch(e){setRawExtractResult({error:e.message,fileNames});}
    setRawExtracting(false);
  }

  async function syncSyl(){
    if(!sylPdfs.length)return;setSyncing(true);
    const fileNames=sylPdfs.map(f=>f.name);
    setProgress?.({label:"Reading PDF...",detail:fileNames.join(", ")});
    try{
      const texts=await Promise.all(sylPdfs.map(async f=>{const t=await PDF(f);return `\n=== ${f.name} ===\n${t.slice(0,MAX_SYLLABUS_CHARS)}`;}));
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
8. The "exams" list covers every in-class/timed assessment: Midterm(s), Final Exam, AND any Quiz (weekly reading quiz, in-class pop quiz, lecture quiz, lab-section quiz, etc.) — even a short, low-weight one. Only take-home coursework (problem sets, homework, labs, projects) belongs in "assignments". Give a quiz a short prepDays (2-3), not a Midterm/Final's longer one — it's a low-stakes, low-prep check, not a major exam.
9. NEVER invent or guess a due date. Rules 1/3/4 above ("extract every dated item", "count them", "return that many entries") apply ONLY to items whose real due date is actually written in the source text — they are not license to fabricate one. If the syllabus describes a recurring assignment type in general terms (e.g. "Labs are due weekly on Tuesdays — see the course website for the exact schedule") without ever stating a real calendar date for any individual instance, omit that whole category rather than guessing dates for it — return fewer items, or none for that category, rather than a fabricated schedule. A hard tell that you're about to invent dates: giving several differently-numbered items (Homework 1, Homework 2, Lab 3, ...) the exact same due date — a real weekly series is never all due on one day. If you notice that pattern in your own answer before responding, delete those entries instead of returning them.
10. Before answering, work through the document's own section headers one at a time (Assignments, Homework, Labs, Quizzes, Exams, Projects, Grading/Grades, Schedule/Calendar, or whatever it actually calls them) — for each, either extract its items or note why you didn't. Return that as "extractionNotes": a short array of strings, one per graded category you did NOT get individually dated items for, saying why (e.g. "Midterm Project — mentioned but no due date stated anywhere in this document"). This is a completeness self-report the student will see, not a place to guess — if you genuinely extracted everything gradeable with a real date, return an empty array. A category with an explicit recurring weekly day-of-week pattern (e.g. "due every Tuesday") is NOT an extractionNotes case — see rule 11.
11. If the syllabus states a recurring WEEKLY due-day pattern for a category without individual per-item dates (e.g. "Labs are due weekly on Tuesdays", "Homework due Thursdays") — a real stated pattern, not a guess — return it as a "recurringSeries" entry instead of either inventing dates (rule 9) or only noting it in extractionNotes (rule 10): {"title":<singular category name, e.g. "Lab" or "Homework">,"dayOfWeek":<0-6, 0=Sunday>,"weightTotal":<category's total % weight from the grading table, or null if not stated>}. The app deterministically generates the actual dated instances from this pattern — do NOT also list guessed individual dates for the same category in "assignments", and do NOT duplicate it in extractionNotes. Only use this for a genuinely stated weekly pattern with a clear day of week; an irregular or unspecified-day category still only gets an extractionNotes line.
12. Also extract the instructor and any teaching assistant(s), if the syllabus states them (commonly near the top, in a "Course Staff", "Instructor(s)", "Teaching Team", or "Contacts" section) — "instructor" (the primary instructor's name, or null if not stated) and "ta" (name(s) of TA(s)/tutors, comma-separated if multiple, or null if not stated) on the course object, alongside courseName. Never guess a name that isn't explicitly written in the document.

Example of a CORRECT response shape for a course with 8 weekly assignments and 4 exams — note Reading Quiz 1 is an exam, not an assignment, despite its low weight; Labs have a stated weekly pattern (Tuesdays) so they're a recurringSeries entry, not a guessed date or an extractionNotes line; Midterm Project has no date or pattern at all, so it's an extractionNotes line (yours should look like this in structure, with real data from the syllabus):
{"courses":[{"courseName":"DSC 10","instructor":"Dr. Jane Smith","ta":"Alex Chen, Priya Patel","meetingTimes":[
  {"days":[1,3,5],"startTime":"10:00","endTime":"10:50","location":"Center Hall 101","type":"Lecture"},
  {"days":[2],"startTime":"17:00","endTime":"17:50","location":"York Hall 2622","type":"Discussion Section"}
],"assignments":[
  {"title":"Problem Set 1","dueDate":"2026-09-25","estimatedHours":2,"weight":3},
  {"title":"Problem Set 2","dueDate":"2026-10-02","estimatedHours":2,"weight":3},
  {"title":"Problem Set 3","dueDate":"2026-10-09","estimatedHours":2,"weight":3},
  {"title":"Problem Set 4","dueDate":"2026-10-16","estimatedHours":2,"weight":3},
  {"title":"Problem Set 5","dueDate":"2026-10-30","estimatedHours":2,"weight":3},
  {"title":"Problem Set 6","dueDate":"2026-11-06","estimatedHours":2,"weight":3},
  {"title":"Problem Set 7","dueDate":"2026-11-13","estimatedHours":2,"weight":3},
  {"title":"Problem Set 8","dueDate":"2026-12-04","estimatedHours":2,"weight":3}
],"exams":[
  {"title":"Reading Quiz 1","date":"2026-09-28","topics":"Ch 1","prepDays":2,"weight":2},
  {"title":"Midterm 1","date":"2026-10-23","topics":"Ch 1-3","prepDays":5,"weight":25},
  {"title":"Midterm 2","date":"2026-11-20","topics":"Ch 4-6","prepDays":5,"weight":25},
  {"title":"Final Exam","date":"2026-12-09","topics":"All chapters","prepDays":7,"weight":30}
],"recurringSeries":[{"title":"Lab","dayOfWeek":2,"weightTotal":15}],"extractionNotes":["Midterm Project (10%) — mentioned but no due date stated anywhere in this document"]}]}

Now extract the real data from the syllabi below, following that same exhaustive pattern for EACH course found:
SYLLABI:\n${texts.join("\n")}`,8000,{model:"claude-opus-5"});
      if(t){
        const parsed=JSON.parse(t.replace(/```json|```/g,"").trim());
        const{courses:reclassified,moved}=reclassifyQuizzesAsExams(parsed.courses);
        // Expands any "recurringSeries" the AI reported (rule 11 — a stated weekly due-day
        // pattern, e.g. "Labs due Tuesdays", with no individual dates) into real dated
        // assignment rows via deterministic date math, anchored on this student's actual term.
        const{courses:withRecurring,generated}=applyRecurringSeries(reclassified,{termStart:data.profile?.termStart,termEnd:data.profile?.termEnd});
        const p={...parsed,courses:withRecurring};
        if(moved>0)console.log(`StudyOS: reclassified ${moved} quiz-titled item(s) from assignments to exams (safety check, not an error)`);
        if(generated>0)console.log(`StudyOS: generated ${generated} item(s) from a stated recurring weekly pattern`);
        // Pause here — show the student what was found before anything is saved. finalizeSync()
        // (below) does the actual save, once they confirm (with any corrections) or cancel.
        // sourceText carried through for ExtractionVerifyModal's completeness cross-check
        // (checkSyllabusExtraction's scanForDatedItemSignals) — the same raw text sent to the AI.
        setPendingVerify({parsed:p,fileNames,sourceText:texts.join("\n")});
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
    let added=0,skippedDuplicate=0,coursesCreated=0,replaced=0;
    const nA=[],nE=[],newCourses=[];
    // id -> patch, for rows the student explicitly chose "Keep recent" on in ExtractionVerifyModal
    // (findProbableDuplicate flagged a probable match, not an exact one, so the OLD exact-match
    // check just below never would have caught these on its own). Applied over data.assignments/
    // data.exams at the upd() call below, preserving the existing item's id/status/completedAt —
    // this UPDATES it in place rather than adding a second entry.
    const replaceAssignments=new Map(),replaceExams=new Map();
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
          professor:c.instructor||"",ta:c.ta||"",room:primary?.location||"",units:4,
          difficulty:info.difficultyScore||5,difficultyLabel:info.difficultyLabel||"Medium",
          weeklyHours:info.weeklyStudyHours||5,startExamPrepDays:info.startExamPrepDays||5,
          description:info.description||"",tips:info.tips||[],
          difficultyConfidence:info.confidence||"low",difficultyRationale:info.rationale||"",
          color:CC[workingCourses.length%CC.length],
        };
        workingCourses=[...workingCourses,course];
        newCourses.push(course);
        coursesCreated++;
      }else{
        // Course already exists — backfill anything it's still missing from an earlier, less
        // complete sync (schedule, instructor, TA), without touching any field it already has.
        const patch={};
        if((!course.days||course.days.length===0)&&primary){
          patch.days=primary.days||[];patch.startTime=primary.startTime||course.startTime;patch.endTime=primary.endTime||course.endTime;patch.room=course.room||primary.location||"";
        }
        if(!course.professor&&c.instructor)patch.professor=c.instructor;
        if(!course.ta&&c.ta)patch.ta=c.ta;
        if(Object.keys(patch).length){
          workingCourses=workingCourses.map(x=>x.id===course.id?{...x,...patch}:x);
          course=workingCourses.find(x=>x.id===course.id);
        }
      }
      itemsByCourse[c.courseName]={assignments:0,exams:0};
      for(const[i,a]of(c.assignments||[]).entries()){
        if(!a.dueDate)continue;
        const est=await computeEstimateFields(a,course,"homework");
        // Conservative first guess at project-type work — the student confirms/flips it with the
        // Homework⇄Project toggle in Study Preferences.
        const looksLikeProject=/\b(project|capstone|portfolio|thesis|dissertation|term paper|research paper|final paper)\b/i.test(a.title||"");
        if(a._replaceId){
          replaceAssignments.set(a._replaceId,{title:a.title,dueDate:a.dueDate,weight:a.weight??null,estimatedHours:est.aiHours,...(looksLikeProject?{type:"project"}:{}),...est});
          replaced++;itemsByCourse[c.courseName].assignments++;continue;
        }
        const isDup=data.assignments.find(x=>x.courseId===course.id&&norm(x.title)===norm(a.title)&&x.dueDate===a.dueDate);
        if(isDup){skippedDuplicate++;continue;}
        nA.push({id:uid(),courseId:course.id,title:a.title,dueDate:a.dueDate,weight:a.weight??null,estimatedHours:est.aiHours,status:"not-started",...(looksLikeProject?{type:"project"}:{}),...est});
        added++;itemsByCourse[c.courseName].assignments++;
      }
      for(const[i,e]of(c.exams||[]).entries()){
        if(!e.date)continue;
        const est=await computeEstimateFields(e,course,"exam");
        if(e._replaceId){
          replaceExams.set(e._replaceId,{title:e.title,date:e.date,topics:e.topics||"",weight:e.weight??null,prepDays:e.prepDays||7,estimatedHours:est.aiHours,...est});
          replaced++;itemsByCourse[c.courseName].exams++;continue;
        }
        const isDup=data.exams.find(x=>x.courseId===course.id&&x.date===e.date);
        if(isDup){skippedDuplicate++;continue;}
        nE.push({id:uid(),courseId:course.id,title:e.title,date:e.date,topics:e.topics||"",weight:e.weight??null,prepDays:e.prepDays||7,status:"not-started",estimatedHours:est.aiHours,...est});
        added++;itemsByCourse[c.courseName].exams++;
      }
    }

    upd({
      courses:workingCourses,
      // Replacements are applied over the EXISTING array (preserving id/status/completedAt on
      // whichever item matched) before the genuinely-new items are appended.
      assignments:[...data.assignments.map(x=>replaceAssignments.has(x.id)?{...x,...replaceAssignments.get(x.id)}:x),...nA],
      exams:[...data.exams.map(x=>replaceExams.has(x.id)?{...x,...replaceExams.get(x.id)}:x),...nE],
      lastSyllabusSync:{at:new Date().toISOString(),files:fileNames,added,coursesFound:p.courses?.map(c=>c.courseName)||[]}
    });
    setSyncResult({added,skippedDuplicate,replaced,coursesFound:p.courses?.map(c=>c.courseName)||[],coursesCreated,itemsByCourse,fileNames});
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
  // action icons sit flush right instead of floating in a wide empty column. Class column removed
  // — the table is now grouped by class (fold header per group, like Study Preferences), so it
  // was pure repetition; removing it both cuts real clutter and gives the flexible title column
  // that much more room before horizontal scroll ever kicks in.
  const ASSIGN_COLS=(
    <colgroup>
      <col style={{width:36}}/>{/* status box */}
      <col/>{/* assignment title */}
      <col style={{width:104}}/>{/* due */}
      <col style={{width:70}}/>{/* weight */}
      <col style={{width:132}}/>{/* grade */}
      <col style={{width:88}}/>{/* actions */}
    </colgroup>
  );

  // Same table-layout:fixed pattern as ASSIGN_COLS above, and for the same reason: without it,
  // auto layout leaves leftover width unclaimed instead of giving it to the columns that should
  // flex/grow. Class column removed here too (grouped by class now, same as Assignments) — the
  // width it freed went to Topics specifically, on request, since real topic text ("Cumulative;
  // material through Week 4, held during enrolled lecture slot") was wrapping to several lines at
  // the old 170px; Exam title rarely needs more than a couple words ("Midterm Exam", "Quiz 3") so
  // it stays the flexible <col/> rather than the one that gets the extra room.
  const EXAM_COLS=(
    <colgroup>
      <col/>{/* exam title */}
      <col style={{width:260}}/>{/* topics */}
      <col style={{width:100}}/>{/* due */}
      <col style={{width:65}}/>{/* weight */}
      <col style={{width:120}}/>{/* grade */}
      <col style={{width:85}}/>{/* actions */}
    </colgroup>
  );

  // GPA table: unlike Assignments/Exams, a course name doesn't need a genuinely unbounded
  // column — leaving Class as the flexible <col/> made it balloon on the horizontal-scroll
  // fallback (whatever's left over after the other three at the table's minWidth), which is what
  // pushed Grade %/Credits/Letter far enough right, and made Credits specifically read as pinned
  // against whatever edge was currently in view after scrolling. All four columns are fixed here
  // instead — no ambiguity about who absorbs leftover space — sized tight enough that the whole
  // table needs far less (ideally no) horizontal scroll on a phone. Class gets ellipsis overflow
  // instead of room to grow, same safety net Assignments/Exams already rely on for long text.
  const GPA_COLS=(
    <colgroup>
      <col style={{width:150}}/>{/* class */}
      <col style={{width:95}}/>{/* grade % */}
      <col style={{width:80}}/>{/* credits */}
      <col style={{width:62}}/>{/* letter */}
    </colgroup>
  );

  // Same fixed-layout pattern as ASSIGN_COLS/EXAM_COLS/GPA_COLS above, applied to the last table
  // in this file still missing it (Difficulty's review table) — same exposure to the same bug
  // class those had before the fix: no table-layout:fixed meant auto-layout, not a deterministic
  // width, for every column. Assignment is the one unconstrained <col/> (the free-text title +
  // icon + EXAM/PROJECT badge chip); everything else gets a width sized to its actual content.
  const DIFF_COLS=(
    <colgroup>
      <col/>{/* assignment */}
      <col style={{width:100}}/>{/* due */}
      <col style={{width:60}}/>{/* weight */}
      <col style={{width:130}}/>{/* type */}
      <col style={{width:70}}/>{/* AI planning */}
      <col style={{width:104}}/>{/* student planning */}
      <col style={{width:150}}/>{/* hours */}
      <col style={{width:60}}/>{/* priority */}
    </colgroup>
  );

  // `short` is only shown below 480px (see .acad-tab-label-short in globals.css) — abbreviated
  // enough that all 6 tabs fit one row within a phone's width with no scrolling needed at all,
  // rather than just being individually smaller and still relying on horizontal scroll.
  const VIEWS=[
    {id:"courses",    l:"Courses",    short:"Courses"},
    {id:"assignments",l:"Assignments",short:"Assign",warn:missing.length>0},
    {id:"exams",      l:"Exams",      short:"Exams"},
    {id:"grades",     l:"GPA",        short:"GPA"},
    {id:"difficulty", l:"Difficulty", short:"Diff",warn:diffDirty||viewedTerm?.planStale},
    {id:"sync",       l:"Update Syllabus",short:"Sync"},
  ];
  const gpa=calcGPA(termCourses);

  return(
    <div className="fade">
      {/* Page header. Which term this tab shows/edits is driven by the GLOBAL term-viewer dropdown
          in the top app header (App.jsx) now, not a per-tab control here — Acad.jsx briefly had its
          own in-tab switcher and it was explicitly reverted ("remove what added before at the
          header 'Courses' + drop down... revert to the original page design") for living in the
          wrong place, not for the concept itself. See viewedTerm/readOnly above. */}
      <div style={{marginBottom:20}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10,position:"relative"}}>
          <h2>Courses</h2>
        </div>
        {/* Tab bar + Review Difficulty button, same row. Below 480px, labels abbreviate (see
            .acad-tab-label-short in globals.css) so all 6 tabs actually fit within the page
            width — no scrolling, no wrapping to a 2nd line. acad-tabs-row's overflow-x:auto stays
            on purely as a defensive fallback, not the primary fix. */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
          <div className="acad-tabs-row" style={{display:"flex",gap:4}}>
            {VIEWS.map(v=>(
              <button key={v.id} className="acad-tab-btn"
                style={{
                  background:view===v.id?"var(--amber-bg)":"var(--card2)",
                  color:view===v.id?"var(--amber)":"var(--t3)"}}
                title={v.id==="sync"?"Upload updated syllabus PDFs":undefined}
                onClick={()=>{setView(v.id);setShowAddAssign(false);setShowAddExam(false);cancelEdit();}}>
                <span className="acad-tab-label-full">{v.l}</span>
                <span className="acad-tab-label-short">{v.short}</span>
                {v.warn&&<span style={{position:"absolute",top:-3,right:-3,width:7,height:7,borderRadius:"50%",background:"var(--red)"}}/>}
              </button>
            ))}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            {view==="courses"&&(
              <button className="tt" data-tt="How this estimate works" onClick={()=>setShowCourseHelp(true)}
                style={{width:26,height:26,borderRadius:"50%",border:"1px solid var(--b1)",background:"var(--card2)",
                  color:"var(--t2)",fontSize:12,fontWeight:600,cursor:"pointer",display:"flex",
                  alignItems:"center",justifyContent:"center",padding:0,flexShrink:0}}>
                ?
              </button>
            )}
          </div>
        </div>
      </div>
      {/* Persistent read-only notice — shown on every tab (not just Sync's own dedicated message)
          while viewing an archived term, so a control left clickable elsewhere in this file always
          has visible context for why it does nothing (App.jsx's updViewedOrBlock is the actual
          backstop that refuses the write either way). Real rule: "Archive - Read Only." */}
      {readOnly&&view!=="sync"&&(
        <div style={{display:"flex",alignItems:"center",gap:8,padding:"9px 13px",background:"var(--card2)",
          color:"var(--t3)",borderRadius:9,fontSize:13,marginBottom:16}}>
          <i className="ti ti-lock" style={{fontSize:14}}/>
          {viewedTerm.name} is archived — read-only. Switch to Current or Upcoming (top header) to make changes.
        </div>
      )}
      {showCourseHelp&&(
        <InfoModal
          title="Course Difficulty & Hours"
          onClose={()=>setShowCourseHelp(false)}
          sections={[
            {heading:"",body:"Each course gets one web-search-backed estimate — not per assignment, just once per course — covering how hard it tends to be and how much time it usually takes."},
            {heading:"Difficulty (1–10)",body:"1-3 Light, 4-6 Medium, 7-8 Heavy, 9-10 Intense. This is what drives each assignment/exam's own difficulty band in Study Preferences."},
            {heading:"Weekly hours",body:"A realistic weekly time commitment outside class, separate from difficulty — a course can be conceptually Heavy without needing the most raw hours, or vice versa. Real courses vary a lot within a band, so the two only loosely track each other."},
            {heading:"Confidence & rationale",body:"🔍 shows how much real evidence the search actually found (reviews, workload discussion) versus a general estimate from the subject/level — hover it to read what it found. \"High\" means it found something concrete, not that it's guaranteed correct."},
            {heading:"Unusual-combination flag",body:"⚠ appears when the hours number looks out of step with the difficulty score (e.g. Heavy but far below what Heavy courses typically take) — a deterministic check, not another AI call. It's a nudge to read the rationale before applying, never a block."},
            {heading:"Re-researching",body:"The 🔄 button re-runs the search and shows old vs new before anything is saved — nothing is ever overwritten silently."},
          ]}
        />
      )}

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
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                {assignGroupIds.length>0&&(
                  <button className="tt" data-tt={assignAllFolded?"Expand all classes":"Collapse all classes"} onClick={()=>assignFold.setAll(assignGroupIds,!assignAllFolded)}
                    style={{width:28,height:28,borderRadius:"50%",border:"1px solid var(--b1)",background:"var(--card2)",
                      color:"var(--t2)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>
                    <i className={`ti ${assignAllFolded?"ti-chevrons-down":"ti-chevrons-up"}`} style={{fontSize:14}}/>
                  </button>
                )}
                {/* "+" button to toggle add form */}
                <button
                  className="tt" data-tt={readOnly?`${viewedTerm.name} is archived — read-only`:"Add new assignment"}
                  onClick={()=>{if(readOnly)return;setShowAddAssign(v=>!v);cancelEdit();}} disabled={readOnly}
                  style={{width:32,height:32,borderRadius:"50%",border:"none",cursor:readOnly?"default":"pointer",
                    background:showAddAssign?"var(--amber)":"var(--card2)",
                    color:showAddAssign?"#1a0e00":"var(--t2)",opacity:readOnly?0.5:1,
                    fontSize:20,display:"flex",alignItems:"center",justifyContent:"center",
                    transition:"all 0.15s",flexShrink:0}}>
                  {showAddAssign?"×":"+"}
                </button>
              </div>
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
                <table style={{width:"100%",minWidth:560,borderCollapse:"collapse",tableLayout:"fixed"}}>
                  {ASSIGN_COLS}
                  <thead>
                    <tr style={{borderBottom:"1px solid var(--b1)"}}>
                      <th></th>
                      <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"left",padding:"0 8px 8px",fontWeight:600}}>Assignment</th>
                      <TableHead label="Due" col="due" sortBy={assignSort} setSortBy={setAssignSort}/>
                      <TableHead label="Weight" col="weight" sortBy={assignSort} setSortBy={setAssignSort}/>
                      <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"left",padding:"0 8px 8px",fontWeight:600}}>Grade</th>
                      <th style={{padding:"0 6px 8px"}}></th>
                    </tr>
                  </thead>
                  <tbody>
              {assignGroups.map(g=>{
                const folded=assignFold.folded.has(g.courseId);
                return(
                  <Fragment key={g.courseId}>
                    <tr style={{borderBottom:"1px solid var(--b1)",background:"var(--card2)",cursor:"pointer"}}
                      onClick={()=>assignFold.toggle(g.courseId)}>
                      <td colSpan={6} style={{padding:"8px 8px"}}>
                        <div style={{display:"flex",alignItems:"center",gap:8,fontSize:13}}>
                          <i className={`ti ${folded?"ti-chevron-right":"ti-chevron-down"}`} style={{fontSize:13,color:"var(--t3)",flexShrink:0}}/>
                          <div style={{width:8,height:8,borderRadius:"50%",background:g.color,flexShrink:0}}/>
                          <span style={{color:"var(--t1)",fontWeight:600}}>{g.courseName}</span>
                          <span style={{color:"var(--t3)"}}>· {g.items.length} item{g.items.length!==1?"s":""}</span>
                          <span style={{marginLeft:"auto",color:"var(--t3)",fontSize:12}}>{folded?"See more":"See less"}</span>
                        </div>
                      </td>
                    </tr>
              {!folded&&g.items.map((a,i,arr)=>{
                const d=(a.dueDate&&a.dueDate.length===10)?du(a.dueDate):null;
                const isEditing=editId===a.id;

                if(isEditing) return(
                  <tr key={a.id}>
                    <td colSpan={6} style={{padding:0}}>
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
                        onClick={e=>{
                          upd({assignments:data.assignments.map(x=>x.id===a.id?{...x,status:"done",completedAt:x.completedAt||new Date().toISOString()}:x)});
                          sparkleBurst(e.currentTarget,"task");
                        }}
                        style={{width:20,height:20,borderRadius:6,border:"2px solid var(--t3)",
                          background:"var(--card2)",cursor:"pointer",flexShrink:0,
                          display:"flex",alignItems:"center",justifyContent:"center",
                          transition:"all 0.15s",color:"transparent",fontSize:12,fontWeight:600}}
                        onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--green)";e.currentTarget.style.background="var(--green-bg)";e.currentTarget.style.color="var(--green)";e.currentTarget.textContent="✓";}}
                        onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--t3)";e.currentTarget.style.background="var(--card2)";e.currentTarget.style.color="transparent";e.currentTarget.textContent="";}}
                      />
                    </td>
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
                  </Fragment>
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
                <table style={{width:"100%",minWidth:560,borderCollapse:"collapse",tableLayout:"fixed"}}>
                  {ASSIGN_COLS}
                  <tbody>
                {doneAssignGroups.map(g=>{
                  const folded=assignFold.folded.has(g.courseId);
                  return(
                    <Fragment key={g.courseId}>
                      <tr style={{borderBottom:"1px solid var(--b1)",background:"var(--card2)",cursor:"pointer"}}
                        onClick={()=>assignFold.toggle(g.courseId)}>
                        <td colSpan={6} style={{padding:"8px 8px"}}>
                          <div style={{display:"flex",alignItems:"center",gap:8,fontSize:13}}>
                            <i className={`ti ${folded?"ti-chevron-right":"ti-chevron-down"}`} style={{fontSize:13,color:"var(--t3)",flexShrink:0}}/>
                            <div style={{width:8,height:8,borderRadius:"50%",background:g.color,flexShrink:0}}/>
                            <span style={{color:"var(--t1)",fontWeight:600}}>{g.courseName}</span>
                            <span style={{color:"var(--t3)"}}>· {g.items.length} item{g.items.length!==1?"s":""}</span>
                            <span style={{marginLeft:"auto",color:"var(--t3)",fontSize:12}}>{folded?"See more":"See less"}</span>
                          </div>
                        </td>
                      </tr>
                {!folded&&g.items.map((a,i,arr)=>(
                  <tr key={a.id} style={{borderBottom:i<arr.length-1?"1px solid var(--b1)":"none"}}>
                    <td style={{padding:"9px 8px"}}>
                      <div style={{width:20,height:20,borderRadius:6,background:"var(--green)",
                        flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                        <i className="ti ti-check" style={{fontSize:12,color:"#052e16",fontWeight:700}}/>
                      </div>
                    </td>
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
                    </Fragment>
                  );
                })}
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
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                {examGroupIds.length>0&&(
                  <button className="tt" data-tt={examAllFolded?"Expand all classes":"Collapse all classes"} onClick={()=>examFold.setAll(examGroupIds,!examAllFolded)}
                    style={{width:28,height:28,borderRadius:"50%",border:"1px solid var(--b1)",background:"var(--card2)",
                      color:"var(--t2)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>
                    <i className={`ti ${examAllFolded?"ti-chevrons-down":"ti-chevrons-up"}`} style={{fontSize:14}}/>
                  </button>
                )}
                <button className="tt" data-tt={readOnly?`${viewedTerm.name} is archived — read-only`:"Add new exam"}
                  onClick={()=>{if(readOnly)return;setShowAddExam(v=>!v);cancelEditExam();}} disabled={readOnly}
                  style={{width:32,height:32,borderRadius:"50%",border:"none",cursor:readOnly?"default":"pointer",
                    background:showAddExam?"var(--amber)":"var(--card2)",
                    color:showAddExam?"#1a0e00":"var(--t2)",opacity:readOnly?0.5:1,
                    fontSize:20,display:"flex",alignItems:"center",justifyContent:"center",
                    transition:"all 0.15s",flexShrink:0}}>
                  {showAddExam?"×":"+"}
                </button>
              </div>
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

                function ExamRow(e,i,arr,isPast){
                  const hasDate=e.date&&e.date.length===10;
                  const d=hasDate?du(e.date):null;
                  const prep=hasDate&&d>0&&d<=e.prepDays;
                  const isEditing=editExamId===e.id;

                  if(isEditing) return(
                    <tr key={e.id}>
                      <td colSpan={6} style={{padding:0}}>
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
                      <td style={{padding:"9px 8px",fontSize:14,color:"var(--t1)",overflowWrap:"break-word"}}>{e.title||"Exam"}</td>
                      <td style={{padding:"9px 8px",fontSize:13,color:"var(--t3)",overflowWrap:"break-word"}}>{e.topics||"—"}</td>
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

                function GroupedExamRows(groups,isPast,fold){
                  return groups.map(g=>{
                    const folded=fold.folded.has(g.courseId);
                    return(
                      <Fragment key={g.courseId}>
                        <tr style={{borderBottom:"1px solid var(--b1)",background:"var(--card2)",cursor:"pointer"}}
                          onClick={()=>fold.toggle(g.courseId)}>
                          <td colSpan={6} style={{padding:"8px 8px"}}>
                            <div style={{display:"flex",alignItems:"center",gap:8,fontSize:13}}>
                              <i className={`ti ${folded?"ti-chevron-right":"ti-chevron-down"}`} style={{fontSize:13,color:"var(--t3)",flexShrink:0}}/>
                              <div style={{width:8,height:8,borderRadius:"50%",background:g.color,flexShrink:0}}/>
                              <span style={{color:"var(--t1)",fontWeight:600}}>{g.courseName}</span>
                              <span style={{color:"var(--t3)"}}>· {g.items.length} item{g.items.length!==1?"s":""}</span>
                              <span style={{marginLeft:"auto",color:"var(--t3)",fontSize:12}}>{folded?"See more":"See less"}</span>
                            </div>
                          </td>
                        </tr>
                        {!folded&&g.items.map((e,i,arr)=>ExamRow(e,i,arr,isPast))}
                      </Fragment>
                    );
                  });
                }

                return(
                  <>
                    {upcomingExamGroups.length>0&&(
                      <>
                        <div style={{fontSize:12,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8,marginTop:4}}>Upcoming</div>
                        <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch",marginBottom:20}}>
                        <table style={{width:"100%",minWidth:780,borderCollapse:"collapse",tableLayout:"fixed"}}>
                          {EXAM_COLS}
                          <thead>
                            <tr style={{borderBottom:"1px solid var(--b1)"}}>
                              <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"left",padding:"0 8px 8px",fontWeight:600}}>Exam</th>
                              <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"left",padding:"0 8px 8px",fontWeight:600}}>Topics</th>
                              <TableHead label="Due" col="due" sortBy={examSort} setSortBy={setExamSort}/>
                              <TableHead label="Weight" col="weight" sortBy={examSort} setSortBy={setExamSort}/>
                              <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"left",padding:"0 8px 8px",fontWeight:600}}>Grade</th>
                              <th style={{width:85}}></th>
                            </tr>
                          </thead>
                          <tbody>
                            {GroupedExamRows(upcomingExamGroups,false,examFold)}
                          </tbody>
                        </table>
                        </div>
                      </>
                    )}
                    {completedExamGroups.length>0&&(
                      <>
                        <div style={{fontSize:12,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Completed</div>
                        <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
                        <table style={{width:"100%",minWidth:780,borderCollapse:"collapse",tableLayout:"fixed"}}>
                          {EXAM_COLS}
                          <tbody>
                            {GroupedExamRows(completedExamGroups,true,examFold)}
                          </tbody>
                        </table>
                        </div>
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
                  {c.ta&&<span style={{color:"var(--t3)"}}> · TA: {c.ta}</span>}
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
                  <button className="tt" data-tt={c.difficultyConfidence?"Re-research this course's difficulty":"Research this course's difficulty online"}
                    onClick={()=>reResearchCourse(c)} disabled={researchingCourseId===c.id}
                    style={{width:28,height:28,borderRadius:"50%",border:"1px solid var(--amber)",background:"var(--amber-bg)",color:"var(--amber)",
                      cursor:researchingCourseId===c.id?"default":"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0,flexShrink:0}}>
                    {researchingCourseId===c.id?<Sp sz={13}/>:<i className="ti ti-refresh" style={{fontSize:15}}/>}
                  </button>
                </div>
                {pendingResearch?.course.id===c.id&&(
                  <ResearchPreview course={c} info={pendingResearch.info} planning={planning}
                    onApplyAndReplan={applyResearchAndReplan} onDiscard={discardResearch}/>
                )}
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
                <table style={{width:"100%",minWidth:387,borderCollapse:"collapse",tableLayout:"fixed"}}>
                  {GPA_COLS}
                  <thead>
                    <tr style={{borderBottom:"1px solid var(--b1)"}}>
                      <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"left",padding:"0 8px 8px",fontWeight:600}}>Class</th>
                      <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"left",padding:"0 8px 8px",fontWeight:600}}>Grade %</th>
                      <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"left",padding:"0 8px 8px",fontWeight:600}}>Credits</th>
                      <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"left",padding:"0 8px 8px",fontWeight:600}}>Letter</th>
                    </tr>
                  </thead>
                  <tbody>
                    {termCourses.map((c,i)=>{
                      const{letter}=letterFromPct(c.grade);
                      return(
                        <tr key={c.id} style={{borderBottom:i<termCourses.length-1?"1px solid var(--b1)":"none"}}>
                          <td style={{padding:"9px 8px"}}>
                            <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>
                              <div style={{width:8,height:8,borderRadius:"50%",background:c.color.border,flexShrink:0}}/>
                              <span style={{fontSize:14,color:"var(--t1)",flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.name}</span>
                            </div>
                          </td>
                          <td style={{padding:"6px 8px"}}>
                            <input type="number" min="0" max="100" placeholder="e.g. 91" style={{fontSize:13,padding:"5px 7px",width:74}}
                              value={c.grade??""}
                              onChange={e=>upd({courses:data.courses.map(x=>x.id===c.id?{...x,grade:e.target.value===""?null:+e.target.value}:x)})}/>
                          </td>
                          <td style={{padding:"6px 8px"}}>
                            <input type="number" min="0.5" max="10" step="0.5" placeholder="4" style={{fontSize:13,padding:"5px 7px",width:58}}
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
      {view==="difficulty"&&(()=>{
        const allItems=diffRatings?Object.entries(diffRatings).filter(([key,r])=>termCourseIds.has(r.courseId)).map(([key,r])=>({key,...r,
          effectiveValue:r.userValue||r.estimatorValue,
          effectiveHours:r.userHours??r.aiHours,
          priority:computePriorityScore(r.dueDate,r.userValue||r.estimatorValue,r.weight)})):[];

        // Same comparator drives both the row order WITHIN a class and the order of the class
        // groups themselves (by that group's own top item) — grouping removes the repeated Class
        // column, but "what's most urgent" still surfaces at a glance. Computed here, above the
        // table, so the title-row Collapse/Expand-all button can see the same group list.
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
        const allFolded=allCourseIds.length>0&&allCourseIds.every(id=>diffFold.folded.has(id));

        return(
        <div>
          <div style={BOX}>
            <div style={TITLE_ROW}>
              <div style={TITLE_LEFT}>
                <i className="ti ti-gauge" style={TITLE_ICON}/>
                <span style={TITLE_TEXT}>Study Preferences</span>
              </div>
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                <button className="tt" data-tt={readOnly?`${viewedTerm.name} is archived — read-only`:"Save changes"} onClick={saveDifficulty} disabled={readOnly||diffComputing||!diffDirty}
                  style={{width:28,height:28,borderRadius:"50%",border:"1px solid var(--b1)",cursor:diffDirty?"pointer":"default",
                    background:diffDirty?"var(--amber-bg)":"var(--card2)",color:diffDirty?"var(--amber)":"var(--t3)",
                    display:"flex",alignItems:"center",justifyContent:"center",padding:0,opacity:diffComputing?0.5:1}}>
                  <i className="ti ti-device-floppy" style={{fontSize:14}}/>
                </button>
                <button className="tt" data-tt={readOnly?`${viewedTerm.name} is archived — read-only`:"Save & Replan — also updates your calendar right away"} onClick={saveDifficultyAndReplan} disabled={readOnly||diffComputing||(!diffDirty&&!viewedTerm?.planStale)||planning}
                  style={{width:28,height:28,borderRadius:"50%",border:"1px solid var(--b1)",cursor:(diffDirty||viewedTerm?.planStale)?"pointer":"default",
                    background:(diffDirty||viewedTerm?.planStale)?"var(--amber-bg)":"var(--card2)",color:(diffDirty||viewedTerm?.planStale)?"var(--amber)":"var(--t3)",
                    display:"flex",alignItems:"center",justifyContent:"center",padding:0,opacity:diffComputing?0.5:1}}>
                  {planning?<Sp sz={13}/>:<i className="ti ti-sparkles" style={{fontSize:14}}/>}
                </button>
                {allCourseIds.length>0&&(
                  <button className="tt" data-tt={allFolded?"Expand all classes":"Collapse all classes"} onClick={()=>diffFold.setAll(allCourseIds,!allFolded)}
                    style={{width:28,height:28,borderRadius:"50%",border:"1px solid var(--b1)",background:"var(--card2)",
                      color:"var(--t2)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>
                    <i className={`ti ${allFolded?"ti-chevrons-down":"ti-chevrons-up"}`} style={{fontSize:14}}/>
                  </button>
                )}
                <button className="tt" data-tt="How this works" onClick={()=>setShowDiffHelp(true)}
                  style={{width:28,height:28,borderRadius:"50%",border:"1px solid var(--b1)",background:"var(--card2)",
                    color:"var(--t2)",fontSize:12,fontWeight:600,cursor:"pointer",display:"flex",
                    alignItems:"center",justifyContent:"center",padding:0}}>
                  ?
                </button>
              </div>
            </div>
            {planning&&planMsg&&<div style={{fontSize:11,color:"var(--t3)",textAlign:"right",padding:"4px 20px 0"}}>{planMsg}</div>}
            {!planning&&viewedTerm?.planStale&&(
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
              ):allItems.length===0?(
                <div style={{color:"var(--t3)",padding:"20px 0"}}>No active assignments or exams to review.</div>
              ):(
                 <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
                  <table style={{width:"100%",minWidth:820,borderCollapse:"collapse",tableLayout:"fixed"}}>
                    {DIFF_COLS}
                    <thead>
                      <tr style={{borderBottom:"1px solid var(--b1)"}}>
                        <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"left",padding:"0 8px 8px",fontWeight:600}}>Assignment</th>
                        <TableHead label="Due" col="due" sortBy={diffSortBy} setSortBy={setDiffSortBy} align="center"/>
                        <TableHead label="Weight" col="weight" sortBy={diffSortBy} setSortBy={setDiffSortBy} align="center"/>
                        <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"left",padding:"0 8px 8px",fontWeight:600}}>Type</th>
                        <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"center",padding:"0 8px 8px",fontWeight:600}}>AI Planning</th>
                        <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"center",padding:"0 8px 8px",fontWeight:600}}>Student Planning</th>
                        <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"left",padding:"0 8px 8px",fontWeight:600}}>Hours</th>
                        <TableHead label="Priority" col="priority" sortBy={diffSortBy} setSortBy={setDiffSortBy}/>
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map(g=>{
                        const folded=diffFold.folded.has(g.courseId);
                        const nextDue=g.items.map(it=>it.dueDate).filter(Boolean).sort()[0];
                        return(
                          <Fragment key={g.courseId}>
                            <tr style={{borderBottom:"1px solid var(--b1)",background:"var(--card2)",cursor:"pointer"}}
                              onClick={()=>diffFold.toggle(g.courseId)}>
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
              )}
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
        );
      })()}

      {view==="sync"&&(
        <div>
          <div style={BOX}>
          <div style={TITLE_ROW}>
            <div style={TITLE_LEFT}>
              <i className="ti ti-refresh" style={TITLE_ICON}/>
              <span style={TITLE_TEXT}>Update Syllabus</span>
            </div>
            {(termCourses.length>0||termAssignments.length>0||termExams.length>0)&&(
              <button className="tt tt-below btn btn-ghost btn-sm" data-tt={readOnly?`${viewedTerm.name} is archived — read-only`:undefined}
                style={{color:"var(--amber)"}} onClick={resetAcademic} disabled={readOnly}>
                <i className="ti ti-eraser"/> Reset academic data
              </button>
            )}
          </div>
          <div style={DIVIDER}/>
          <div style={INNER}>
            <p style={{fontSize:14,marginBottom:14,lineHeight:1.6}}>
              Upload a syllabus (or class schedule) PDF — classes, assignments, exams, and grading weights are all extracted from whatever's in the document. Existing courses and deadlines are never duplicated.
            </p>

            {/* Real request: "upload syllabus to create academic plan shall not be activated if no
                term created." Every course a sync creates is tagged termId:viewingTermId (see
                syncSyl below) — with no Current term, that's null, producing exactly the orphaned-
                course state repairTermLinkageIfNeeded exists to heal elsewhere. Blocking upload
                here instead is the direct fix: nothing to attach a syllabus to until a term exists. */}
            {!currentTerm?(
              <div style={{fontSize:15,color:"var(--t3)",textAlign:"center",padding:"20px 0"}}>
                No term set up yet — add one in School Info before uploading a syllabus.
              </div>
            ):readOnly?(
              <div style={{fontSize:15,color:"var(--t3)",textAlign:"center",padding:"20px 0"}}>
                {viewedTerm.name} is archived — read-only. Switch to Current or Upcoming (top header) to upload or update a syllabus.
              </div>
            ):(<>

            {/* Last sync marker — persists across reloads */}
            {viewedTerm?.lastSyllabusSync&&(
              <div style={{
                display:"flex",alignItems:"flex-start",gap:10,
                padding:"10px 13px",background:"var(--green-bg)",borderRadius:9,marginBottom:14
              }}>
                <i className="ti ti-circle-check" style={{color:"var(--green)",fontSize:16,flexShrink:0,marginTop:1}}/>
                <div style={{fontSize:13,color:"#fff",lineHeight:1.6}}>
                  <div>Last synced: <strong>{new Date(viewedTerm?.lastSyllabusSync.at).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}</strong></div>
                  <div style={{color:"var(--t2)",marginTop:2}}>
                    {viewedTerm?.lastSyllabusSync.files?.join(", ")||"unknown file"} — {viewedTerm?.lastSyllabusSync.added} new item{viewedTerm?.lastSyllabusSync.added===1?"":"s"} added
                  </div>
                  {viewedTerm?.lastSyllabusSync.coursesFound?.length>0&&(
                    <div style={{color:"var(--t3)",marginTop:2,fontSize:12}}>
                      Courses found: {viewedTerm?.lastSyllabusSync.coursesFound.join(", ")}
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
                  // Same deterministic sanity checks ExtractionVerifyModal runs before a real
                  // save — shown here too since this diagnostic is the tool the student's meant
                  // to reach for first when checking whether an upload looks right.
                  const{issues:diagIssues}=checkSyllabusExtraction(p,{courses:data.courses,sourceText:rawExtractResult.sourceText});
                  return(
                    <>
                      <div style={{fontSize:14,marginBottom:10,color:"var(--t1)"}}>
                        <strong>{courses.length}</strong> courses, <strong>{totalA}</strong> assignments, <strong>{totalE}</strong> exams
                      </div>
                      {diagIssues.length>0&&<ExtractionIssues issues={diagIssues}/>}
                      {courses.map((c,ci)=>(
                        <div key={ci} style={{marginBottom:10,paddingBottom:10,borderBottom:ci<courses.length-1?"1px solid var(--b1)":"none"}}>
                          <div style={{fontSize:14,fontWeight:600,marginBottom:4}}>{c.courseName} — {(c.assignments?.length||0)} assignments, {(c.exams?.length||0)} exams</div>
                          {(c.exams||[]).map((e,ei)=>(
                            <div key={ei} style={{fontSize:12,color:"var(--t3)",paddingLeft:10}}>
                              EXAM: {e.date} — {e.title} {e.weight!=null?`(${e.weight}%)`:""}
                            </div>
                          ))}
                          {(c.recurringSeries||[]).map((s,si)=>{
                            // Preview-only count (expandRecurringSeries isn't merged into
                            // assignments here — this diagnostic shows raw AI output, not the
                            // post-processed result syncSyl would actually save).
                            const lastDeadline=(c.exams||[]).map(e=>e.date).filter(Boolean).sort().pop();
                            const n=expandRecurringSeries([s],{termStart:data.profile?.termStart,lastDeadline}).length;
                            return(
                              <div key={si} style={{fontSize:12,color:"var(--blue)",paddingLeft:10}}>
                                ↻ Weekly pattern: {s.title}, every {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][s.dayOfWeek]}{s.weightTotal!=null?` (${s.weightTotal}% total)`:""} — would generate {n} item{n!==1?"s":""} on sync
                              </div>
                            );
                          })}
                          {(c.extractionNotes||[]).length>0&&(
                            <div style={{marginTop:6,paddingLeft:10,borderLeft:"2px solid var(--amber)"}}>
                              {c.extractionNotes.map((n,ni)=>(
                                <div key={ni} style={{fontSize:12,color:"var(--amber)"}}>ℹ {n}</div>
                              ))}
                            </div>
                          )}
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
                  disabled={readOnly||!ncCourse.name||(ncCourse.format!=="async"&&!ncCourse.days.length)}>
                  <i className="ti ti-plus"/> Add class
                </button>
              </div>
            </details>
            </>)}
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
          existingAssignments={data.assignments}
          existingExams={data.exams}
          sourceText={pendingVerify.sourceText}
          onConfirm={correctedParsed=>finalizeSync(correctedParsed,pendingVerify.fileNames)}
          onCancel={()=>{setPendingVerify(null);setSylPdfs([]);}}
        />
      )}
    </div>
  );
}
