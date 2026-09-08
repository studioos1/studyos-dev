import { useState } from "react";
import { PDF } from "@/lib/pdf";
import { CI } from "@/lib/api";
import { findMatchingCourse, prettyCourseCode } from "@/lib/courses";
import { iso } from "@/lib/time";
import { DS, DF, CC } from "@/lib/constants";
import { GYM0, getActiveTermAndSchool, uid } from "@/lib/data";
import { fetchCollegeCalendar, applyCollegeCalendarResult } from "@/lib/colleges";
import { Sp, SecHead, CollegeAutocomplete, PdfDrop, DelBtn, DayPick } from "@/components/shared";

// ── ONBOARDING ───────────────────────────────────────────────────────────────
// Wizard steps, keyed so navigation reads by name and inserting a step never means renumbering
// every setStep() call. Order is the flow order.
const STEPS=[
  {k:"welcome", l:"Welcome",   i:"ti-user"},
  {k:"school",  l:"School",    i:"ti-building"},
  {k:"term",    l:"Term",      i:"ti-calendar-event"},
  {k:"schedule",l:"Schedule",  i:"ti-file-upload"},
  {k:"syllabi", l:"Syllabi",   i:"ti-files"},
  {k:"lifestyle",l:"Lifestyle",i:"ti-heart"},
  {k:"study",   l:"Study",     i:"ti-brain"},
  {k:"done",    l:"Done",      i:"ti-rocket"},
];
const IDX=Object.fromEntries(STEPS.map((s,i)=>[s.k,i]));

export function Onboard({data,upd,updP,ai,busy,toast2,setTab,setProgress}){
  const [step,setStep]=useState(()=>Math.min(data.profile.onboardStep||0,STEPS.length-1));
  const [sPdf,setSPdf]=useState([]);
  const [sylPdfs,setSylPdfs]=useState([]);
  const [parsing,setParsing]=useState(false);
  const [pSched,setPSched]=useState(null);
  const [pSyl,setPSyl]=useState(null);
  const [sImported,setSImported]=useState(false);
  const [sylImported,setSylImported]=useState(false);
  const [nc,setNc]=useState({name:"",days:[],startTime:"09:00",endTime:"10:30",difficulty:5,weeklyHours:4,format:"in-person"});
  const [collegeLookup,setCollegeLookup]=useState("idle"); // idle | loading | done | error
  const p=data.profile;

  // Every step advance persists the resume point, so closing the tab (or "Save & Continue Later")
  // picks up on the same step. Profile edits within a step already auto-save via updP.
  const go=n=>{const s=Math.max(0,Math.min(STEPS.length-1,n));setStep(s);updP({onboardStep:s});};
  const saveLater=()=>{updP({onboardStep:step});toast2("Progress saved — close this any time and pick up right here.");};

  async function handleCollegeSelected(schoolName){
    setCollegeLookup("loading");
    try{
      const result=await fetchCollegeCalendar(schoolName);
      applyCollegeCalendarResult(result,updP);
      setCollegeLookup("done");
      toast2(`Found ${schoolName}'s calendar — review the fields below, they're all still editable.`);
    }catch(err){
      console.error("StudyOS: college calendar lookup failed —",err);
      setCollegeLookup("error");
      toast2("Couldn't auto-fill that school's info — please fill in manually.",true);
    }
  }

  async function parseSched(){
    if(!sPdf.length)return;setParsing(true);
    setProgress?.({label:"Reading PDF...",detail:sPdf[0]?.name});
    try{
      const t=await PDF(sPdf[0]);
      setProgress?.({label:"Extracting class schedule with AI...",detail:sPdf[0]?.name});
      const r=await ai("Parse college class schedules. Return ONLY valid JSON.",
        `Extract all classes. Return JSON:
{"studentName":null,"quarter":"Spring 2026","courses":[{"name":"Calculus II","code":"MATH 1D","units":5,"professor":"Smith","days":[1,3],"startTime":"09:30","endTime":"10:45","room":"S10"}]}
Days: 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat
SCHEDULE:\n${t.slice(0,6000)}`);
      if(r){const parsed=JSON.parse(r.replace(/```json|```/g,"").trim());setPSched(parsed);if(parsed.studentName&&!p.name)updP({name:parsed.studentName.split(" ")[0]});}
    }catch{toast2("Couldn't parse — try manual entry",true);}
    setParsing(false);
    setProgress?.(null);
  }

  async function importSched(){
    if(!pSched?.courses)return;
    setProgress?.({label:"Looking up course difficulty...",detail:`${pSched.courses.length} class(es)`});
    const courses=await Promise.all(pSched.courses.filter(c=>c.name&&c.days).map(async(c,i)=>{
      const info=await CI(c.name,c.code);
      return{id:uid(),termId:getActiveTermAndSchool(data).term?.id||null,name:prettyCourseCode(c.code||c.name),days:c.days||[],startTime:c.startTime||"09:00",endTime:c.endTime||"10:00",professor:c.professor||"",room:c.room||"",units:c.units||3,difficulty:info.difficultyScore||5,difficultyLabel:info.difficultyLabel||"Medium",weeklyHours:info.weeklyStudyHours||5,startExamPrepDays:info.startExamPrepDays||5,description:info.description||"",tips:info.tips||[],color:CC[i%CC.length]};
    }));
    // Dedup by stable course code (e.g. "DSC10"), not full display name — AI wording varies between
    // calls, but the department+number code is the actual stable identity.
    const newOnes=courses.filter(c=>!findMatchingCourse(data.courses,c.name));
    const skipped=courses.length-newOnes.length;
    upd({courses:[...data.courses,...newOnes]});
    setSImported(true);
    setProgress?.(null);
    toast2(skipped>0?`${newOnes.length} classes imported (${skipped} already added, skipped)`:`${newOnes.length} classes imported!`);
  }

  async function parseSyl(){
    if(!sylPdfs.length)return;setParsing(true);
    setProgress?.({label:"Reading PDF...",detail:sylPdfs.map(f=>f.name).join(", ")});
    try{
      const texts=await Promise.all(sylPdfs.slice(0,6).map(async f=>{const t=await PDF(f);return `\n=== ${f.name} ===\n${t.slice(0,16000)}`;}));
      setProgress?.({label:"Extracting syllabus with AI (classes, assignments & exams)...",detail:sylPdfs.map(f=>f.name).join(", ")});
      const r=await ai("Parse college syllabi. Return ONLY valid JSON. Be exhaustive — extract every single dated item, not a representative sample.",
        `Extract EVERY deadline for EVERY course in this document. Today: ${iso()}.

CRITICAL RULES:
1. Go through the syllabus week-by-week or item-by-item. Do NOT summarize or sample — extract EVERY dated assignment, lab, homework, problem set, quiz, and exam you see.
2. Courses commonly have 2-4 exams each (e.g. Midterm 1, Midterm 2, Final Exam) — these are SEPARATE exam entries, not one.
3. If a course lists 8 weekly problem sets, you must return 8 separate assignment entries, not 1.
4. Count the dated items in the source text before answering, and make sure your output has that many entries.
5. Also extract the grading weight (% of final grade) for each assignment/exam from the syllabus's grading breakdown section. If no weight is stated for an item, use null.
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
      if(r)setPSyl(JSON.parse(r.replace(/```json|```/g,"").trim()));
    }catch{toast2("Couldn't parse",true);}
    setParsing(false);
    setProgress?.(null);
  }

  function importSyl(){
    if(!pSyl?.courses)return;
    const nA=[],nE=[];
    let unmatchedCourses=0;
    pSyl.courses.forEach(c=>{
      // Resolve to an actual course by stable code, not a re-typed string — if the syllabus names
      // a course that wasn't found in the schedule import, skip its items rather than saving an
      // orphan string reference that can never be linked correctly later.
      const course=findMatchingCourse(data.courses,c.courseName);
      if(!course){unmatchedCourses++;return;}
      (c.assignments||[]).forEach((a,i)=>{if(a.dueDate)nA.push({id:uid(),courseId:course.id,title:a.title,dueDate:a.dueDate,weight:a.weight||null,estimatedHours:a.estimatedHours||2,status:"not-started"});});
      (c.exams||[]).forEach((e,i)=>{if(e.date)nE.push({id:uid(),courseId:course.id,date:e.date,topics:e.topics||"",weight:e.weight||null,prepDays:e.prepDays||7,title:e.title,status:"not-started"});});
    });
    upd({assignments:[...data.assignments,...nA],exams:[...data.exams,...nE]});
    setSylImported(true);
    toast2(unmatchedCourses>0
      ? `${nA.length} assignments + ${nE.length} exams imported! (${unmatchedCourses} course(s) in syllabus not found in schedule — import your schedule first)`
      : `${nA.length} assignments + ${nE.length} exams imported!`);
  }

  // Small helper row reused at the bottom of the School and Term steps.
  const navRow=(backTo,onNext,nextDisabled,nextLabel="Continue")=>(
    <div className="row" style={{marginTop:14}}>
      {backTo!=null&&<button className="btn btn-ghost" onClick={()=>go(backTo)}><i className="ti ti-arrow-left"/></button>}
      <button className="btn btn-action" style={{flex:1}} onClick={onNext} disabled={nextDisabled}>{nextLabel} <i className="ti ti-arrow-right"/></button>
      <button className="btn btn-ghost btn-sm" onClick={saveLater}>Save &amp; Continue Later</button>
    </div>
  );

  return(
    <div className="fade" style={{maxWidth:560,margin:"0 auto"}}>
      {/* Step bar */}
      <div className="row" style={{marginBottom:24,gap:4}}>
        {STEPS.map((s,i)=>(
          <div key={i} className="row" style={{gap:4}}>
            <div style={{width:26,height:26,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,flexShrink:0,background:i<step?"var(--green-bg)":i===step?"var(--blue-bg)":"var(--card2)",color:i<step?"var(--green)":i===step?"var(--blue)":"var(--t3)"}}>
              {i<step?<i className="ti ti-check"/>:<i className={`ti ${s.i}`}/>}
            </div>
            {i<STEPS.length-1&&<div style={{width:12,height:1.5,background:i<step?"var(--green-bg)":"var(--b1)"}}/>}
          </div>
        ))}
        <span style={{fontSize:11,color:"var(--t3)",marginLeft:6}}>{STEPS[step]?.l} · {step+1}/{STEPS.length}</span>
      </div>

      {step===IDX.welcome&&(
        <div className="fade">
          <h2 style={{marginBottom:8}}>Set up your assistant</h2>
          <p style={{marginBottom:16,fontSize:14}}>Upload your schedule PDF and syllabi — AI does the rest. About 3 minutes.</p>
          <div className="card">
            <div className="g2" style={{marginBottom:12}}>
              <div><label>First name</label><input value={p.name} onChange={e=>updP({name:e.target.value})} placeholder="Alex"/></div>
              <div><label>WhatsApp</label><input value={p.phone} onChange={e=>updP({phone:e.target.value})} placeholder="+1 408 555 0000"/></div>
            </div>
            <div><label>Home address</label><input value={p.homeAddress} onChange={e=>updP({homeAddress:e.target.value})} placeholder="Los Gatos, CA"/></div>
          </div>
          <div style={{background:"var(--blue-bg)",borderRadius:9,padding:"9px 13px",marginBottom:14,fontSize:13,color:"var(--blue)",display:"flex",gap:8}}>
            <i className="ti ti-shield-check" style={{fontSize:14,flexShrink:0}}/>PDFs read locally — only extracted text goes to AI
          </div>
          <button className="btn btn-action" onClick={()=>go(IDX.school)} disabled={!p.name} style={{width:"100%"}}>Continue <i className="ti ti-arrow-right"/></button>
        </div>
      )}

      {step===IDX.school&&(
        <div className="fade">
          <h2 style={{marginBottom:8}}>Select your school</h2>
          <p style={{marginBottom:16,fontSize:14}}>School name is required. Picking a school from the list auto-fills its address — and pre-fills the term dates on the next step — when it can.</p>
          <div className="card">
            <div className="g2" style={{marginBottom:12}}>
              <div>
                <label>School name <span style={{color:"var(--red)"}}>*</span></label>
                <CollegeAutocomplete value={p.schoolName} onChange={v=>updP({schoolName:v})} onSelect={handleCollegeSelected} placeholder="Start typing your school..."/>
                {collegeLookup==="loading"&&<div style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:"var(--t3)",marginTop:5}}><Sp sz={12}/> Looking up address, term dates & holidays...</div>}
              </div>
              <div><label>Schedule type <span style={{color:"var(--red)"}}>*</span></label><select value={p.schoolType} onChange={e=>updP({schoolType:e.target.value})}><option value="quarter">Quarter</option><option value="semester">Semester</option></select></div>
            </div>
            <div><label>School address <span style={{color:"var(--t3)",fontWeight:400}}>(optional)</span></label><input value={p.schoolAddress} onChange={e=>updP({schoolAddress:e.target.value})} placeholder="21250 Stevens Creek Blvd, Cupertino, CA"/></div>
          </div>
          {navRow(IDX.welcome,()=>go(IDX.term),!p.schoolName)}
        </div>
      )}

      {step===IDX.term&&(
        <div className="fade">
          <h2 style={{marginBottom:8}}>Select your term</h2>
          <p style={{marginBottom:16,fontSize:14}}>Name, start and end are all required — everything else in the app is scoped to your active term.</p>
          <div className="card">
            <div style={{marginBottom:12}}>
              <label>Term name <span style={{color:"var(--red)"}}>*</span></label>
              <input value={p.termName} onChange={e=>updP({termName:e.target.value})} placeholder={p.schoolType==="semester"?"e.g. Fall 2026":"e.g. Fall 2026 (Quarter)"}/>
            </div>
            <div className="g2">
              <div><label>Term start <span style={{color:"var(--red)"}}>*</span></label><input type="date" value={p.termStart} onChange={e=>updP({termStart:e.target.value})}/></div>
              <div>
                <label>Term end <span style={{color:"var(--red)"}}>*</span></label>
                <input type="date" value={p.termEnd} onChange={e=>updP({termEnd:e.target.value})}/>
                <div style={{fontSize:11,color:"var(--t3)",marginTop:4}}>Last day of finals — not just last day of class</div>
              </div>
            </div>
          </div>
          {navRow(
            IDX.school,
            ()=>{setStep(IDX.schedule);updP({onboardTermSaved:true,onboardStep:IDX.schedule});},
            !p.termName?.trim()||!p.termStart||!p.termEnd,
          )}
        </div>
      )}

      {step===IDX.schedule&&(
        <div className="fade">
          <h2 style={{marginBottom:8}}>Upload your class schedule</h2>
          <p style={{marginBottom:14,fontSize:14,lineHeight:1.6}}>
            {p.schoolName==="De Anza College"?"MyPortal → Student → Enrollment → Class Schedule → Save as PDF":"Download your schedule PDF from your student portal"}
          </p>
          <PdfDrop label="Class Schedule PDF" hint="Your term's class schedule" files={sPdf} onFiles={setSPdf}/>
          {sPdf.length>0&&!pSched&&(
            <button className="btn btn-action" style={{width:"100%",marginBottom:10}} onClick={parseSched} disabled={parsing||busy}>
              {parsing||busy?<><Sp/> Reading...</>:<><i className="ti ti-sparkles"/> Extract my classes</>}
            </button>
          )}
          {pSched&&!sImported&&(
            <div className="fade">
              <div className="card" style={{marginBottom:10}}>
                <SecHead icon="ti-list" title={`Found ${pSched.courses?.length||0} classes`}/>
                {pSched.courses?.map((c,i)=>(
                  <div key={i} className="list-item">
                    <div style={{width:8,height:8,borderRadius:"50%",background:CC[i%CC.length].border,flexShrink:0}}/>
                    <div style={{flex:1}}>
                      <div className="list-item-title">{c.name}{c.code&&<span style={{color:"var(--t3)",marginLeft:6,fontSize:12}}>({c.code})</span>}</div>
                      <div className="list-item-sub">{c.days?.map(d=>DS[d]).join(", ")} · {c.startTime}–{c.endTime}{c.professor&&` · ${c.professor}`}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="row">
                <button className="btn btn-action" style={{flex:1}} onClick={importSched} disabled={busy}>
                  {busy?<><Sp/> Looking up difficulty...</>:<><i className="ti ti-download"/> Import all classes</>}
                </button>
                <button className="btn btn-ghost" onClick={()=>{setPSched(null);setSPdf([]);}}>Retry</button>
              </div>
            </div>
          )}
          {sImported&&<div style={{display:"flex",alignItems:"center",gap:8,padding:"9px 13px",background:"var(--green-bg)",borderRadius:9,marginBottom:10,fontSize:13,color:"var(--green)"}}><i className="ti ti-circle-check"/> {data.courses.length} classes imported!</div>}
          <details style={{marginTop:10}}>
            <summary style={{padding:"8px 13px",background:"var(--card2)",borderRadius:9,fontSize:13,color:"var(--t2)",marginBottom:8}}>
              <i className="ti ti-pencil" style={{marginRight:7}}/>Add class manually
            </summary>
            <div style={{marginTop:8}}>
              {data.courses.map((c,i)=>(
                <div key={c.id} className="list-item" style={{paddingLeft:0}}>
                  <div style={{width:8,height:8,borderRadius:"50%",background:c.color.border,flexShrink:0}}/>
                  <div style={{flex:1,fontSize:13,color:"var(--t1)"}}>{c.name}<span style={{color:"var(--t3)",marginLeft:8,fontSize:11}}>{c.days.map(d=>DS[d]).join(",")}</span></div>
                  <DelBtn onClick={()=>upd({courses:data.courses.filter(x=>x.id!==c.id)})}/>
                </div>
              ))}
              <div className="card" style={{marginTop:8}}>
                <div style={{marginBottom:9}}><label>Course name</label><input value={nc.name} onChange={e=>setNc(c=>({...c,name:e.target.value}))} placeholder="e.g. Python for Data Science"/></div>
                <div style={{marginBottom:9}}>
                  <label>Format</label>
                  <div className="toggle-group">
                    {[["in-person","In-person"],["hybrid","Hybrid"],["async","Async (no set meetings)"]].map(([v,l])=>(
                      <button key={v} className={`toggle-opt${nc.format===v?" on":""}`}
                        onClick={()=>setNc(c=>({...c,format:v,...(v==="async"?{days:[]}:{})}))}>{l}</button>
                    ))}
                  </div>
                </div>
                {nc.format!=="async"&&(
                  <>
                    <div style={{marginBottom:9}}><label>Class days</label><DayPick val={nc.days} onChange={days=>setNc(c=>({...c,days}))}/></div>
                    <div className="g4" style={{marginBottom:9}}>
                      <div><label>Start</label><input type="time" value={nc.startTime} onChange={e=>setNc(c=>({...c,startTime:e.target.value}))}/></div>
                      <div><label>End</label><input type="time" value={nc.endTime} onChange={e=>setNc(c=>({...c,endTime:e.target.value}))}/></div>
                      <div><label>Difficulty</label><select value={nc.difficulty} onChange={e=>setNc(c=>({...c,difficulty:+e.target.value}))}>{[1,2,3,4,5,6,7,8,9,10].map(n=><option key={n} value={n}>{n}</option>)}</select></div>
                      <div><label>Hrs/wk</label><input type="number" min="1" max="20" value={nc.weeklyHours} onChange={e=>setNc(c=>({...c,weeklyHours:+e.target.value}))}/></div>
                    </div>
                  </>
                )}
                {nc.format==="async"&&(
                  <div className="g2" style={{marginBottom:9}}>
                    <div><label>Difficulty</label><select value={nc.difficulty} onChange={e=>setNc(c=>({...c,difficulty:+e.target.value}))}>{[1,2,3,4,5,6,7,8,9,10].map(n=><option key={n} value={n}>{n}</option>)}</select></div>
                    <div><label>Hrs/wk</label><input type="number" min="1" max="20" value={nc.weeklyHours} onChange={e=>setNc(c=>({...c,weeklyHours:+e.target.value}))}/></div>
                  </div>
                )}
                <button className="btn btn-action btn-sm"
                  onClick={()=>{
                    if(!nc.name)return;
                    if(nc.format!=="async"&&!nc.days.length)return;
                    upd({courses:[...data.courses,{...nc,id:uid(),termId:getActiveTermAndSchool(data).term?.id||null,color:CC[data.courses.length%CC.length]}]});
                    setNc({name:"",days:[],startTime:"09:00",endTime:"10:30",difficulty:5,weeklyHours:4,format:"in-person"});
                    toast2("Class added");
                  }}
                  disabled={!nc.name||(nc.format!=="async"&&!nc.days.length)}>
                  <i className="ti ti-plus"/> Add class
                </button>
              </div>
            </div>
          </details>
          <div className="row" style={{marginTop:14}}>
            <button className="btn btn-ghost" onClick={()=>go(IDX.term)}><i className="ti ti-arrow-left"/></button>
            <button className="btn btn-action" style={{flex:1}} onClick={()=>go(IDX.syllabi)} disabled={!data.courses.length&&!sImported}>Continue <i className="ti ti-arrow-right"/></button>
            <button className="btn btn-ghost btn-sm" onClick={()=>go(IDX.syllabi)}>Skip</button>
          </div>
        </div>
      )}

      {step===IDX.syllabi&&(
        <div className="fade">
          <h2 style={{marginBottom:8}}>Upload your syllabi</h2>
          <p style={{marginBottom:14,fontSize:14}}>Up to 6 PDFs — AI extracts every exam and deadline.</p>
          <PdfDrop label="Syllabus PDFs (all classes)" hint="Select multiple files at once" files={sylPdfs} onFiles={setSylPdfs} multi/>
          {sylPdfs.length>0&&!pSyl&&<button className="btn btn-action" style={{width:"100%",marginBottom:10}} onClick={parseSyl} disabled={parsing||busy}>{parsing||busy?<><Sp/> Reading {sylPdfs.length} file(s)...</>:<><i className="ti ti-sparkles"/> Extract deadlines</>}</button>}
          {pSyl&&!sylImported&&(
            <div className="fade">
              <div className="card" style={{marginBottom:10}}>
                <SecHead icon="ti-list" title={`Found across ${pSyl.courses?.length||0} course(s)`}/>
                {pSyl.courses?.map((c,ci)=>(
                  <div key={ci} style={{marginBottom:10}}>
                    <div style={{fontSize:13,color:"var(--t1)",marginBottom:6,display:"flex",alignItems:"center",gap:6}}><div style={{width:7,height:7,borderRadius:"50%",background:CC[ci%CC.length].border}}/>{c.courseName}</div>
                    {c.exams?.map((e,i)=><div key={i} style={{padding:"5px 9px",background:"var(--a-exam)",borderRadius:6,marginBottom:3,fontSize:12,color:"var(--a-exam-t)"}}>🧪 {e.title} · {e.date}</div>)}
                    {c.assignments?.map((a,i)=><div key={i} style={{padding:"5px 9px",background:"var(--a-study)",borderRadius:6,marginBottom:3,fontSize:12,color:"var(--a-study-t)"}}>📝 {a.title} · Due {a.dueDate}</div>)}
                  </div>
                ))}
              </div>
              <div className="row">
                <button className="btn btn-action" style={{flex:1}} onClick={importSyl}><i className="ti ti-download"/> Import all</button>
                <button className="btn btn-ghost" onClick={()=>{setPSyl(null);setSylPdfs([]);}}>Retry</button>
              </div>
            </div>
          )}
          {sylImported&&<div style={{display:"flex",alignItems:"center",gap:8,padding:"9px 13px",background:"var(--green-bg)",borderRadius:9,marginBottom:10,fontSize:13,color:"var(--green)"}}><i className="ti ti-circle-check"/> Deadlines imported!</div>}
          <div className="row" style={{marginTop:14}}>
            <button className="btn btn-ghost" onClick={()=>go(IDX.schedule)}><i className="ti ti-arrow-left"/></button>
            <button className="btn btn-action" style={{flex:1}} onClick={()=>go(IDX.lifestyle)}>Continue <i className="ti ti-arrow-right"/></button>
            <button className="btn btn-ghost btn-sm" onClick={()=>go(IDX.lifestyle)}>Skip</button>
          </div>
        </div>
      )}

      {step===IDX.lifestyle&&(
        <div className="fade">
          <h2 style={{marginBottom:8}}>Your daily life</h2>
          <p style={{marginBottom:14,fontSize:14}}>Meals, gym, fun time — protected blocks the AI never overrides.</p>
          <div className="card">
            <SecHead icon="ti-bowl-spoon" title="Meal times"/>
            <div className="g3">
              {[["Breakfast","breakfastTime"],["Lunch","lunchTime"],["Dinner","dinnerTime"]].map(([l,k])=>(
                <div key={k}><label>{l}</label><input type="time" value={p[k]} onChange={e=>updP({[k]:e.target.value})}/></div>
              ))}
            </div>
          </div>
          <div className="card">
            <SecHead icon="ti-barbell" title="Gym — select days & times"/>
            {(p.gymDays||GYM0).map((gd,i)=>(
              <div key={gd.day} className="list-item" style={{gap:9}}>
                <div style={{display:"flex",alignItems:"center",gap:7,width:80}}>
                  <input type="checkbox" checked={gd.on} onChange={e=>{const d=[...(p.gymDays||GYM0)];d[i]={...d[i],on:e.target.checked};updP({gymDays:d});}} style={{width:14,height:14}}/>
                  <span style={{fontSize:13,color:gd.on?"var(--t1)":"var(--t3)"}}>{DF[gd.day].slice(0,3)}</span>
                </div>
                {gd.on?(
                  <div className="row" style={{flex:1,gap:6}}>
                    <input type="time" value={gd.s} onChange={e=>{const d=[...(p.gymDays||GYM0)];d[i]={...d[i],s:e.target.value};updP({gymDays:d});}} style={{width:85,fontSize:12,padding:"4px 7px"}}/>
                    <span style={{fontSize:11,color:"var(--t3)"}}>→</span>
                    <input type="time" value={gd.e} onChange={e=>{const d=[...(p.gymDays||GYM0)];d[i]={...d[i],e:e.target.value};updP({gymDays:d});}} style={{width:85,fontSize:12,padding:"4px 7px"}}/>
                  </div>
                ):<span style={{fontSize:12,color:"var(--t3)"}}>rest day</span>}
              </div>
            ))}
          </div>
          <div className="card">
            <SecHead icon="ti-mood-smile" title="Fun time targets"/>
            <div className="g2">
              <div><label>Weekday (hrs/day)</label><input type="number" min="0" max="8" step="0.5" value={p.funWD} onChange={e=>updP({funWD:+e.target.value})}/></div>
              <div><label>Weekend (hrs/day)</label><input type="number" min="0" max="12" step="0.5" value={p.funWE} onChange={e=>updP({funWE:+e.target.value})}/></div>
            </div>
          </div>
          <div className="row" style={{marginTop:8}}>
            <button className="btn btn-ghost" onClick={()=>go(IDX.syllabi)}><i className="ti ti-arrow-left"/></button>
            <button className="btn btn-action" style={{flex:1}} onClick={()=>go(IDX.study)}>Continue <i className="ti ti-arrow-right"/></button>
          </div>
        </div>
      )}

      {step===IDX.study&&(
        <div className="fade">
          <h2 style={{marginBottom:8}}>How you study best</h2>
          <div className="card">
            <div style={{marginBottom:16}}>
              <label style={{marginBottom:8,display:"block"}}>Focus block length</label>
              <div className="row">{[15,20,25,30,45].map(n=><button key={n} className={`opt-btn${p.focusMins===n?" sel":""}`} onClick={()=>updP({focusMins:n})}>{n} min</button>)}</div>
            </div>
            <div style={{marginBottom:16}}>
              <label style={{marginBottom:8,display:"block"}}>Break length</label>
              <div className="row">{[5,10,15].map(n=><button key={n} className={`opt-btn${p.breakMins===n?" sel":""}`} onClick={()=>updP({breakMins:n})}>{n} min</button>)}</div>
            </div>
            <div style={{marginBottom:16}}>
              <label style={{marginBottom:8,display:"block"}}>Energy peak</label>
              <div className="row">{[["morning","Morning ☀️"],["afternoon","Afternoon 🌤"],["evening","Evening 🌙"]].map(([v,l])=><button key={v} className={`opt-btn${p.energyPeak===v?" sel":""}`} onClick={()=>updP({energyPeak:v})}>{l}</button>)}</div>
            </div>
            <div className="g3">
              <div><label>Wake time</label><input type="time" value={p.wakeTime} onChange={e=>updP({wakeTime:e.target.value})}/></div>
              <div><label>Sleep time</label><input type="time" value={p.sleepTime} onChange={e=>updP({sleepTime:e.target.value})}/></div>
              <div><label>Commute (min)</label><input type="number" min="5" max="120" value={p.commuteMins} onChange={e=>updP({commuteMins:+e.target.value})}/></div>
            </div>
          </div>
          <div className="row" style={{marginTop:8}}>
            <button className="btn btn-ghost" onClick={()=>go(IDX.lifestyle)}><i className="ti ti-arrow-left"/></button>
            <button className="btn btn-action" style={{flex:1}} onClick={()=>go(IDX.done)}>Almost done <i className="ti ti-arrow-right"/></button>
          </div>
        </div>
      )}

      {step===IDX.done&&(
        <div className="fade" style={{textAlign:"center",paddingTop:28}}>
          <div style={{fontSize:52,marginBottom:14}}>🎓</div>
          <h2 style={{marginBottom:10}}>You're all set, {p.name}!</h2>
          <p style={{marginBottom:20,lineHeight:1.7}}>Your assistant knows your classes, deadlines, gym schedule, and how you study best.</p>
          <div className="card" style={{textAlign:"left",maxWidth:340,margin:"0 auto 20px"}}>
            {[
              [`${data.courses.length} classes configured`,"ti-school"],
              [`${data.assignments.length} assignments + ${data.exams.length} exams`,"ti-calendar"],
              [`${(p.gymDays||GYM0).filter(g=>g.on).length} gym days/week`,"ti-barbell"],
              [`${p.focusMins}min focus · ${p.energyPeak} peak`,"ti-brain"],
              [p.schoolName,"ti-building"],
            ].map(([t,ic],i)=>(
              <div key={i} className="list-item" style={{paddingLeft:0}}>
                <i className={`ti ${ic}`} style={{fontSize:15,color:"var(--green)",flexShrink:0}}/><span style={{fontSize:14}}>{t}</span>
              </div>
            ))}
          </div>
          <button className="btn btn-action" style={{padding:"12px 28px",fontSize:15}} onClick={()=>{upd({onboarded:true,profile:{...p,onboardStep:0}});setTab("today");}}>
            <i className="ti ti-rocket"/> Launch StudyOS
          </button>
        </div>
      )}
    </div>
  );
}
