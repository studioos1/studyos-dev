"use client";
import React, { useState, useEffect, useRef } from "react";
import { iso, t2m, du, m2t, f12, fmtDur } from "@/lib/time";
import { courseNameFor } from "@/lib/courses";
import { DS, DF, CC } from "@/lib/constants";
import {
  buildBlocks,
  freeSlots,
  weekStartOf,
  realDayBlocks,
  weekHasBeenPlanned,
  saveBlockToDay,
  deleteBlockFromDay,
  logCompletion,
  findRawDayBlock,
  tc,
  assignLanesClustered,
} from "@/lib/calendar";
import {
  planHorizon,
  estimateDifficulty,
  estimateStudyHours,
  computePriorityScore,
  computeEstimateFields,
} from "@/lib/planner";
import {
  GYM0,
  ED,
  CHORE_PRESETS,
  load,
  save,
  getQ,
  isHol,
  isFin,
  getTermRange,
  computeTermStatuses,
  getActiveTermAndSchool,
  termScopedForPlanning,
  migrateLegacyTermIfNeeded,
  syncActiveTermToProfilePatch,
} from "@/lib/data";
// ── Build version — bumped every time a new app.js is generated, so you can confirm which
// build is actually running (check Settings → bottom, or the browser console on load). ──
const APP_VERSION="2.38.0";
const APP_BUILD_DATE="2026-09-04";
const APP_BUILD_TIME="Next.js migration";
console.log(`StudyOS v${APP_VERSION} (built ${APP_BUILD_DATE} ${APP_BUILD_TIME}) loaded`);
// ── Week navigation helpers ──────────────────────────────────────────────────
function fmtWeekRange(weekStart){
  const we=new Date(weekStart);we.setDate(weekStart.getDate()+6);
  const startStr=weekStart.toLocaleDateString("en-US",{month:"short",day:"numeric"});
  const endStr=we.toLocaleDateString("en-US",{month:"short",day:"numeric"});
  const yearDiffers=weekStart.getFullYear()!==we.getFullYear();
  return `${startStr}${yearDiffers?`, ${weekStart.getFullYear()}`:""} – ${endStr}, ${we.getFullYear()}`;
}
// Normalizes text for fuzzy-safe duplicate comparisons (case/whitespace-insensitive).
function norm(s){return(s||"").toLowerCase().trim().replace(/\s+/g," ");}
// Extracts a stable course code (e.g. "DSC10", "MMW122", "MATH180A") from a free-text course name,
// so course matching survives AI wording variance ("DSC 10" vs "DSC 10 — Principles of Data Science"
// vs "Data Science (DSC 10)"). This is the actual identity key — full display names are not stable
// across separate AI extraction calls, but the department+number code is.
function courseCode(name){
  if(!name)return"";
  const m=String(name).match(/([A-Za-z]{2,6})\s*-?\s*(\d{1,3})\s*([A-Za-z]?)/);
  if(!m)return norm(name); // fallback: no recognizable code pattern, use normalized full name
  return (m[1]+m[2]+m[3]).toUpperCase().replace(/\s+/g,"");
}
// Find an existing course matching this extracted name/code, or null if genuinely new.
function findMatchingCourse(courses,extractedName){
  const code=courseCode(extractedName);
  return courses.find(c=>courseCode(c.name)===code)||null;
}

// ── College search (for the School name autocomplete) ──────────────────────────────────────
// Dataset is fetched once (lazily, on first use — see CollegeAutocomplete) from
// /data/us_colleges.json, not bundled inline here, since it's ~140KB and most sessions never
// touch this screen after initial setup.
const COLLEGE_STOPWORDS=new Set(["of","the","and","at","in","for"]);
function generateAcronym(name){
  // Strip parenthetical/comma suffixes but keep the words themselves — the acronym students
  // actually type ("UCSD") comes from the FULL name including "San Diego", not just
  // "University of California".
  return name
    .replace(/[,()]/g," ")
    .split(/\s+/)
    .filter(w=>w&&!COLLEGE_STOPWORDS.has(w.toLowerCase()))
    .map(w=>w[0])
    .join("")
    .toLowerCase();
}
// colleges: [{name, domain}], pre-indexed with acronym once by the caller (see
// CollegeAutocomplete's useEffect) — not recomputed per keystroke.
function searchColleges(indexed,query,limit=8){
  const q=query.trim().toLowerCase();
  if(!q)return[];
  const acronymMatch=[],starts=[],contains=[];
  for(const c of indexed){
    const name=c.name.toLowerCase();
    if(c.acronym===q)acronymMatch.push(c);
    else if(name.startsWith(q))starts.push(c);
    else if(name.includes(q))contains.push(c);
  }
  acronymMatch.sort((a,b)=>a.name.localeCompare(b.name));
  starts.sort((a,b)=>a.name.localeCompare(b.name));
  contains.sort((a,b)=>a.name.localeCompare(b.name));
  return[...acronymMatch,...starts,...contains].slice(0,limit);
}

function sundayOf(d){const x=new Date(d);x.setHours(0,0,0,0);x.setDate(x.getDate()-x.getDay());return x;}

// ── Grades / GPA ────────────────────────────────────────────────────────────
function letterFromPct(pct){
  if(pct===null||pct===undefined||pct==="")return{letter:"—",points:null};
  const n=parseFloat(pct);if(isNaN(n))return{letter:"—",points:null};
  if(n>=93)return{letter:"A", points:4.0};
  if(n>=90)return{letter:"A-",points:3.7};
  if(n>=87)return{letter:"B+",points:3.3};
  if(n>=83)return{letter:"B", points:3.0};
  if(n>=80)return{letter:"B-",points:2.7};
  if(n>=77)return{letter:"C+",points:2.3};
  if(n>=73)return{letter:"C", points:2.0};
  if(n>=70)return{letter:"C-",points:1.7};
  if(n>=60)return{letter:"D", points:1.0};
  return{letter:"F",points:0};
}
function calcGPA(courses){
  const graded=(courses||[]).filter(c=>c.grade!==null&&c.grade!==undefined&&c.grade!=="");
  if(!graded.length)return null;
  let pts=0,cr=0;
  graded.forEach(c=>{
    const{points}=letterFromPct(c.grade);
    const units=parseFloat(c.credits)||4;
    if(points!==null){pts+=points*units;cr+=units;}
  });
  return cr?pts/cr:null;
}

// ── Reminders ─────────────────────────────────────────────────────────────
function urgentItems(data){
  const items=[];
  (data.assignments||[]).filter(a=>a.status!=="done"&&a.dueDate).forEach(a=>{
    const d=du(a.dueDate);
    if(d>=0&&d<=2)items.push(`${a.title} (${courseNameFor(data.courses,a.courseId)}) — due ${d===0?"today":`in ${d}d`}`);
  });
  (data.exams||[]).forEach(e=>{
    const d=du(e.date);
    const cn=courseNameFor(data.courses,e.courseId);
    if(d>=0&&d<=2)items.push(`${cn} exam — ${d===0?"today":`in ${d}d`}`);
    else if(d===e.prepDays)items.push(`Start prep for ${cn} exam`);
  });
  return items;
}

async function AI(sys,prompt,max=1500,opts={}){
  const body={system:sys,prompt,maxTokens:max};
  if(opts.temperature!==undefined)body.temperature=opts.temperature;
  if(opts.model)body.model=opts.model;
  const r=await fetch("/api/ai",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const j=await r.json();if(!r.ok)throw new Error(j.error||"API error");return j.text;
}
async function CI(name,code){
  try{const r=await fetch("/api/course-info",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({courseName:name,courseCode:code})});return await r.json();}
  catch{return{difficultyScore:5,difficultyLabel:"Medium",weeklyStudyHours:5,startExamPrepDays:5};}
}
// Deterministic safety net, run on every AI extraction response before saving — the AI is
// generative and won't always classify items identically between calls (e.g. it has sometimes
// put weekly reading/lecture quizzes in "exams" instead of "assignments", even with prompt
// instructions saying not to). Rather than relying purely on the prompt to prevent this, this
// function re-checks every item the AI put in "exams" and moves anything that's clearly a quiz —
// not a Midterm or Final — into "assignments", guaranteeing correctness in code rather than
// hoping the model gets it right. Only fires on the specific quiz-vs-exam ambiguity; anything
// else the AI classified as an exam is trusted as-is.
function reclassifyMisplacedQuizzes(courses){
  const isRealExam=title=>/\b(midterm|final)\b/i.test(title||"");
  const looksLikeQuiz=title=>/\bquiz(zes)?\b/i.test(title||"");
  let moved=0;
  const fixed=(courses||[]).map(c=>{
    const exams=c.exams||[];
    const assignments=c.assignments||[];
    const keepExams=[],demoted=[];
    exams.forEach(e=>{
      if(looksLikeQuiz(e.title)&&!isRealExam(e.title)){demoted.push(e);moved++;}
      else keepExams.push(e);
    });
    if(demoted.length===0)return c;
    return{
      ...c,
      exams:keepExams,
      assignments:[...assignments,...demoted.map(e=>({title:e.title,dueDate:e.date,estimatedHours:0.5,weight:e.weight??null}))],
    };
  });
  return{courses:fixed,moved};
}

function applyDefaultWeights(courseAssignments,courseExams,defaults){
  const d=defaults||{examsTotal:60,hwTotal:40,finalShare:35};
  const examUpdates={},hwUpdates={};

  const anyRealExamWeight=courseExams.some(e=>e.weight!=null);
  if(!anyRealExamWeight&&courseExams.length){
    const finalIdx=courseExams.findIndex(e=>/final/i.test(e.title||""));
    const finalShare=finalIdx>=0?Math.min(d.examsTotal,d.finalShare):0;
    const restPool=d.examsTotal-finalShare;
    const restCount=courseExams.length-(finalIdx>=0?1:0);
    courseExams.forEach((e,i)=>{
      examUpdates[e.id]=(i===finalIdx)?finalShare:(restCount>0?restPool/restCount:0);
    });
  }

  const anyRealHwWeight=courseAssignments.some(a=>a.weight!=null);
  if(!anyRealHwWeight&&courseAssignments.length){
    const each=d.hwTotal/courseAssignments.length;
    courseAssignments.forEach(a=>{hwUpdates[a.id]=each;});
  }

  return{examUpdates,hwUpdates};
}
async function PDF(file){
  if(!window.pdfjsLib)pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const buf=await file.arrayBuffer();const pdf=await pdfjsLib.getDocument({data:buf}).promise;
  let t="";for(let i=1;i<=pdf.numPages;i++){const p=await pdf.getPage(i);const c=await p.getTextContent();t+="\n"+c.items.map(x=>x.str).join(" ");}
  return t.trim();
}

// Shifts a movable [s,e) block forward past any (buffered) fixed academic interval it overlaps,
// preserving its original duration. Leaves the block untouched if no room exists before midnight.
// Backward-ramp weight for a day that is `d` days before a deadline, within a `windowDays`-long
// planning horizon — later days (closer to the deadline) get proportionally more time than earlier ones.
function rampMinutes(windowDays,d,totalMinutes,minPerDay,maxPerDay){
  if(d<0||d>windowDays)return 0;
  const totalWeight=((windowDays+1)*(windowDays+2))/2;
  const weight=windowDays-d+1;
  const raw=totalMinutes*weight/totalWeight;
  return Math.min(maxPerDay,Math.max(minPerDay,Math.round(raw)));
}
// ── Small shared components ──────────────────────────────────────────────────
function Sp({sz=15}){return <div className="spin" style={{width:sz,height:sz}}/>;}

// ── THEMED CONFIRM DIALOG ─────────────────────────────────────────────────────
// Add/Edit modal for a single study-plan block. block=null means "adding new"; block set means
// "editing this existing block" (opened via double-click). Type determines courseId linkage;
// Description is always free-text and purely cosmetic — never changes what the block structurally is.
// Small pill badge for a Low/Mid/High difficulty rating.
function TableHead({label,col,sortBy,setSortBy,align}){
  const isActive=sortBy===col;
  return(
    <th onClick={()=>setSortBy(col)} style={{
      fontSize:11,color:isActive?"var(--amber)":"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",
      textAlign:align||"left",padding:"0 8px 8px",fontWeight:isActive?700:600,cursor:"pointer",userSelect:"none",whiteSpace:"nowrap",
    }}>
      {label}{isActive&&<i className="ti ti-chevron-down" style={{fontSize:11,marginLeft:3,color:"var(--amber)"}}/>}
    </th>
  );
}

// Small numeric grade-entry field, used identically in Exams and Assignments. Saves live on
// every keystroke (already correct behavior), but Enter gives an explicit "done" signal —
// blurs the field and briefly shows a checkmark — since silent auto-save with no feedback
// made it unclear whether pressing Enter had done anything.
function GradeInput({value,onChange}){
  const [justConfirmed,setJustConfirmed]=useState(false);
  return(
    <div style={{position:"relative",display:"inline-block"}}>
      <input type="number" min="0" max="100" placeholder="Grade %" style={{fontSize:13,padding:"5px 24px 5px 7px",width:80}}
        value={value??""}
        onChange={e=>onChange(e.target.value===""?null:+e.target.value)}
        onKeyDown={e=>{
          if(e.key==="Enter"){
            e.target.blur();
            setJustConfirmed(true);
            setTimeout(()=>setJustConfirmed(false),1200);
          }
        }}/>
      {justConfirmed&&(
        <i className="ti ti-check" style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",color:"var(--green)",fontSize:14,pointerEvents:"none"}}/>
      )}
    </div>
  );
}

function DiffPill({value,muted}){
  if(!value)return <span style={{fontSize:11,color:"var(--t3)"}}>—</span>;
  const colors={Low:{bg:"var(--green-bg)",fg:"var(--green)"},Mid:{bg:"var(--amber-bg)",fg:"var(--amber)"},High:{bg:"var(--red-bg)",fg:"var(--red)"}};
  const c=colors[value]||colors.Mid;
  return <span style={{fontSize:12,fontWeight:600,padding:"3px 9px",borderRadius:6,background:muted?"var(--card2)":c.bg,color:muted?"var(--t3)":c.fg}}>{value}</span>;
}

// Editable hours field for the Study Preferences table. Manages its own local text state instead
// of deriving the displayed value directly from a parsed number on every keystroke — that pattern
// (used by the previous version of this field) meant clearing the input via backspace immediately
// snapped the display back to the AI-suggested fallback value the instant it hit empty, since the
// controlled value was `userHours ?? aiHours` and userHours became null right away. That looked
// exactly like "backspace doesn't work," because the field never actually stayed blank while
// typing. Here, typing freely updates local text only; the parent's stored value (and the
// dirty-tracking baseline) is only updated on blur or Enter, so mid-typing states like "0." or a
// briefly-empty field never fight the controlled input. Enter-confirmation checkmark is the same
// justConfirmed pattern as GradeInput above — copied directly rather than re-invented, for
// consistency between the two numeric-entry fields.
function HoursInput({value,isOverridden,onCommit}){
  const [local,setLocal]=useState(value==null?"":String(value));
  const [justConfirmed,setJustConfirmed]=useState(false);
  useEffect(()=>{setLocal(value==null?"":String(value));},[value]);
  function commit(){
    const n=+local;
    const parsed=local===""||Number.isNaN(n)?null:n;
    if(parsed===value)return; // untouched (still showing the AI suggestion) — don't manufacture an override
    onCommit(parsed);
  }
  return(
    <div style={{position:"relative",display:"inline-block"}}>
      <input type="number" min="0.5" step="0.5" value={local}
        onChange={e=>setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={e=>{
          if(e.key==="Enter"){
            commit();
            e.target.blur();
            setJustConfirmed(true);
            setTimeout(()=>setJustConfirmed(false),1200);
          }
        }}
        style={{fontSize:12,padding:"4px 22px 4px 7px",width:64,
          borderColor:isOverridden?"var(--amber)":undefined,
          fontWeight:isOverridden?600:400,
          color:isOverridden?"var(--amber)":undefined}}/>
      {justConfirmed&&(
        <i className="ti ti-check" style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",color:"var(--green)",fontSize:14,pointerEvents:"none"}}/>
      )}
    </div>
  );
}

// Free-typing text input with a live-filtering dropdown of US colleges — replaces the plain
// "School name" text field. Selecting a suggestion sets the canonical name; typing without
// selecting still works exactly like the old plain field (some schools genuinely aren't in the
// dataset, or the student may just not want to pick from the list). The ~140KB dataset is fetched
// lazily on first focus, not on every app load, since most sessions never touch this screen again
// after initial setup.
function CollegeAutocomplete({value,onChange,onSelect,placeholder}){
  const[indexed,setIndexed]=useState(null); // null = not yet loaded
  const[loading,setLoading]=useState(false);
  const[open,setOpen]=useState(false);
  const[results,setResults]=useState([]);
  const blurTimer=useRef(null);

  async function ensureLoaded(){
    if(indexed||loading)return;
    setLoading(true);
    try{
      const res=await fetch("/data/us_colleges.json");
      const list=await res.json();
      setIndexed(list.map(c=>({...c,acronym:generateAcronym(c.name)})));
    }catch(err){
      console.error("StudyOS: college list fetch failed —",err);
      setIndexed([]); // fail quietly — field still works as plain free-text input
    }finally{
      setLoading(false);
    }
  }

  function handleChange(v){
    onChange(v);
    if(indexed)setResults(searchColleges(indexed,v));
    setOpen(true);
  }

  return(
    <div style={{position:"relative"}}>
      <input value={value} placeholder={placeholder}
        onFocus={ensureLoaded}
        onChange={e=>handleChange(e.target.value)}
        onBlur={()=>{blurTimer.current=setTimeout(()=>setOpen(false),150);}} // delay so a click on a suggestion registers before the list unmounts
      />
      {open&&value&&results.length>0&&(
        <div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:20,marginTop:4,
          background:"var(--card3)",border:"1px solid var(--b1)",borderRadius:8,
          maxHeight:220,overflowY:"auto",boxShadow:"0 4px 12px rgba(0,0,0,0.3)"}}>
          {results.map(c=>(
            <div key={c.name} tabIndex={-1}
              onMouseDown={e=>{
                e.preventDefault(); // fires before the input's blur, so this beats the blur-close timer
                clearTimeout(blurTimer.current);
                onChange(c.name);
                onSelect?.(c.name);
                setOpen(false);
              }}
              style={{padding:"8px 12px",fontSize:13,cursor:"pointer",color:"var(--t1)"}}
              onMouseEnter={e=>e.currentTarget.style.background="var(--card2)"}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              {c.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Calls the server's web-search-backed college calendar lookup. Used wherever a college gets
// selected (onboarding, Settings) — one shared function so both call sites stay in sync.
async function fetchCollegeCalendar(schoolName){
  const res=await fetch("/api/college-calendar",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({schoolName}),
  });
  if(!res.ok){
    const err=await res.json().catch(()=>({}));
    throw new Error(err.error||"Lookup failed");
  }
  return await res.json();
}
// Applies a fetchCollegeCalendar() result to the profile — shared so onboarding and Settings
// populate fields identically. Only fills in what actually came back; leaves anything the lookup
// couldn't find (null) untouched rather than overwriting a field with nothing.
function applyCollegeCalendarResult(result,updP){
  const patch={};
  if(result.address)patch.schoolAddress=result.address;
  if(result.scheduleType==="quarter"||result.scheduleType==="semester")patch.schoolType=result.scheduleType;
  if(result.termStart)patch.termStart=result.termStart;
  if(result.termEnd)patch.termEnd=result.termEnd;
  if(result.termStart&&result.termEnd){
    patch.collegeCalendar={
      quarters:[{name:result.termName||"Current term",start:result.termStart,end:result.termEnd}],
      holidays:Array.isArray(result.holidays)?result.holidays:[],
      source:result.sourceUrl||null,fetchedAt:new Date().toISOString(),
    };
  }
  updP(patch);
}

// Shown right after the AI parses a syllabus/schedule PDF, BEFORE anything is saved to
// data.assignments/data.exams. Gives the student one place to catch and fix any misclassified
// item (e.g. a quiz the AI called an exam) or wrong date/weight, rather than discovering it
// later in a cluttered calendar. A single "Looks good, save all" button confirms everything as-is
// for the common case; per-row editing is only needed when something's actually wrong.
function ExtractionVerifyModal({parsed,courses,onConfirm,onCancel}){
  const [saving,setSaving]=useState(false);
  // Flatten into one editable list, tagging each row with its course + a stable local key.
  const [rows,setRows]=useState(()=>{
    const out=[];
    (parsed.courses||[]).forEach((c,ci)=>{
      (c.assignments||[]).forEach((a,ai)=>{
        out.push({key:`a_${ci}_${ai}`,courseName:c.courseName,type:"homework",title:a.title,date:a.dueDate,weight:a.weight??null,estimatedHours:a.estimatedHours,topics:null,prepDays:null});
      });
      (c.exams||[]).forEach((e,ei)=>{
        out.push({key:`e_${ci}_${ei}`,courseName:c.courseName,type:"exam",title:e.title,date:e.date,weight:e.weight??null,estimatedHours:null,topics:e.topics||"",prepDays:e.prepDays||7});
      });
    });
    return out;
  });

  function updateRow(key,field,value){
    setRows(rs=>rs.map(r=>r.key===key?{...r,[field]:value}:r));
  }
  function removeRow(key){
    setRows(rs=>rs.filter(r=>r.key!==key));
  }
  function addRow(){
    // New row defaults to the first course found and homework type — student fills in the rest.
    // A stable, collision-safe local key since this doesn't come from the parsed AI response.
    const defaultCourse=rows[0]?.courseName||courses[0]?.name||"";
    setRows(rs=>[...rs,{key:`new_${Date.now()}_${Math.floor(Math.random()*1000)}`,courseName:defaultCourse,type:"homework",title:"",date:"",weight:null,estimatedHours:2,topics:null,prepDays:null}]);
  }

  const totalCourses=new Set(rows.map(r=>r.courseName)).size;

  async function handleConfirm(){
    setSaving(true);
    // Rebuild into the courses[].assignments/exams shape syncSyl expects, from the (possibly
    // edited) flat row list — type changes, date/weight edits, and removed rows all take effect.
    const byCourse={};
    rows.forEach(r=>{
      if(!byCourse[r.courseName])byCourse[r.courseName]={courseName:r.courseName,assignments:[],exams:[]};
      if(r.type==="homework"){
        byCourse[r.courseName].assignments.push({title:r.title,dueDate:r.date,weight:r.weight,estimatedHours:r.estimatedHours||2});
      }else{
        byCourse[r.courseName].exams.push({title:r.title,date:r.date,weight:r.weight,topics:r.topics||"",prepDays:r.prepDays||7});
      }
    });
    // Preserve meetingTimes from the original parse untouched — this screen only verifies duties.
    const origByCourse={};
    (parsed.courses||[]).forEach(c=>{origByCourse[c.courseName]=c.meetingTimes;});
    const rebuilt=Object.values(byCourse).map(c=>({...c,meetingTimes:origByCourse[c.courseName]||[]}));
    // finalizeSync does real work here — a course-difficulty lookup (network call) per NEW course
    // — awaiting it keeps the spinner visible for the actual duration, not just an instant flash.
    await onConfirm({...parsed,courses:rebuilt});
  }

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{background:"var(--card)",borderRadius:14,maxWidth:820,width:"100%",maxHeight:"85vh",display:"flex",flexDirection:"column",boxShadow:"0 20px 60px rgba(0,0,0,0.5)"}}>
        <div style={{padding:"20px 24px",borderBottom:"1px solid var(--b1)",flexShrink:0}}>
          <div style={{fontSize:18,fontWeight:600}}>Verify What We Found</div>
          <div style={{fontSize:13,color:"var(--t3)",marginTop:3}}>
            {rows.length} item{rows.length!==1?"s":""} across {totalCourses} course{totalCourses!==1?"s":""}. Check the Type column especially — fix anything that's not right, then confirm.
          </div>
        </div>
        <div style={{padding:"0 24px",overflowY:"auto",flex:1}}>
          {rows.length===0?(
            <div style={{color:"var(--t3)",padding:"20px 0"}}>Nothing was found to import.</div>
          ):(
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead style={{position:"sticky",top:0,background:"var(--card)",zIndex:1}}>
                <tr style={{borderBottom:"1px solid var(--b1)"}}>
                  <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"left",padding:"16px 8px 8px",fontWeight:600}}>Class</th>
                  <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"left",padding:"16px 8px 8px",fontWeight:600}}>Type</th>
                  <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"left",padding:"16px 8px 8px",fontWeight:600}}>Title</th>
                  <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"left",padding:"16px 8px 8px",fontWeight:600}}>Date</th>
                  <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"left",padding:"16px 8px 8px",fontWeight:600}}>Weight</th>
                  <th style={{width:36}}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r=>(
                  <tr key={r.key}>
                    <td style={{padding:"7px 8px"}}>
                      <select value={r.courseName} onChange={e=>updateRow(r.key,"courseName",e.target.value)} style={{fontSize:12,padding:"4px 6px",maxWidth:130}}>
                        {!courses.find(c=>c.name===r.courseName)&&r.courseName&&<option value={r.courseName}>{r.courseName}</option>}
                        {courses.map(c=><option key={c.id} value={c.name}>{c.name}</option>)}
                      </select>
                    </td>
                    <td style={{padding:"7px 8px"}}>
                      <select value={r.type} onChange={e=>updateRow(r.key,"type",e.target.value)}
                        style={{fontSize:12,padding:"4px 6px",width:100,
                          borderColor:r.type==="exam"?"var(--red)":"var(--blue)",
                          color:r.type==="exam"?"var(--red)":"var(--blue)"}}>
                        <option value="homework">Homework</option>
                        <option value="exam">Exam</option>
                      </select>
                    </td>
                    <td style={{padding:"7px 8px"}}>
                      <input value={r.title||""} onChange={e=>updateRow(r.key,"title",e.target.value)} style={{fontSize:13,padding:"4px 6px",width:"100%"}}/>
                    </td>
                    <td style={{padding:"7px 8px"}}>
                      <input type="date" value={r.date||""} onChange={e=>updateRow(r.key,"date",e.target.value)} style={{fontSize:12,padding:"4px 6px"}}/>
                    </td>
                    <td style={{padding:"7px 8px"}}>
                      <input type="number" min="0" max="100" step="0.5" value={r.weight??""} onChange={e=>updateRow(r.key,"weight",e.target.value===""?null:+e.target.value)}
                        placeholder="—" style={{fontSize:12,padding:"4px 6px",width:60}}/>
                    </td>
                    <td style={{padding:"7px 8px"}}>
                      <button className="tt" data-tt="Remove this item" onClick={()=>removeRow(r.key)}
                        style={{padding:"4px 6px",borderRadius:6,border:"none",cursor:"pointer",background:"transparent",color:"var(--red)"}}>
                        <i className="ti ti-x" style={{fontSize:14}}/>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <button className="btn btn-ghost btn-sm" style={{marginTop:10,marginBottom:16}} onClick={addRow}>
            <i className="ti ti-plus" style={{marginRight:5}}/>Add missing item
          </button>
        </div>
        <div style={{padding:"14px 24px",borderTop:"1px solid var(--b1)",display:"flex",justifyContent:"flex-end",gap:8,flexShrink:0}}>
          <button className="btn btn-ghost" onClick={onCancel} disabled={saving}>Cancel — don't save anything</button>
          <button className="btn btn-action" onClick={handleConfirm} disabled={saving}>
            {saving?<><Sp/> Saving...</>:<><i className="ti ti-check" style={{marginRight:6}}/>Looks good, save all</>}
          </button>
        </div>
      </div>
    </div>
  );
}



function BlockEditModal({dateStr,block,courses,weekDates,onSave,onDelete,onClose,onComplete}){
  const isNew=!block;
  const [type,setType]=useState(block?(block.courseId?"homework":block.kind==="chore"?"chore":"personal"):"personal");
  const [courseId,setCourseId]=useState(block?.courseId||(courses[0]?.id||""));
  const [description,setDescription]=useState(block?.description||block?.label||"");
  const [startTime,setStartTime]=useState(block?m2t(block.s):"18:00");
  const [endTime,setEndTime]=useState(block?m2t(block.e):"19:00");
  const [confirmingDelete,setConfirmingDelete]=useState(false);
  const [completed,setCompleted]=useState(block?.completed||false);
  // Which day to add this new activity to — only relevant when adding (isNew), since an existing
  // block always stays on the day it's actually placed. Defaults to whatever day the modal was
  // opened from (today, when opened via the Weekly header's + button), but can be moved to any
  // other day in the currently-viewed week, filtered to today-forward per the explicit ask —
  // you can't backdate a new activity into a day that's already passed.
  const today=iso();
  const selectableDates=isNew?(weekDates||[]).filter(d=>d>=today):[];
  const [selectedDate,setSelectedDate]=useState(dateStr);
  const effectiveDate=isNew?selectedDate:dateStr;

  function handleSave(){
    const s=t2m(startTime),e=t2m(endTime);
    if(!Number.isFinite(s)||!Number.isFinite(e)||e<=s)return;
    const now=new Date().toISOString();
    const kind=type==="homework"?"homework":type==="chore"?"chore":"personal";
    const finalCourseId=type==="homework"?(courseId||null):null;
    const wasCompleted=block?.completed||false;
    const nowCompleted=completed;
    // Only genuine content changes (what/when/which course) count as the student authoring or
    // customizing this block — toggling "Mark Complete" by itself does not. Without this check,
    // simply checking off a plain AI-planned block would permanently flag it as userEdited, which
    // then made it immune to "Clear study plan" — a block that's just been completed should still
    // be treated as planner-generated and safe to clear/regenerate, not as a manual creation.
    const contentChanged=isNew
      ||description!==(block?.description||"")
      ||s!==block?.s||e!==block?.e
      ||finalCourseId!==(block?.courseId??null);
    const newUserEdited=contentChanged?true:(block?.userEdited||false);
    const newBlock={
      id:block?.id||`blk_${effectiveDate}_${Date.now()}_${Math.floor(Math.random()*1000)}`,
      courseId:finalCourseId,
      source:block?.source||null,
      kind,
      label:description||(type==="homework"?"Study":type==="chore"?"Chore":"Personal"),
      description,
      s,e,
      userEdited:newUserEdited,
      completed:nowCompleted,
      createdAt:block?.createdAt||now,
      editedAt:isNew?null:now,
      completedAt:nowCompleted?(block?.completedAt||now):null,
    };
    onSave(effectiveDate,newBlock);
    // Only log a completion event on the actual false→true transition — toggling it back off,
    // or saving with no change to completed status, isn't a "did the session happen" signal.
    if(!wasCompleted&&nowCompleted&&onComplete){
      const plannedStart=block?m2t(block.s):startTime;
      const plannedEnd=block?m2t(block.e):endTime;
      onComplete({
        blockId:newBlock.id,source:newBlock.source,courseId:newBlock.courseId,
        plannedStart,plannedEnd,actualCompletedAt:now,
        onTime:dateStr>=iso(), // completed on or after the day it was scheduled for — a rough same-day proxy
      });
    }
    onClose();
  }

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{background:"var(--card)",borderRadius:14,maxWidth:460,width:"100%",boxShadow:"0 20px 60px rgba(0,0,0,0.5)"}}>
        <div style={{padding:"18px 22px",borderBottom:"1px solid var(--b1)"}}>
          <span style={{fontSize:17,fontWeight:600}}>{isNew?"Add Activity":"Edit Activity"}</span>
          {!(isNew&&selectableDates.length>1)&&(
            <div style={{fontSize:12,color:"var(--t3)",marginTop:3}}>{new Date(effectiveDate+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"short",day:"numeric"})}</div>
          )}
        </div>
        <div style={{padding:"18px 22px"}}>
          {isNew&&selectableDates.length>1&&(
            <div style={{marginBottom:12}}>
              <label style={{fontSize:12,color:"var(--t3)",display:"block",marginBottom:5}}>Date</label>
              <select value={selectedDate} onChange={e=>setSelectedDate(e.target.value)} style={{width:"100%"}}>
                {selectableDates.map(d=>(
                  <option key={d} value={d}>{new Date(d+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"short",day:"numeric"})}{d===today?" (today)":""}</option>
                ))}
              </select>
            </div>
          )}
          <div style={{marginBottom:12}}>
            <label style={{fontSize:12,color:"var(--t3)",display:"block",marginBottom:5}}>Type</label>
            <select value={type} onChange={e=>setType(e.target.value)} style={{width:"100%"}}>
              <option value="homework">Study / Homework</option>
              <option value="personal">Personal / Social</option>
              <option value="chore">Chore</option>
            </select>
          </div>
          {type==="homework"&&(
            <div style={{marginBottom:12}}>
              <label style={{fontSize:12,color:"var(--t3)",display:"block",marginBottom:5}}>Course</label>
              <select value={courseId} onChange={e=>setCourseId(+e.target.value)} style={{width:"100%"}}>
                {courses.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          <div style={{marginBottom:12}}>
            <label style={{fontSize:12,color:"var(--t3)",display:"block",marginBottom:5}}>Description</label>
            <input value={description} onChange={e=>setDescription(e.target.value)} placeholder="e.g. Study with Sarah for MATH midterm" style={{width:"100%"}}/>
          </div>
          <div className="g2" style={{marginBottom:4}}>
            <div><label style={{fontSize:12,color:"var(--t3)",display:"block",marginBottom:5}}>Start</label><input type="time" value={startTime} onChange={e=>setStartTime(e.target.value)}/></div>
            <div><label style={{fontSize:12,color:"var(--t3)",display:"block",marginBottom:5}}>End</label><input type="time" value={endTime} onChange={e=>setEndTime(e.target.value)}/></div>
          </div>
          {!isNew&&(
            <div style={{marginTop:12,display:"flex",alignItems:"center",gap:8,padding:"9px 11px",background:completed?"var(--green-bg)":"var(--card2)",borderRadius:8,cursor:"pointer"}}
              onClick={()=>setCompleted(c=>!c)}>
              <div style={{width:20,height:20,borderRadius:5,border:`2px solid ${completed?"var(--green)":"var(--t3)"}`,background:completed?"var(--green)":"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                {completed&&<i className="ti ti-check" style={{fontSize:13,color:"#0a2410"}}/>}
              </div>
              <span style={{fontSize:14,color:completed?"var(--green)":"var(--t2)"}}>Mark as completed</span>
            </div>
          )}
        </div>
        <div style={{padding:"14px 22px",borderTop:"1px solid var(--b1)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          {!isNew&&onDelete?(
            confirmingDelete?(
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <span style={{fontSize:13,color:"var(--red)"}}>Delete this activity?</span>
                <button className="btn btn-sm" style={{background:"var(--red)",color:"#fff"}} onClick={()=>{onDelete(dateStr,block.id);onClose();}}>Yes, delete</button>
                <button className="btn btn-ghost btn-sm" onClick={()=>setConfirmingDelete(false)}>Cancel</button>
              </div>
            ):(
              <button className="btn btn-ghost btn-sm" style={{color:"var(--red)"}} onClick={()=>setConfirmingDelete(true)}>
                <i className="ti ti-trash" style={{marginRight:4}}/>Delete
              </button>
            )
          ):<div/>}
          <div style={{display:"flex",gap:8}}>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-action" onClick={handleSave}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SyncResultModal({result,onClose,onPlanNow,planning}){
  if(!result)return null;
  const {added,skippedDuplicate,coursesFound,coursesCreated,itemsByCourse,fileNames,error}=result;
  const hasNewItems=added>0&&!error;
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{background:"var(--card)",borderRadius:14,maxWidth:560,width:"100%",maxHeight:"85vh",overflow:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.5)"}}>
        <div style={{padding:"20px 24px",borderBottom:"1px solid var(--b1)"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <i className={`ti ${error?"ti-alert-triangle":"ti-circle-check"}`} style={{fontSize:22,color:error?"var(--red)":"var(--green)"}}/>
            <span style={{fontSize:18,fontWeight:600}}>{error?"Sync failed":"Sync complete"}</span>
          </div>
          <div style={{fontSize:13,color:"var(--t3)",marginTop:6}}>{fileNames?.join(", ")}</div>
        </div>
        <div style={{padding:"20px 24px"}}>
          {error?(
            <div style={{color:"var(--red)",fontSize:14}}>{error}</div>
          ):(<>
            <div style={{display:"flex",gap:16,marginBottom:18,flexWrap:"wrap"}}>
              <div style={{background:"var(--green-bg)",borderRadius:10,padding:"10px 16px",flex:1,minWidth:120}}>
                <div style={{fontSize:24,fontWeight:700,color:"var(--green)"}}>{added}</div>
                <div style={{fontSize:12,color:"var(--t2)"}}>items added</div>
              </div>
              {coursesCreated>0&&(
                <div style={{background:"var(--blue-bg)",borderRadius:10,padding:"10px 16px",flex:1,minWidth:120}}>
                  <div style={{fontSize:24,fontWeight:700,color:"var(--blue)"}}>{coursesCreated}</div>
                  <div style={{fontSize:12,color:"var(--t2)"}}>courses created</div>
                </div>
              )}
              {skippedDuplicate>0&&(
                <div style={{background:"var(--amber-bg)",borderRadius:10,padding:"10px 16px",flex:1,minWidth:120}}>
                  <div style={{fontSize:24,fontWeight:700,color:"var(--amber)"}}>{skippedDuplicate}</div>
                  <div style={{fontSize:12,color:"var(--t2)"}}>already existed, skipped</div>
                </div>
              )}
            </div>
            {coursesFound?.length>0&&(
              <div style={{marginBottom:14}}>
                <div style={{fontSize:12,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:8}}>Courses found in this document</div>
                {coursesFound.map((c,i)=>(
                  <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:i<coursesFound.length-1?"1px solid var(--b1)":"none"}}>
                    <span style={{fontSize:14}}>{c}</span>
                    <span style={{fontSize:13,color:"var(--t3)"}}>{itemsByCourse?.[c]?.assignments||0} assignments, {itemsByCourse?.[c]?.exams||0} exams</span>
                  </div>
                ))}
              </div>
            )}
          </>)}
        </div>
        <div style={{padding:"16px 24px",borderTop:"1px solid var(--b1)",display:"flex",justifyContent:"flex-end",gap:10}}>
          <button className="btn btn-ghost" onClick={onClose} style={{padding:"8px 20px"}}>
            {hasNewItems?"Not now":"OK"}
          </button>
          {hasNewItems&&onPlanNow&&(
            <button className="btn btn-action" onClick={onPlanNow} disabled={planning} style={{padding:"8px 20px"}}>
              {planning?<><Sp sz={13}/> Planning...</>:<><i className="ti ti-sparkles"/> Create study plan</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Reusable "help" banner — unlike ConfirmModal, deliberately has NO backdrop-click-dismiss.
// The student must explicitly close it (closeLabel button), so it can't be accidentally skipped
// past without at least seeing it once.
function InfoModal({title,sections,closeLabel="Got it",onClose}){
  return(
    <div style={{
      position:"fixed",inset:0,zIndex:9000,
      background:"rgba(0,0,0,0.55)",
      display:"flex",alignItems:"center",justifyContent:"center",
      padding:20,
    }}>
      <div style={{
        background:"var(--card)",borderRadius:14,
        padding:"28px 32px",maxWidth:460,width:"100%",maxHeight:"85vh",overflowY:"auto",
        boxShadow:"0 24px 60px rgba(0,0,0,0.5)"
      }}>
        <div style={{fontSize:17,color:"var(--t1)",fontWeight:600,marginBottom:18}}>{title}</div>
        {sections.map((sec,i)=>(
          <div key={i} style={{marginBottom:i<sections.length-1?16:24}}>
            {sec.heading&&<div style={{fontSize:14,fontWeight:600,color:"var(--t1)",marginBottom:4}}>{sec.heading}</div>}
            <div style={{fontSize:13,color:"var(--t2)",lineHeight:1.6}}>{sec.body}</div>
          </div>
        ))}
        <button onClick={onClose} style={{width:"100%",padding:"10px 0",borderRadius:9,border:"none",cursor:"pointer",
          background:"var(--amber)",color:"#1a1206",fontSize:14,fontWeight:600,fontFamily:"inherit"}}>
          {closeLabel}
        </button>
      </div>
    </div>
  );
}


function ConfirmModal({message,confirmLabel="Yes",confirmIcon,onConfirm,onCancel}){
  return(
    <div style={{
      position:"fixed",inset:0,zIndex:9000,
      background:"rgba(0,0,0,0.55)",
      display:"flex",alignItems:"center",justifyContent:"center"
    }}
    onClick={onCancel}>
      <div
        onClick={e=>e.stopPropagation()}
        style={{
          background:"var(--card)",borderRadius:14,
          padding:"28px 32px",maxWidth:380,width:"90%",
          boxShadow:"0 24px 60px rgba(0,0,0,0.5)"
        }}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
          <i className="ti ti-alert-triangle" style={{fontSize:22,color:"var(--red)",flexShrink:0}}/>
          <span style={{fontSize:17,color:"var(--t1)"}}>Are you sure?</span>
        </div>
        <div style={{fontSize:14,color:"var(--t2)",lineHeight:1.6,marginBottom:24}}>
          {message}
        </div>
        <div style={{display:"flex",gap:10}}>
          <button
            onClick={onConfirm}
            style={{flex:1,padding:"10px 0",borderRadius:9,border:"none",cursor:"pointer",
              background:"var(--red)",color:"#fff",fontSize:14,fontFamily:"inherit",
              display:"flex",alignItems:"center",justifyContent:"center",gap:7}}>
            {confirmIcon&&<i className={`ti ${confirmIcon}`} style={{fontSize:15}}/>}{confirmLabel}
          </button>
          <button
            onClick={onCancel}
            style={{flex:1,padding:"10px 0",borderRadius:9,border:"none",cursor:"pointer",
              background:"var(--card2)",color:"var(--t2)",fontSize:14,fontFamily:"inherit"}}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// Hook for confirm dialog — use anywhere
function useConfirm(){
  const [state,setState]=React.useState(null);
  function confirm(message,opts){
    return new Promise(resolve=>{
      setState({message,resolve,confirmLabel:opts?.confirmLabel,confirmIcon:opts?.confirmIcon});
    });
  }
  function handleConfirm(){state?.resolve(true);setState(null);}
  function handleCancel(){state?.resolve(false);setState(null);}
  const modal=state?<ConfirmModal message={state.message} confirmLabel={state.confirmLabel} confirmIcon={state.confirmIcon} onConfirm={handleConfirm} onCancel={handleCancel}/>:null;
  return {confirm,modal};
}

function SecHead({icon,title,action}){
  return(
    <div className="sec-head">
      <div className="sec-title"><i className={`ti ${icon}`}/>{title}</div>
      {action}
    </div>
  );
}

function AddBtn({onClick,label="Add",disabled}){
  return(
    <button className="btn btn-action btn-sm" onClick={onClick} disabled={disabled}>
      <i className="ti ti-plus"/>{label}
    </button>
  );
}

function DelBtn({onClick,title="Delete"}){
  return(
    <button className="btn btn-del btn-sm tt" data-tt={title} onClick={onClick}>
      <i className="ti ti-trash" style={{fontSize:15}}/>
    </button>
  );
}

function DiffBadge({score,label}){
  if(!score)return null;
  const cls=score<=3?"diff1":score<=6?"diff4":score<=8?"diff7":"diff9";
  return <span className={cls}>{label||"Lvl"} {score}/10</span>;
}

function PdfDrop({label,hint,onFiles,files=[],multi=false}){
  const ref=useRef(null);
  const [drag,setDrag]=useState(false);
  const [rejected,setRejected]=useState(0);
  function isPdf(f){
    // Some PDFs (from Preview, scanners, some cloud exports) don't set MIME type reliably —
    // fall back to checking the file extension as well.
    return f.type==="application/pdf"||/\.pdf$/i.test(f.name||"");
  }
  function handle(fs){
    const pdfs=fs.filter(isPdf);
    setRejected(fs.length-pdfs.length);
    if(pdfs.length)onFiles(multi?pdfs:[pdfs[0]]);
  }
  return(
    <div>
      <div onDragOver={e=>{e.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)}
        onDrop={e=>{e.preventDefault();setDrag(false);handle(Array.from(e.dataTransfer.files));}}
        onClick={()=>ref.current?.click()}
        style={{background:drag?"var(--blue-bg)":"var(--card2)",borderRadius:10,padding:"18px",textAlign:"center",cursor:"pointer",transition:"background 0.15s",marginBottom:10}}>
        <i className="ti ti-file-type-pdf" style={{fontSize:24,color:"var(--amber)",display:"block",marginBottom:7}}/>
        <div style={{fontSize:14,color:"var(--t1)",marginBottom:3}}>{label}</div>
        <div style={{fontSize:12,color:"var(--t2)"}}>{hint}</div>
        <div style={{fontSize:11,color:"var(--t3)",marginTop:4}}>Drag &amp; drop or click to browse</div>
        <input ref={ref} type="file" accept=".pdf,application/pdf" {...(multi?{multiple:true}:{})} style={{display:"none"}} onChange={e=>{handle(Array.from(e.target.files));e.target.value="";}}/>
      </div>
      {rejected>0&&(
        <div style={{display:"flex",alignItems:"center",gap:8,padding:"7px 11px",background:"var(--red-bg)",borderRadius:7,marginBottom:5}}>
          <i className="ti ti-alert-triangle" style={{color:"var(--red)",fontSize:14}}/>
          <span style={{fontSize:13,color:"var(--red)"}}>{rejected} file{rejected>1?"s":""} skipped — not a PDF</span>
        </div>
      )}
      {files.map((f,i)=>(
        <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 11px",background:"var(--green-bg)",borderRadius:7,marginBottom:5}}>
          <i className="ti ti-file-check" style={{color:"var(--green)",fontSize:14}}/>
          <span style={{flex:1,fontSize:13,color:"var(--t1)"}}>{f.name}</span>
          <span style={{fontSize:11,color:"var(--t3)"}}>{(f.size/1024).toFixed(0)}KB</span>
        </div>
      ))}
    </div>
  );
}

function DayPick({val=[],onChange,col="var(--blue)"}){
  return(
    <div className="row">
      {DS.map((d,i)=>(
        <button key={i} className="btn btn-sm"
          style={{minWidth:38,background:val.includes(i)?col+"22":undefined,color:val.includes(i)?col:"var(--t3)"}}
          onClick={()=>onChange(val.includes(i)?val.filter(x=>x!==i):[...val,i])}>{d}</button>
      ))}
    </div>
  );
}

function StatCard({label,value,sub,col,icon}){
  return(
    <div style={{background:"var(--card)",borderRadius:10,padding:"14px",textAlign:"center"}}>
      {icon&&<i className={`ti ${icon}`} style={{fontSize:18,color:col,display:"block",marginBottom:5}}/>}
      <div style={{fontSize:11,color:"var(--t3)",marginBottom:5,textTransform:"uppercase",letterSpacing:"0.08em"}}>{label}</div>
      <div style={{fontSize:24,color:col,lineHeight:1}}>{value}<span style={{fontSize:12,color:"var(--t3)"}}>{sub}</span></div>
    </div>
  );
}

// ── Calendar components ──────────────────────────────────────────────────────
function WeekGrid({data,upd,onDay,weekStart,refreshWeekPlan,busy,editState,setEditState}){
  const START=7,END=24,TOTAL=(END-START)*60;
  function pct(m){return((m-START*60)/TOTAL*100).toFixed(4)+"%";}
  function dpct(m){return(m/TOTAL*100).toFixed(4)+"%";}

  const ws=weekStart?new Date(weekStart):(()=>{const d=new Date();d.setDate(d.getDate()-d.getDay());return d;})();
  const dates=Array.from({length:7},(_,i)=>{const d=new Date(ws);d.setDate(ws.getDate()+i);return iso(d);});
  const now=new Date(),nowMins=now.getHours()*60+now.getMinutes(),todayStr=iso();
  const gridLines=[8,10,12,14,16,18,20,22,24];
  const majorHours=[8,10,12,14,16,18,20,22];
  const ROW=72;
  const weekKey=iso(ws);
  const storedWeek=data.studyPlan?.weeks?.[weekKey];

  // Thin wrappers around the standalone functions (defined above, shared with Today) — keeps
  // the existing onSave={saveBlockToDay} etc. call sites below working with their original 2-arg shape.
  const saveBlock=(dateStr,block)=>saveBlockToDay(data,upd,dateStr,block);
  const deleteBlock=(dateStr,blockId)=>deleteBlockFromDay(data,upd,dateStr,blockId);
  const logComplete=entry=>logCompletion(data,upd,entry);

  return(
    <div>
      {/* Time axis — marginLeft matches timeline start for centered labels */}
      <div style={{position:"relative",height:12,marginLeft:84,marginBottom:4}}>
        {majorHours.map(h=>(
          <div key={h} style={{
            position:"absolute",left:pct(h*60),
            transform:"translateX(-50%)",
            fontSize:12,color:"var(--t1)",fontWeight:500,whiteSpace:"nowrap",lineHeight:1,
          }}>
            {h<12?`${h}am`:h===12?"12pm":`${h-12}pm`}
          </div>
        ))}
      </div>

      {/* Extra top padding so tooltips on the first row's blocks have room to render without being clipped */}
      <div style={{paddingTop:28}}>
      {/* All day rows — no gap, continuous grid lines. No overflow:hidden here — that
          would clip tooltips that extend above/beside a block; corners are rounded per-row instead. */}
      <div>
        {dates.map((dateStr,di)=>{
          const isToday=dateStr===todayStr;
          const dt=new Date(dateStr+"T12:00:00");
          // Read from the persistent stored plan when this week has been planned; otherwise fall
          // back to a live (unpersisted) computation just so the day isn't blank — the "Plan this
          // week" button above is how the student turns that into a real, durable plan.
          const rawBlocks=storedWeek?.days?.[dateStr]||[]; // no fictional fallback — an unplanned week shows real fixed events only; "Plan this week"/"Refresh Plan" in the header is the honest next step, not a silently-guessed schedule
          const enriched=data.quarterPlan?.tasksByDate?.[dateStr];
          const dayStudyBlocks=rawBlocks.map((b,bi)=>({time:m2t(b.s),duration:b.e-b.s,task:b.description||(enriched&&enriched[bi])||b.label,courseId:b.courseId,course:b.course,kind:b.kind,id:b.id,userEdited:b.userEdited,completed:b.completed,source:b.source}));
          const allDayBlocks=buildBlocks(dateStr,data,dayStudyBlocks)
            .filter(b=>b.type!=="sleep"&&b.e>(START*60)&&b.s<(END*60))
            .map(b=>({...b,s:Math.max(b.s,START*60),e:Math.min(b.e,END*60)}));
          const deadlineBlocks=allDayBlocks.filter(b=>b.type==="deadline");
          const blocks=assignLanesClustered(allDayBlocks.filter(b=>b.type!=="deadline"&&b.e-b.s>=5));
          const nowPct=isToday&&nowMins>=(START*60)&&nowMins<=(END*60)?pct(nowMins):null;

          return(
            <div key={di} style={{
              display:"flex",alignItems:"stretch",
              background:isToday?"#505a72":"#3a4050",
              borderRadius:di===0?"8px 8px 0 0":di===6?"0 0 8px 8px":0,
            }}>
              {/* Day label */}
              <div onClick={()=>onDay(dateStr)} style={{
                width:84,flexShrink:0,cursor:"pointer",
                display:"flex",flexDirection:"column",alignItems:"flex-end",
                justifyContent:"center",paddingRight:12,height:ROW,

              }}>
                <div style={{fontSize:11,color:isToday?"var(--amber)":"var(--t3)",
                  textTransform:"uppercase",letterSpacing:"0.07em",lineHeight:1,marginBottom:3}}>
                  {DS[di]}
                </div>
                <div style={{fontSize:16,color:isToday?"var(--amber)":"var(--t1)",
                  lineHeight:1,fontWeight:500}}>
                  {dt.getDate()}
                </div>
              </div>

              {/* Timeline */}
              <div style={{flex:1,position:"relative",height:ROW}}>
                {/* Grid lines — every 2hrs */}
                {gridLines.map(h=>(
                  <div key={h} style={{
                    position:"absolute",top:0,bottom:0,left:pct(h*60),width:1,
                    background:"rgba(122,172,224,0.22)",
                  }}/>
                ))}

                {/* Baseline — thin gray line, full width */}
                <div style={{
                  position:"absolute",
                  left:0,right:0,
                  top:"50%",marginTop:7,
                  height:1,background:"rgba(160,175,190,0.28)",
                  zIndex:1,
                }}/>

                {/* Now line */}
                {nowPct&&(
                  <div style={{
                    position:"absolute",top:0,bottom:0,left:nowPct,
                    width:2,background:"var(--amber)",zIndex:10,
                  }}/>
                )}

                {/* Activity blocks — every bar's bottom edge sits exactly ON the baseline line
                    (BASELINE = 50%+7px, matching the baseline element above), with its label
                    directly above the bar. When multiple blocks overlap the same time range,
                    each additional lane stacks upward from that same baseline instead of downward,
                    so there's always one single shared reference line every bar touches. */}
                {blocks.map((b,bi)=>{
                  const dur=b.e-b.s;
                  const c=tc(b.type);
                  const numLanes=b.clusterLanes||1;
                  const showLabel=dur>=20&&(ROW/numLanes)>=18;
                  const BLOCK_H=numLanes>1?5:7;
                  const LABEL_H=showLabel?15:0;
                  const GAP=showLabel?3:0;
                  const BASELINE=ROW/2+7; // px from row top — matches the baseline element exactly
                  const LANE_STEP=BLOCK_H+LABEL_H+GAP+4; // vertical space each stacked lane needs
                  const bottom=BASELINE-(b.lane*LANE_STEP); // bar's bottom edge — lane 0 sits ON the baseline
                  const containerTop=bottom-BLOCK_H-LABEL_H-GAP;
                  const tooltip=`${f12(m2t(b.s))} – ${f12(m2t(b.e))} · ${b.label}${b.autoMoved?" — auto-shifted to avoid a class/exam conflict":""}${b.completed?" ✓ completed":""}`;
                  const posPct=(b.s-START*60)/TOTAL*100;
                  const ttClass=posPct>75?"tt tt-right":posPct<15?"tt tt-left":"tt";
                  const editable=!!b.id; // only blocks that came from studyPlan storage (have a stable id) are editable
                  return(
                    <div key={bi} className={ttClass} data-tt={tooltip}
                      onDoubleClick={editable?()=>setEditState({dateStr,block:b}):undefined}
                      style={{
                      position:"absolute",
                      left:pct(b.s),width:dpct(dur),
                      top:Math.max(0,containerTop),
                      height:BLOCK_H+LABEL_H+GAP, // explicit, matching the containerTop math exactly —
                        // relying on natural content-flow height here left a gap between what the
                        // position math assumed and what actually rendered, most visible on
                        // no-label (short-duration) blocks where there's less content to fill it
                      zIndex:3,
                      cursor:editable?"pointer":"default",
                    }}>
                      {showLabel&&(
                        <div style={{
                          fontSize:12,color:c.text,lineHeight:1.2,
                          paddingLeft:3,marginBottom:GAP,
                          whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:"100%",
                        }}>
                          {b.autoMoved&&"↻ "}{b.completed&&"✓ "}{b.label}
                        </div>
                      )}
                      <div style={{
                        width:"100%",height:BLOCK_H,
                        background:c.line,borderRadius:2,
                        opacity:b.type==="commute"?0.45:b.completed?0.4:1,
                      }}/>
                    </div>
                  );
                })}

                {/* Assignment deadlines — red diamond milestone marker, placed 1hr before due */}
                {deadlineBlocks.map((b,bi)=>{
                  const course=data.courses.find(c=>c.id===b.courseId);
                  const courseName=course?course.name:"(unknown course)";
                  const dueLabel=f12(m2t(b.dueMin));
                  const tooltip=`${courseName} · ${b.title} · Due ${dueLabel}`;
                  const posPct=(b.s-START*60)/TOTAL*100;
                  const ttClass=posPct>75?"tt tt-right":posPct<15?"tt tt-left":"tt";
                  return(
                    <div key={`d${bi}`} className={ttClass} data-tt={tooltip} style={{
                      position:"absolute",
                      left:pct(b.s),
                      top:ROW/2+7, // matches BASELINE used by activity bars exactly
                      transform:"translate(-50%,-50%)",
                      width:10,height:10,
                      zIndex:5,
                      cursor:"default",
                    }}>
                      <div style={{
                        width:"100%",height:"100%",
                        background:"#c04020",
                        transform:"rotate(45deg)",
                        borderRadius:2,
                        boxShadow:"0 0 0 2px var(--card)",
                      }}/>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      </div>

      {/* Legend */}
      <div style={{display:"flex",gap:18,flexWrap:"wrap",marginTop:14,paddingLeft:96,paddingTop:10,borderTop:"1px solid var(--b1)"}}>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <div style={{width:9,height:9,background:"#c04020",transform:"rotate(45deg)",borderRadius:2,flexShrink:0}}/>
          <span style={{fontSize:12,color:"var(--t2)"}}>Assignment Due</span>
        </div>
        {[["exam","Exam"],["class","Class"],["homework","HW Prep"],["study","Study"]].map(([type,label])=>(
          <div key={type} style={{display:"flex",alignItems:"center",gap:6}}>
            <div style={{width:22,height:5,borderRadius:2,background:tc(type).line}}/>
            <span style={{fontSize:12,color:"var(--t2)"}}>{label}</span>
          </div>
        ))}
        <div style={{width:1,alignSelf:"stretch",background:"var(--b1)"}}/>
        {[["breakfast","Meals"],["gym","Gym"],["chore","Chores"],["fun","Events"]].map(([type,label])=>(
          <div key={type} style={{display:"flex",alignItems:"center",gap:6}}>
            <div style={{width:22,height:5,borderRadius:2,background:tc(type).line}}/>
            <span style={{fontSize:12,color:"var(--t2)"}}>{label}</span>
          </div>
        ))}
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <div style={{width:2,height:14,background:"var(--amber)",borderRadius:1}}/>
          <span style={{fontSize:12,color:"var(--t2)"}}>Now</span>
        </div>
        <div style={{marginLeft:"auto",fontSize:11,color:"var(--t3)"}}>
          <i className="ti ti-hand-click" style={{marginRight:5}}/>Double-click an activity to edit
        </div>
      </div>
      {editState&&(
        <BlockEditModal
          dateStr={editState.dateStr}
          block={editState.block}
          courses={data.courses}
          weekDates={dates}
          onSave={saveBlock}
          onDelete={editState.block?deleteBlock:null}
          onComplete={logComplete}
          onClose={()=>setEditState(null)}
        />
      )}
    </div>
  );
}


function Timeline({dateStr,data,upd,studyBlocks=[]}){
  const SH=7,EH=24,SM=SH*60;
  const SPLIT_1=12,SPLIT_2=17; // noon and 5pm — three side-by-side columns (Morning/Afternoon/Evening)
  const PPM=1.7; // pixels per minute — tuned so even the shortest column (5h) stays comfortably readable
  const allBlocksRaw=buildBlocks(dateStr,data,studyBlocks).filter(b=>b.e>SM&&b.s<EH*60);
  const now=new Date(),nm=now.getHours()*60+now.getMinutes(),isToday=dateStr===iso();
  // Editing is opt-in (only when upd is provided) and only for blocks that came from the real
  // persisted plan (buildBlocks only carries an id through for those — fixed items like class,
  // meals, gym, sleep, commute never have one). BlockEditModal needs the RAW stored block shape,
  // not buildBlocks' display-shaped output, so it's looked up by id at click-time.
  const [editState,setEditState]=useState(null);
  const editable=!!upd;

  // One column's worth of the timeline — hour axis + blocks + now-line + deadline markers, all
  // scoped to [colStart,colEnd). All three columns call this with identical logic, just a
  // different hour range and pre-filtered block set.
  function renderColumn(key,label,colStartH,colEndH){
    const colStart=colStartH*60,colEnd=colEndH*60;
    const colAllBlocks=allBlocksRaw.filter(b=>b.s>=colStart&&b.s<colEnd);
    const colDeadlines=colAllBlocks.filter(b=>b.type==="deadline");
    const colBlocks=assignLanesClustered(colAllBlocks.filter(b=>b.type!=="deadline"));
    const colH=(colEndH-colStartH)*60*PPM;
    const ny=isToday&&nm>=colStart&&nm<colEnd?(nm-colStart)*PPM:-1;
    const hrs=[];
    for(let h=colStartH;h<=colEndH;h++)hrs.push(h);

    return(
      <div key={key} style={{flex:1,minWidth:0}}>
        <div style={{marginBottom:8,paddingBottom:6,borderBottom:"1px solid var(--b1)"}}>
          <div style={{fontSize:11,fontWeight:600,color:"var(--t2)",textTransform:"uppercase",letterSpacing:"0.06em"}}>{label}</div>
          <div style={{fontSize:11,color:"var(--t3)"}}>{colStartH<12?`${colStartH}am`:colStartH===12?"12pm":`${colStartH-12}pm`} – {colEndH===24?"12am":colEndH<12?`${colEndH}am`:colEndH===12?"12pm":`${colEndH-12}pm`}</div>
        </div>
      <div style={{display:"flex",gap:0}}>
        {/* Time axis */}
        <div style={{width:44,flexShrink:0,position:"relative",height:colH}}>
          {hrs.map(h=>{
            const y=(h*60-colStart)*PPM;
            return(
              <div key={h} style={{position:"absolute",top:y-7,right:0,textAlign:"right",lineHeight:1}}>
                <span style={{fontSize:12,color:"var(--t1)",fontWeight:500}}>
                  {h===24?"12am":h<12?`${h}am`:h===12?"12pm":`${h-12}pm`}
                </span>
              </div>
            );
          })}
        </div>

        {/* Main area */}
        <div style={{flex:1,position:"relative",height:colH,minWidth:0}}>
          {hrs.map(h=>{
            const y=(h*60-colStart)*PPM;
            return(
              <div key={h} style={{position:"absolute",top:y,left:0,right:0,height:1,background:"var(--b1)",opacity:0.35}}/>
            );
          })}

          {ny>0&&(
            <div style={{position:"absolute",top:ny,left:0,right:0,height:2,background:"var(--amber)",zIndex:10,borderRadius:1}}>
              <div style={{position:"absolute",left:-5,top:-4,width:10,height:10,borderRadius:"50%",background:"var(--amber)"}}/>
            </div>
          )}

          {colBlocks.map((b,i)=>{
            const top=(b.s-colStart)*PPM;
            const height=Math.max(18,(b.e-b.s)*PPM);
            const c=tc(b.type);
            const cl=b.clusterLanes||1;
            const laneStyle=cl>1
              ?{left:`calc(${(100/cl)*b.lane}% + 3px)`,width:`calc(${100/cl}% - 6px)`}
              :{left:4,right:4};
            const tooltip=`${f12(m2t(b.s))} – ${f12(m2t(b.e))} · ${b.label}${b.autoMoved?" — auto-shifted to avoid a class/exam conflict":""}${b.completed?" ✓ completed":""}`;
            const ttClass=cl>1?(b.lane===0?"tt tt-left":b.lane===cl-1?"tt tt-right":"tt"):"tt";
            const canShowLabel=height>=32;

            return(
              <div key={i} className={ttClass} data-tt={tooltip}
                onDoubleClick={editable&&b.id!=null?()=>{const raw=findRawDayBlock(data,dateStr,b.id);if(raw)setEditState({dateStr,block:raw});}:undefined}
                style={{
                  position:"absolute",top:Math.max(0,top),height,...laneStyle,zIndex:2,
                  cursor:editable&&b.id!=null?"pointer":"default",
                  background:c.line+"26",borderLeft:`3px solid ${c.line}`,borderRadius:4,
                  padding:"3px 7px",overflow:"hidden",boxSizing:"border-box",
                  opacity:b.type==="sleep"?0.4:b.type==="commute"?0.6:b.completed?0.55:1,
                }}>
                <div style={{fontSize:11,color:c.text,fontWeight:600,lineHeight:1.25,whiteSpace:"nowrap"}}>
                  {f12(m2t(b.s))}{!canShowLabel&&` · ${b.label}`}
                </div>
                {canShowLabel&&(
                  <div style={{fontSize:12,color:c.text,lineHeight:1.3,overflow:"hidden",
                    display:"-webkit-box",WebkitLineClamp:Math.max(1,Math.floor((height-16)/15)),WebkitBoxOrient:"vertical"}}>
                    {b.autoMoved&&"↻ "}{b.completed&&"✓ "}{b.label}
                  </div>
                )}
              </div>
            );
          })}

          {colDeadlines.map((b,i)=>{
            const top=(b.s-colStart)*PPM;
            const course=data.courses.find(c=>c.id===b.courseId);
            const courseName=course?course.name:"(unknown course)";
            const dueLabel=f12(m2t(b.dueMin));
            const tooltip=`${courseName} · ${b.title} · Due ${dueLabel}`;
            return(
              <div key={`d${i}`} className="tt" data-tt={tooltip} style={{
                position:"absolute",top:top-6,left:4,right:4,zIndex:5,
                display:"flex",alignItems:"center",gap:6,cursor:"default",
              }}>
                <div style={{width:12,height:12,flexShrink:0,background:"#c04020",transform:"rotate(45deg)",borderRadius:2,boxShadow:"0 0 0 2px var(--bg)"}}/>
                <span style={{fontSize:11,color:"#f08060",fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                  Due {dueLabel} — {courseName}: {b.title}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      </div>
    );
  }

  return(
    <div>
      <div style={{display:"flex",gap:20}}>
        {renderColumn("am","Morning",SH,SPLIT_1)}
        {renderColumn("mid","Afternoon",SPLIT_1,SPLIT_2)}
        {renderColumn("pm","Evening",SPLIT_2,EH)}
      </div>
      {editState&&editable&&(
        <BlockEditModal
          dateStr={editState.dateStr}
          block={editState.block}
          courses={data.courses}
          onSave={(d,b)=>saveBlockToDay(data,upd,d,b)}
          onDelete={editState.block?(d,id)=>deleteBlockFromDay(data,upd,d,id):null}
          onComplete={entry=>logCompletion(data,upd,entry)}
          onClose={()=>setEditState(null)}
        />
      )}
    </div>
  );
}

// ── APP SHELL ────────────────────────────────────────────────────────────────
// Separate component (not inline in App) specifically so its draft state resets fresh every time
// it mounts — i.e. every time the modal opens — rather than persisting stale edits across opens.
// Unlike every other field in the app, this one deliberately does NOT auto-save on change: this
// is sensitive personal data (now including username/password placeholders), and per explicit
// instruction, updates here need a real, intentional Save action.
function AccountModal({data,updP,toast2,onClose}){
  const p=data.profile;
  const {confirm,modal}=useConfirm();
  const [draft,setDraft]=useState(()=>({
    name:p.name,lastName:p.lastName||"",phone:p.phone,email:p.email||"",
    homeAddress:p.homeAddress,username:p.username||"",password:p.password||"",
  }));
  const baseline=JSON.stringify({
    name:p.name,lastName:p.lastName||"",phone:p.phone,email:p.email||"",
    homeAddress:p.homeAddress,username:p.username||"",password:p.password||"",
  });
  const dirty=JSON.stringify(draft)!==baseline;
  const set=field=>e=>setDraft(d=>({...d,[field]:e.target.value}));

  function save(){
    updP(draft);
    toast2("Account details saved");
    onClose();
  }
  async function handleClose(){
    if(dirty){
      const ok=await confirm("Discard unsaved changes to your account details?",{confirmLabel:"Discard",confirmIcon:"ti-trash"});
      if(!ok)return;
    }
    onClose();
  }

  return(
    <div style={{position:"fixed",inset:0,zIndex:9000,background:"rgba(0,0,0,0.55)",
      display:"flex",alignItems:"center",justifyContent:"center",padding:20}}
      onClick={handleClose}>
      <div style={{background:"var(--card)",borderRadius:14,padding:"20px 24px",
        maxWidth:420,width:"100%",maxHeight:"85vh",overflowY:"auto",
        boxShadow:"0 24px 60px rgba(0,0,0,0.5)"}}
        onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div style={{fontSize:16,fontWeight:600,color:"var(--t1)"}}>
            <i className="ti ti-user-circle" style={{marginRight:8,color:"var(--blue)"}}/>Account
          </div>
          <button className="btn btn-ghost btn-sm" onClick={handleClose}><i className="ti ti-x"/></button>
        </div>
        <div className="g2" style={{marginBottom:12}}>
          <div><label>First name</label><input value={draft.name} onChange={set("name")}/></div>
          <div><label>Last name</label><input value={draft.lastName} onChange={set("lastName")}/></div>
        </div>
        <div className="g2" style={{marginBottom:12}}>
          <div><label>WhatsApp</label><input value={draft.phone} onChange={set("phone")}/></div>
          <div><label>Email</label><input type="email" value={draft.email} onChange={set("email")}/></div>
        </div>
        <div style={{marginBottom:12}}><label>Home address</label><input value={draft.homeAddress} onChange={set("homeAddress")}/></div>
        <div style={{fontSize:12,color:"var(--t3)",marginBottom:14,paddingTop:6,borderTop:"1px solid var(--b1)"}}>
          For future login/authentication — not active yet.
        </div>
        <div className="g2" style={{marginBottom:18}}>
          <div><label>Username</label><input value={draft.username} onChange={set("username")}/></div>
          <div><label>Password</label><input type="password" value={draft.password} onChange={set("password")}/></div>
        </div>
        <button className={dirty?"btn btn-action":"btn btn-ghost"} style={{width:"100%"}} onClick={save} disabled={!dirty}>
          <i className="ti ti-device-floppy" style={{marginRight:6}}/>{dirty?"Save":"No changes to save"}
        </button>
      </div>
      {modal}
    </div>
  );
}

function App(){
  const [data,setD]=useState(()=>load()||{...ED});
  const [tab,setTab]=useState("today");
  const [busy,setBusy]=useState(false);
  // Dedicated to refreshQuarterPlan/refreshWeekPlan specifically — deliberately SEPARATE from
  // `busy` (which the shared ai() wrapper sets for any AI call anywhere, e.g. Today's brief
  // generation). Sharing one flag meant an unrelated AI call in flight elsewhere made the Weekly
  // "Refresh Plan" button show "Planning..." even though no planning was actually happening —
  // e.g. landing on Today (which auto-generates its brief via ai() on mount) then clicking into
  // Weekly while that call was still in flight.
  const [planning,setPlanning]=useState(false);
  // Shared progress status — one place all long-running operations report into, so only
  // ONE indicator ever shows at a time, with real detail about what's happening.
  // { label: "Reading PDF...", detail: "Itay_UCSD_Fall2026.pdf" } or null when idle.
  const [progress,setProgress]=useState(null);
  const [toast,setToast]=useState(null);
  const [api,setApi]=useState(null);
  const [planMsg,setPlanMsg]=useState("");
  const {confirm:confirmApp,modal:modalApp}=useConfirm();
  const [showAccount,setShowAccount]=useState(false);

  function upd(p){setD(prev=>{const n={...prev,...p};save(n);return n;});}
  function updP(p){upd({profile:{...data.profile,...p}});}
  function toast2(m,e){setToast({m,e});setTimeout(()=>setToast(null),3000);}

  // One-time legacy migration — synthesizes a school+term entry from existing profile fields the
  // first time this loads with terms[] still empty. Runs on every render but is a genuine no-op
  // once migrated (migrateLegacyTermIfNeeded returns null once terms[].length>0), so it's safe
  // without a separate version flag.
  useEffect(()=>{
    const migration=migrateLegacyTermIfNeeded(data);
    if(migration)upd(migration);
  },[data.terms?.length,data.profile.schoolName]); // eslint-disable-line

  // Keeps profile's termStart/termEnd/schoolName/schoolAddress/schoolType/collegeCalendar
  // mirrored to whichever term is currently active — every existing consumer of those fields
  // (the planner, getTermRange, isFin/isHol, WeekGrid) keeps working unchanged, now always
  // reflecting the active term instead of being hand-edited directly.
  useEffect(()=>{
    const patch=syncActiveTermToProfilePatch(data);
    if(patch)updP(patch);
  },[JSON.stringify(data.terms),JSON.stringify(data.schools)]); // eslint-disable-line

  async function ai(sys,pr,mx,opts){
    setBusy(true);
    try{const t=await AI(sys,pr,mx,opts);setBusy(false);return t;}
    catch(e){toast2(e.message,true);setBusy(false);return null;}
  }

  // Shared by both Weekly's "Refresh Plan" button and Settings' "Save & Replan" button — the same
  // single function, so there's no risk of them ever doing different things. Re-plans every day from
  // the current week forward through the end of the term (never backward). Deterministic placement
  // (times/targets) is always freshly recomputed from current settings, assignments, and exams; the
  // AI only writes specific task text for the already-placed slots, batched a couple weeks at a time.
  async function refreshQuarterPlan(){
    const rawTermRange=getTermRange(data.profile);
    const termRange=(()=>{
      if(!rawTermRange)return null;
      let{start,end}=rawTermRange;
      const allD=[
        ...data.exams.map(e=>e.date),
        ...data.assignments.filter(a=>a.dueDate&&a.dueDate.length===10).map(a=>a.dueDate),
      ].filter(Boolean);
      allD.forEach(d=>{if(d<start)start=d;if(d>end)end=d;});
      return{start,end};
    })();
    if(!termRange){toast2("Set your term dates in Settings → School Info first, so I know how far ahead to plan.",true);return;}
    const ok=await confirmApp(`Re-plan every day from this week through the end of your term (${termRange.end})? This uses your current settings, assignments, and exams. Any study blocks you've manually added or edited will be kept as-is.`);
    if(!ok)return;
    setPlanning(true);
    try{
      const today=iso(); // exact date, matching Clear Plan's own reference point — never round to the week's Sunday, or days before today within the current week get silently regenerated and lose whatever was there (including completed history), even though Clear Plan correctly protects those same days
      const startDateStr=today>termRange.start?today:termRange.start;
      const startDate=new Date(startDateStr+"T12:00:00");
      const endDate=new Date(termRange.end+"T12:00:00");
      const allDates=[];
      for(let d=new Date(startDate);d<=endDate;d.setDate(d.getDate()+1))allDates.push(iso(new Date(d)));
      if(!allDates.length){toast2("Nothing left to plan — the term has already ended.",true);setPlanning(false);return;}

      // Gather each day's existing userEdited blocks BEFORE planning — these must be known to
      // the planner as occupied time, not just spliced in afterward. The old code here called
      // planStudyBlocks(dateStr,data) with no userEditedBlocks argument at all, meaning freeSlots
      // treated the whole day as free even where a manually-edited block already sat — a real,
      // pre-existing overlap risk, fixed by this rewrite.
      const userEditedByDate={};
      allDates.forEach(dateStr=>{
        const ws=weekStartOf(dateStr);
        const priorDay=data.studyPlan?.weeks?.[ws]?.days?.[dateStr]||[];
        userEditedByDate[dateStr]=priorDay.filter(b=>b.userEdited);
      });

      setPlanMsg(`Planning ${allDates.length} days...`);
      const scopedData=termScopedForPlanning(data);
      const gapsByDayFn=(dateStr,userEdited)=>freeSlots(dateStr,scopedData,userEdited);
      const result=planHorizon(allDates,scopedData,gapsByDayFn,userEditedByDate);
      const placedByDate=result.blocksByDate;
      const tasksByDate={};
      allDates.forEach(dateStr=>{tasksByDate[dateStr]=[];});

      // Persist the actual block placements into data.studyPlan.weeks — this is the durable
      // scheduling data the calendar reads from; tasksByDate above is just AI-written label text
      // layered on top (currently always empty — see the no-AI-call note below). Group the flat
      // per-day placements into week entries.
      const weeksTouched={};
      allDates.forEach(ds=>{const ws=weekStartOf(ds);weeksTouched[ws]=true;});
      const newWeeks={...(data.studyPlan?.weeks||{})};
      Object.keys(weeksTouched).forEach(weekStart=>{
        const existingWeek=data.studyPlan?.weeks?.[weekStart];
        const days={};
        for(let i=0;i<7;i++){
          const d=new Date(weekStart+"T12:00:00");
          d.setDate(d.getDate()+i);
          const dateStr=iso(d);
          const priorDay=existingWeek?.days?.[dateStr]||[];
          // placedByDate already includes each day's userEdited blocks (planHorizon puts them
          // back in) — no need to re-splice them here.
          days[dateStr]=placedByDate[dateStr]!==undefined?placedByDate[dateStr]:priorDay;
        }
        newWeeks[weekStart]={
          generatedAt:new Date().toISOString(),
          generatedFrom:{
            courseCount:data.courses.length,
            assignmentCount:data.assignments.length,
            examCount:data.exams.length,
            profileHash:JSON.stringify({wake:data.profile.wakeTime,sleep:data.profile.sleepTime,focus:data.profile.focusMins,brk:data.profile.breakMins,preset:data.profile.sessionPreset}),
          },
          days,
        };
      });

      upd({
        quarterPlan:{tasksByDate,generatedAt:iso(),generatedThrough:allDates[allDates.length-1],datesPlanned:allDates.length,version:APP_VERSION,lastError:null},
        studyPlan:{weeks:newWeeks},
        briefCache:null,briefDate:null,planStale:false,
      });

      // Summary message — completion is never silent. Names any shortfall with exact hours, per
      // the agreed "plan shall not miss completion" rule, instead of a generic "done!" toast that
      // hides a real shortage.
      const totalBlocks=Object.values(placedByDate).reduce((s,b)=>s+b.length,0);
      if(result.shortfalls.length===0){
        toast2(`Re-planned ${allDates.length} days through ${termRange.end} — ${totalBlocks} blocks scheduled. Everything fits! 🎯`);
      }else{
        const names=result.shortfalls.slice(0,3).map(it=>`${it.title} (${it.plannedHours}h of ${it.desiredHours}h)`).join("; ");
        toast2(`Re-planned ${allDates.length} days — but ${result.shortfalls.length} item${result.shortfalls.length!==1?"s":""} came up short: ${names}${result.shortfalls.length>3?"…":""}. Check Academics → Study Preferences.`,true);
      }
    }catch(err){
      console.error("StudyOS: refreshQuarterPlan() failed —",err);
      toast2("Couldn't refresh the plan ("+(err?.message||"unknown error")+")",true);
      upd({quarterPlan:{...(data.quarterPlan||{}),lastError:err?.message||"unknown error",lastErrorAt:iso(),version:APP_VERSION}});
    }
    setPlanMsg("");
    setPlanning(false);
  }

  // Mode 2 — "Update this particular week". Much cheaper than refreshQuarterPlan: recomputes only
  // the one week being viewed, using the same Phase 2 planner (planHorizon) over just that week's
  // 7 days — no cross-week demand awareness (an item partly covered by an adjacent week isn't
  // known here), but still real priority-driven placement, not the old memoryless per-day ramp.
  async function refreshWeekPlan(weekStart){
    const existingWeek=data.studyPlan?.weeks?.[weekStart];
    const today=iso();
    const dateStrs=[];
    for(let i=0;i<7;i++){
      const d=new Date(weekStart+"T12:00:00");
      d.setDate(d.getDate()+i);
      dateStrs.push(iso(d));
    }
    // Never re-plan a day that's already passed, even within an otherwise-touched week — matches
    // Clear Plan's own "today forward" boundary exactly.
    const plannableDateStrs=dateStrs.filter(d=>d>=today);
    const userEditedByDate={};
    plannableDateStrs.forEach(dateStr=>{
      userEditedByDate[dateStr]=(existingWeek?.days?.[dateStr]||[]).filter(b=>b.userEdited);
    });
    const scopedData=termScopedForPlanning(data);
    const gapsByDayFn=(dateStr,userEdited)=>freeSlots(dateStr,scopedData,userEdited);
    const result=plannableDateStrs.length?planHorizon(plannableDateStrs,scopedData,gapsByDayFn,userEditedByDate):{blocksByDate:{}};
    // Days before today keep their existing data completely untouched; only today-forward days
    // get the freshly-planned result.
    const days={};
    dateStrs.forEach(dateStr=>{
      days[dateStr]=dateStr<today?(existingWeek?.days?.[dateStr]||[]):(result.blocksByDate[dateStr]||[]);
    });
    const newWeek={
      generatedAt:new Date().toISOString(),
      generatedFrom:{
        courseCount:data.courses.length,
        assignmentCount:data.assignments.length,
        examCount:data.exams.length,
        profileHash:JSON.stringify({wake:data.profile.wakeTime,sleep:data.profile.sleepTime,focus:data.profile.focusMins,brk:data.profile.breakMins,preset:data.profile.sessionPreset}),
      },
      days,
    };
    upd({studyPlan:{weeks:{...(data.studyPlan?.weeks||{}),[weekStart]:newWeek}},planStale:false});
    if(result.shortfalls.length===0){
      toast2("Week updated — everything fits!");
    }else{
      const names=result.shortfalls.slice(0,2).map(it=>`${it.title} (${it.plannedHours}h of ${it.desiredHours}h)`).join("; ");
      toast2(`Week updated — ${result.shortfalls.length} item${result.shortfalls.length!==1?"s":""} came up short: ${names}. Check Academics → Study Preferences.`,true);
    }
  }

  useEffect(()=>{
    fetch("/api/health").then(r=>r.json()).then(j=>setApi(j.hasApiKey)).catch(()=>setApi(false));
  },[]);

  // Daily browser-notification reminder for due dates / exam prep — fires at most once per day
  useEffect(()=>{
    if(!data.onboarded)return;
    if(data.profile.remindersOn===false)return;
    if(typeof Notification==="undefined"||Notification.permission!=="granted")return;
    const key="studyos_notified_"+iso();
    if(localStorage.getItem(key))return;
    const items=urgentItems(data);
    if(items.length){
      try{
        new Notification("StudyOS — today's priorities",{body:items.slice(0,3).join("\n")});
        localStorage.setItem(key,"1");
      }catch{}
    }
  },[data.onboarded]);

  const p=data.profile,q=getQ(p),td=iso(),fin=isFin(td,p),hol=isHol(td,p);
  const missing=data.assignments.filter(a=>!a.dueDate&&a.status!=="done").length;

  const TABS=data.onboarded?[
    {id:"today",   icon:"ti-sun",          label:"Today"},
    {id:"week",    icon:"ti-calendar-week",label:"Weekly"},
    {id:"acad",    icon:"ti-school",       label:"Academics"},
    {id:"prog",    icon:"ti-chart-bar",    label:"Progress"},
    {id:"history", icon:"ti-history",      label:"History"},
    {id:"school",  icon:"ti-building",     label:"School Info"},
    {id:"settings",icon:"ti-settings",    label:"Preferences"},
  ]:[];

  return(
    <div style={{fontFamily:"'Inter',sans-serif",minHeight:"100vh",background:"var(--bg)",color:"var(--t1)"}}>
      {/* FIXED HEADER — top bar + nav never scroll, only the content below does */}
      <div style={{position:"fixed",top:0,left:0,right:0,zIndex:100}}>
        {/* TOP BAR */}
        <div style={{background:"var(--surface)",padding:"0 20px",display:"flex",alignItems:"center",gap:12,height:50,borderBottom:"1px solid var(--b1)"}}>
          <span style={{fontFamily:"'Syne',sans-serif",fontSize:18,fontWeight:700,background:"linear-gradient(120deg,var(--blue),var(--teal))",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",flexShrink:0}}>StudyOS</span>
          {data.onboarded&&p.name&&<span style={{fontSize:13,color:"var(--t2)"}}>Hey {p.name}</span>}
          {q&&<span className="badge badge-blue">{q.name}{fin&&" · Finals"}{hol&&" · Holiday"}</span>}
          {missing>0&&<span className="badge badge-amber" style={{cursor:"pointer"}} onClick={()=>setTab("acad")}>⚠ {missing} missing due date{missing>1?"s":""}</span>}
          <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:10}}>
            {api!==null&&<span className={`badge ${api?"badge-green":"badge-red"}`}>{api?"✓ Connected":"✗ No API key"}</span>}
            <span className="tt" data-tt={`Built ${APP_BUILD_DATE} ${APP_BUILD_TIME}`} style={{fontSize:11,color:"var(--t3)",flexShrink:0,cursor:"default"}}>
              v{APP_VERSION}
            </span>
            {data.onboarded&&(
              <button className="tt" data-tt="Account" onClick={()=>setShowAccount(true)}
                style={{width:28,height:28,borderRadius:"50%",border:"1px solid var(--b1)",background:"var(--card2)",
                  color:"var(--t2)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0,flexShrink:0}}>
                <i className="ti ti-user-circle" style={{fontSize:16}}/>
              </button>
            )}
          </div>
        </div>
        {/* NAV */}
        {data.onboarded&&(
          <div style={{background:"var(--surface)",padding:"0 20px",display:"flex",gap:2,overflowX:"hidden",borderBottom:"1px solid var(--b1)"}}>
            {TABS.map(t=>(
              <button key={t.id} onClick={()=>setTab(t.id)}
                style={{display:"flex",alignItems:"center",gap:5,padding:"11px 15px",fontSize:13,color:tab===t.id?"var(--amber)":"var(--t3)",background:"transparent",border:"none",cursor:"pointer",fontFamily:"inherit",fontWeight:400,borderBottom:tab===t.id?"2px solid var(--amber)":"2px solid transparent",marginBottom:-1,whiteSpace:"nowrap"}}>
                <i className={`ti ${t.icon}`} style={{fontSize:14}}/>{t.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {/* Spacer — reserves the space the fixed header would otherwise occupy, since fixed elements are removed from normal flow */}
      <div style={{height:data.onboarded?92:50}}/>
      {/* MAIN */}
      <div style={{maxWidth:tab==="week"?"100%":960,margin:"0 auto",padding:tab==="week"?"10px 14px":"20px 16px"}}>
        {!data.onboarded
          ?<Onboard data={data} upd={upd} updP={updP} ai={ai} busy={busy} toast2={toast2} setTab={setTab} setProgress={setProgress}/>
          :tab==="today"   ?<Today    data={data} upd={upd} ai={ai} busy={busy} toast2={toast2} refreshQuarterPlan={refreshQuarterPlan} planning={planning}/>
          :tab==="week"    ?<Week     data={data} upd={upd} ai={ai} busy={busy} planning={planning} toast2={toast2} refreshQuarterPlan={refreshQuarterPlan} refreshWeekPlan={refreshWeekPlan} planMsg={planMsg}/>
          :tab==="acad"    ?<Acad     data={data} upd={upd} ai={ai} busy={busy} planning={planning} toast2={toast2} progress={progress} setProgress={setProgress} refreshQuarterPlan={refreshQuarterPlan} planMsg={planMsg}/>
          :tab==="prog"    ?<Prog     data={data} upd={upd} toast2={toast2} ai={ai} busy={busy}/>
          :tab==="history" ?<History  data={data} upd={upd} toast2={toast2}/>
          :tab==="school"  ?<SchoolInfo data={data} upd={upd} updP={updP} toast2={toast2}/>
          :<Sett data={data} upd={upd} updP={updP} toast2={toast2} ai={ai} busy={busy} planning={planning} refreshQuarterPlan={refreshQuarterPlan} planMsg={planMsg}/>
        }
      </div>
      {toast&&<div className="toast" style={{background:toast.e?"var(--red-bg)":"var(--card2)",color:toast.e?"var(--red)":"var(--t2)"}}>{toast.m}</div>}
      {modalApp}
      {showAccount&&<AccountModal data={data} updP={updP} toast2={toast2} onClose={()=>setShowAccount(false)}/>}
    </div>
  );
}
// ── ONBOARDING ───────────────────────────────────────────────────────────────
function Onboard({data,upd,updP,ai,busy,toast2,setTab,setProgress}){
  const [step,setStep]=useState(0);
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
      return{id:Date.now()+i,termId:getActiveTermAndSchool(data).term?.id||null,name:c.name+(c.code?` (${c.code})`:""),days:c.days||[],startTime:c.startTime||"09:00",endTime:c.endTime||"10:00",professor:c.professor||"",room:c.room||"",units:c.units||3,difficulty:info.difficultyScore||5,difficultyLabel:info.difficultyLabel||"Medium",weeklyHours:info.weeklyStudyHours||5,startExamPrepDays:info.startExamPrepDays||5,description:info.description||"",tips:info.tips||[],color:CC[i%CC.length]};
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
SYLLABI:\n${texts.join("\n")}`,8000,{temperature:0,model:"claude-opus-5"});
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
      (c.assignments||[]).forEach((a,i)=>{if(a.dueDate)nA.push({id:Date.now()+i,courseId:course.id,title:a.title,dueDate:a.dueDate,weight:a.weight||null,estimatedHours:a.estimatedHours||2,status:"not-started"});});
      (c.exams||[]).forEach((e,i)=>{if(e.date)nE.push({id:Date.now()+100+i,courseId:course.id,date:e.date,topics:e.topics||"",weight:e.weight||null,prepDays:e.prepDays||7,title:e.title,status:"not-started"});});
    });
    upd({assignments:[...data.assignments,...nA],exams:[...data.exams,...nE]});
    setSylImported(true);
    toast2(unmatchedCourses>0
      ? `${nA.length} assignments + ${nE.length} exams imported! (${unmatchedCourses} course(s) in syllabus not found in schedule — import your schedule first)`
      : `${nA.length} assignments + ${nE.length} exams imported!`);
  }

  const STEPS=[{l:"Welcome",i:"ti-user"},{l:"School",i:"ti-building"},{l:"Schedule",i:"ti-file-upload"},{l:"Syllabi",i:"ti-files"},{l:"Lifestyle",i:"ti-heart"},{l:"Study",i:"ti-brain"},{l:"Done",i:"ti-rocket"}];

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

      {step===0&&(
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
          <button className="btn btn-action" onClick={()=>setStep(1)} disabled={!p.name} style={{width:"100%"}}>Continue <i className="ti ti-arrow-right"/></button>
        </div>
      )}

      {step===1&&(
        <div className="fade">
          <h2 style={{marginBottom:8}}>Your school</h2>
          <p style={{marginBottom:16,fontSize:14}}>School name and term dates are required — everything else in the app depends on knowing your actual term. Picking a school from the list auto-fills the rest when it can; otherwise fill in manually below.</p>
          <div className="card">
            <div className="g2" style={{marginBottom:12}}>
              <div>
                <label>School name <span style={{color:"var(--red)"}}>*</span></label>
                <CollegeAutocomplete value={p.schoolName} onChange={v=>updP({schoolName:v})} onSelect={handleCollegeSelected} placeholder="Start typing your school..."/>
                {collegeLookup==="loading"&&<div style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:"var(--t3)",marginTop:5}}><Sp sz={12}/> Looking up address, term dates & holidays...</div>}
              </div>
              <div><label>Schedule type <span style={{color:"var(--red)"}}>*</span></label><select value={p.schoolType} onChange={e=>updP({schoolType:e.target.value})}><option value="quarter">Quarter</option><option value="semester">Semester</option></select></div>
            </div>
            <div style={{marginBottom:12}}><label>School address <span style={{color:"var(--t3)",fontWeight:400}}>(optional)</span></label><input value={p.schoolAddress} onChange={e=>updP({schoolAddress:e.target.value})} placeholder="21250 Stevens Creek Blvd, Cupertino, CA"/></div>
            <div className="g2">
              <div><label>Term start <span style={{color:"var(--red)"}}>*</span></label><input type="date" value={p.termStart} onChange={e=>updP({termStart:e.target.value})}/></div>
              <div>
                <label>Term end <span style={{color:"var(--red)"}}>*</span></label>
                <input type="date" value={p.termEnd} onChange={e=>updP({termEnd:e.target.value})}/>
                <div style={{fontSize:11,color:"var(--t3)",marginTop:4}}>Last day of finals — not just last day of class</div>
              </div>
            </div>
          </div>
          <div className="row">
            <button className="btn btn-ghost" onClick={()=>setStep(0)}><i className="ti ti-arrow-left"/></button>
            <button className="btn btn-action" style={{flex:1}} onClick={()=>setStep(2)} disabled={!p.schoolName||!p.termStart||!p.termEnd}>Continue <i className="ti ti-arrow-right"/></button>
          </div>
        </div>
      )}

      {step===2&&(
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
                    upd({courses:[...data.courses,{...nc,id:Date.now(),termId:getActiveTermAndSchool(data).term?.id||null,color:CC[data.courses.length%CC.length]}]});
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
            <button className="btn btn-ghost" onClick={()=>setStep(1)}><i className="ti ti-arrow-left"/></button>
            <button className="btn btn-action" style={{flex:1}} onClick={()=>setStep(3)} disabled={!data.courses.length&&!sImported}>Continue <i className="ti ti-arrow-right"/></button>
            <button className="btn btn-ghost btn-sm" onClick={()=>setStep(3)}>Skip</button>
          </div>
        </div>
      )}

      {step===3&&(
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
            <button className="btn btn-ghost" onClick={()=>setStep(2)}><i className="ti ti-arrow-left"/></button>
            <button className="btn btn-action" style={{flex:1}} onClick={()=>setStep(4)}>Continue <i className="ti ti-arrow-right"/></button>
            <button className="btn btn-ghost btn-sm" onClick={()=>setStep(4)}>Skip</button>
          </div>
        </div>
      )}

      {step===4&&(
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
            <button className="btn btn-ghost" onClick={()=>setStep(3)}><i className="ti ti-arrow-left"/></button>
            <button className="btn btn-action" style={{flex:1}} onClick={()=>setStep(5)}>Continue <i className="ti ti-arrow-right"/></button>
          </div>
        </div>
      )}

      {step===5&&(
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
            <button className="btn btn-ghost" onClick={()=>setStep(4)}><i className="ti ti-arrow-left"/></button>
            <button className="btn btn-action" style={{flex:1}} onClick={()=>setStep(6)}>Almost done <i className="ti ti-arrow-right"/></button>
          </div>
        </div>
      )}

      {step===6&&(
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
          <button className="btn btn-action" style={{padding:"12px 28px",fontSize:15}} onClick={()=>{upd({onboarded:true});setTab("today");}}>
            <i className="ti ti-rocket"/> Launch StudyOS
          </button>
        </div>
      )}
    </div>
  );
}
// ── TODAY ────────────────────────────────────────────────────────────────────
function Today({data:rawData,upd,ai,busy,toast2,refreshQuarterPlan,planning}){
  // Scoped to the current term — otherwise Deadline Awareness, Today's Classes, and everything
  // else here would consider every course/assignment/exam ever created, including years-old
  // completed terms kept for history. Safe: this component never writes directly to
  // courses/assignments/exams (only studyPlan/completionLog/pomodoroLogs via shared functions),
  // so there's no risk of the scoped copy accidentally overwriting other terms' data on save.
  const data=termScopedForPlanning(rawData);
  const [brief,setBrief]=useState(()=>data.briefCache&&data.briefDate===iso()&&data.briefVersion===APP_VERSION?data.briefCache:null);
  const [adhocT,setAT]=useState("");
  const [adhocTm,setATm]=useState("");
  const [adhocD,setAD]=useState(90);
  const [showCalendar,setShowCalendar]=useState(false); // full-day calendar now opens on demand instead of always inline — the day-view design itself is still a work in progress
  const [showWhatsApp,setShowWhatsApp]=useState(false); // same on-demand pattern for the WhatsApp message preview
  // Per-row Focus Time timer state — replaces the old single global "which session is current"
  // selector entirely. Only one row can be running at a time; starting a different row just
  // switches (no confirmation needed, nothing destructive happens to the abandoned one — it
  // simply isn't marked complete).
  const [runningBlockId,setRunningBlockId]=useState(null);
  const [secsLeft,setSecsLeft]=useState(0);
  const [paused,setPaused]=useState(false);
  const td=iso(),di=new Date().getDay(),p=data.profile;
  const q=getQ(p),fin=isFin(td,p),hol=isHol(td,p);
  const hr=new Date().getHours();

  const dueToday=data.assignments.filter(a=>a.dueDate===td&&a.status!=="done");
  const dueWk=data.assignments.filter(a=>a.status!=="done"&&a.dueDate&&du(a.dueDate)>0&&du(a.dueDate)<=7);
  const dueNx=data.assignments.filter(a=>a.status!=="done"&&a.dueDate&&du(a.dueDate)>7&&du(a.dueDate)<=14);
  const exWk=data.exams.filter(e=>du(e.date)>=0&&du(e.date)<=7).sort((a,b)=>du(a.date)-du(b.date));
  const exPrep=data.exams.filter(e=>{const d=du(e.date);return d>0&&d<=e.prepDays;}).sort((a,b)=>du(a.date)-du(b.date));
  const missing=data.assignments.filter(a=>!a.dueDate&&a.status!=="done");
  const classes=data.courses.filter(c=>(c.days||[]).includes(di));
  const gd=(p.gymDays||GYM0).find(g=>g.day===di&&g.on);
  const gymDone=(data.gymLogs||[]).some(g=>g.date===td);
  const gymTarget=(p.gymDays||GYM0).filter(g=>g.on).length;
  const gymWk=(()=>{const m=new Date();m.setDate(new Date().getDate()-new Date().getDay()+1);return(data.gymLogs||[]).filter(g=>new Date(g.date)>=m).length;})();
  const chores=(p.chores||[]).filter(c=>c.days?.includes(di));
  const todayAdhoc=(data.adhoc||[]).filter(e=>e.date===td);

  // Countdown for whichever row is currently running. Auto-completes at zero, same as a manual
  // Complete click — see completeSession below.
  useEffect(()=>{
    if(!runningBlockId||paused)return;
    if(secsLeft<=0){completeSession(runningBlockId,true);return;}
    const t=setTimeout(()=>setSecsLeft(s=>s-1),1000);
    return()=>clearTimeout(t);
  },[runningBlockId,paused,secsLeft]); // eslint-disable-line

  function startSession(block){
    setRunningBlockId(block.id);
    setSecsLeft((block.duration||25)*60);
    setPaused(false);
  }
  function completeSession(blockId,auto){
    const raw=findRawDayBlock(data,td,blockId);
    if(raw){
      const now=new Date().toISOString();
      const wasCompleted=raw.completed;
      saveBlockToDay(data,upd,td,{...raw,completed:true,completedAt:raw.completedAt||now,editedAt:now});
      if(!wasCompleted){
        logCompletion(data,upd,{
          blockId:raw.id,source:raw.source,courseId:raw.courseId,
          plannedStart:m2t(raw.s),plannedEnd:m2t(raw.e),actualCompletedAt:now,onTime:true,
        });
        const mins=raw.e-raw.s;
        upd({pomodoroLogs:[...(data.pomodoroLogs||[]),{id:Date.now(),date:td,mins,task:raw.label}]});
        toast2(auto?`🎉 Session done — ${mins} min logged!`:`✓ Marked complete — ${mins} min logged!`);
      }
    }
    if(runningBlockId===blockId){setRunningBlockId(null);setPaused(false);}
  }

  async function gen(){
    // The real, deterministic plan (data.studyPlan.weeks) is the single source of truth for what
    // studying happens today — no longer computed here at all. gen()'s only job now is the AI
    // commentary layer (oneFocus/encouragement/whatsAppMessage/etc), which is given the real plan
    // as READ-ONLY context so it can write something relevant, but never asked to invent or
    // rewrite the actual task text — that was the source of the AI/plan inconsistency this fixes.
    const realBlocks=realDayBlocks(data,td);
    const immediate={oneFocus:"Here's today's plan."};
    setBrief(immediate);
    try{
      const t=await ai(
        `Warm encouraging study assistant for ${p.name}, ${p.schoolName||"college"} Data Science student with ADD. Brief, specific, motivating. Respond ONLY valid JSON.`,
        `Today: ${DF[di]}, ${td}. ${fin?"⚠️ FINALS!":""} ${hol?"Holiday!":""}
Classes: ${classes.map(c=>`${c.name} ${c.startTime}-${c.endTime}`).join(", ")||"None"}
DUE TODAY: ${dueToday.map(a=>a.title).join(", ")||"Nothing"}
DUE THIS WEEK: ${dueWk.map(a=>`${a.title}(${du(a.dueDate)}d)`).join(", ")||"None"}
DUE NEXT WEEK: ${dueNx.map(a=>`${a.title}(${du(a.dueDate)}d)`).join(", ")||"None"}
EXAMS THIS WEEK: ${exWk.map(e=>`${courseNameFor(data.courses,e.courseId)} in ${du(e.date)}d`).join(", ")||"None"}
START PREP: ${exPrep.map(e=>`${courseNameFor(data.courses,e.courseId)} in ${du(e.date)}d`).join(", ")||"None"}
MISSING DATES: ${missing.map(a=>a.title).join(", ")||"None"}
Gym today: ${gd?"Yes at "+gd.s+"-"+gd.e:"No"} · Week: ${gymWk}/${gymTarget}
TODAY'S ACTUAL PLANNED STUDY SESSIONS (already scheduled by the planner — for context only, do not rewrite, restate, or invent alternatives to these):
${realBlocks.length?realBlocks.map(b=>`${b.time} (${b.duration}min) — ${b.task}`).join("\n"):"(none scheduled — either a rest day, or this week hasn't been planned yet)"}
Return JSON:{"oneFocus":"THE single most important thing today — one specific sentence, referencing the real plan above if there is one","urgencyAlert":null,"gymNudge":null,"encouragement":"one warm encouraging sentence","whatsAppGreeting":"short casual greeting, e.g. 'Hey ${p.name}! 💪'","whatsAppLines":["one SHORT line per distinct topic today — due items, exams, study sessions, gym — each its own array entry, NOT one paragraph. Keep each line under ~12 words, start with a relevant emoji, plain and scannable like a real text message."],"whatsAppClosing":"one short warm sign-off, e.g. 'You've got this! 🚀'"}`
      );
      if(t){
        try{
          const b=JSON.parse(t.replace(/```json|```/g,"").trim());
          setBrief(b);upd({briefCache:b,briefDate:td,briefVersion:APP_VERSION});
        }catch{
          // AI text failed to parse — the real plan is already showing (read directly, not via
          // brief), so this only affects the commentary fields, which just fall back to plain text.
          upd({briefCache:immediate,briefDate:td,briefVersion:APP_VERSION});
        }
      }else{
        upd({briefCache:immediate,briefDate:td,briefVersion:APP_VERSION});
      }
    }catch(err){
      console.error("StudyOS: gen() failed —",err);
      toast2("Couldn't build today's briefing ("+(err?.message||"unknown error")+")",true);
      setBrief({oneFocus:"Briefing generation hit an error — see the notification for details."});
    }
  }

  useEffect(()=>{if(!brief)gen();},[]);

  // Build unified awareness list, sorted earliest first
  const todayRealBlocks=realDayBlocks(data,td); // real plan — single source of truth for "planned" checks below
  const rawAwareness=[];
  dueToday.forEach(a=>{const cn=courseNameFor(data.courses,a.courseId);rawAwareness.push({days:0,lvl:0,text:`${a.title} — ${cn}`,tag:"Due TODAY",planned:todayRealBlocks.some(b=>b.courseId===a.courseId)});});
  exWk.forEach(e=>{const cn=courseNameFor(data.courses,e.courseId);rawAwareness.push({days:du(e.date),lvl:du(e.date)<=2?0:1,text:`${cn} exam`,tag:`in ${du(e.date)} day${du(e.date)!==1?"s":""}`,planned:todayRealBlocks.some(b=>b.courseId===e.courseId)});});
  exPrep.filter(e=>!exWk.find(x=>x.id===e.id)).forEach(e=>{const cn=courseNameFor(data.courses,e.courseId);rawAwareness.push({days:du(e.date),lvl:1,text:`${cn} exam`,tag:`${du(e.date)}d — start prep`,planned:false});});
  dueWk.forEach(a=>{const days=a.dueDate&&a.dueDate.length===10?du(a.dueDate):99;const cn=courseNameFor(data.courses,a.courseId);rawAwareness.push({days,lvl:2,text:`${a.title} — ${cn}`,tag:days<99?`${days}d`:"⚠ Enter date",planned:todayRealBlocks.some(b=>b.courseId===a.courseId)});});
  dueNx.forEach(a=>{const days=a.dueDate&&a.dueDate.length===10?du(a.dueDate):99;const cn=courseNameFor(data.courses,a.courseId);rawAwareness.push({days,lvl:3,text:`${a.title} — ${cn}`,tag:days<99?`${days}d`:"⚠ Enter date",planned:false});});
  const awareness=rawAwareness.sort((a,b)=>a.days-b.days);

  const lvlColor=["var(--red)","var(--amber)","var(--blue)","var(--t3)"];
  const lvlBg=["var(--red-bg)","var(--amber-bg)","var(--blue-bg)","var(--card2)"];

  if(busy&&!brief)return(
    <div style={{textAlign:"center",padding:"70px 0",color:"var(--t2)"}}>
      <Sp sz={28}/>
      <div style={{fontSize:16,marginTop:16,color:"var(--t2)"}}>Building your morning briefing...</div>
    </div>
  );

  // ── Unified box style ──
  const BOX={background:"var(--card)",borderRadius:12,marginBottom:20};
  const TITLE_ROW={display:"flex",alignItems:"center",gap:8,padding:"14px 20px 0 20px"};
  const TITLE_ICON={fontSize:17,color:"var(--blue)"};
  const TITLE_TEXT={fontSize:13,fontWeight:500,color:"var(--t2)",textTransform:"uppercase",letterSpacing:"0.08em"};
  const DIVIDER={borderTop:"1px solid var(--b1)",margin:"10px 20px 0 20px"};
  const INNER={padding:"14px 20px 16px 20px"};

  return(
    <div className="fade">

      {/* ── PAGE HEADER ── */}
      <div style={{marginBottom:24,display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:12}}>
        <div>
          <h1 style={{marginBottom:6}}>
            {hr<12?"Good morning":hr<17?"Good afternoon":"Good evening"}, {p.name}
          </h1>
          <div className="row" style={{gap:8}}>
            <span style={{fontSize:15,color:"var(--t2)"}}>
              {new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}
            </span>
            {q&&<span className="badge badge-amber">{q.name}</span>}
            {fin&&<span className="badge badge-red">⚠ Finals Week</span>}
            {hol&&<span className="badge badge-green">🎉 Holiday</span>}
          </div>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button className="tt" data-tt="View day calendar" onClick={()=>setShowCalendar(true)}
            style={{width:34,height:34,borderRadius:"50%",border:"1px solid var(--b1)",background:"var(--card2)",
              color:"var(--t2)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
            <i className="ti ti-calendar" style={{fontSize:16}}/>
          </button>
          {brief?.whatsAppLines?.length>0&&(
            <button className="tt" data-tt="View WhatsApp message" onClick={()=>setShowWhatsApp(true)}
              style={{width:34,height:34,borderRadius:"50%",border:"1px solid var(--b1)",background:"var(--card2)",
                color:"var(--green)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
              <i className="ti ti-brand-whatsapp" style={{fontSize:16}}/>
            </button>
          )}
        </div>
      </div>

      {/* ── TOP THINGS TO KEEP IN MIND — first content block ── */}
      {brief&&(
        <div style={BOX}>
          <div style={TITLE_ROW}>
            <i className="ti ti-target" style={TITLE_ICON}/>
            <span style={TITLE_TEXT}>Top Things To Keep In Mind</span>
          </div>
          <div style={DIVIDER}/>
          <div style={INNER}>

            {/* Line 1: Main task */}
            <div style={{display:"flex",alignItems:"flex-start",gap:10,
              paddingBottom:brief.urgencyAlert||brief.encouragement?10:0,
              marginBottom:brief.urgencyAlert||brief.encouragement?10:0,
              borderBottom:brief.urgencyAlert||brief.encouragement?"1px solid var(--b1)":"none"}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:"var(--blue)",flexShrink:0,marginTop:6}}/>
              <span style={{fontSize:15,color:"var(--t1)",lineHeight:1.6}}>{brief.oneFocus}</span>
            </div>

            {/* Line 2: Urgency alert */}
            {brief.urgencyAlert&&(
              <div style={{display:"flex",alignItems:"flex-start",gap:10,
                paddingBottom:brief.encouragement?10:0,
                marginBottom:brief.encouragement?10:0,
                borderBottom:brief.encouragement?"1px solid var(--b1)":"none"}}>
                <div style={{width:8,height:8,borderRadius:"50%",background:"var(--amber)",flexShrink:0,marginTop:6}}/>
                <span style={{fontSize:15,color:"var(--amber)",lineHeight:1.6}}>{brief.urgencyAlert}</span>
              </div>
            )}

            {/* Line 3: Encouragement */}
            {brief.encouragement&&(
              <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                <div style={{width:8,height:8,borderRadius:"50%",background:"var(--a-study-t)",flexShrink:0,marginTop:6}}/>
                <span style={{fontSize:15,color:"var(--t2)",lineHeight:1.6}}>{brief.encouragement}</span>
              </div>
            )}

          </div>
        </div>
      )}

      {/* ── DEADLINE AWARENESS ── */}
      <div style={BOX}>
        <div style={TITLE_ROW}>
          <i className="ti ti-alert-circle" style={TITLE_ICON}/>
          <span style={TITLE_TEXT}>Deadline Awareness</span>
        </div>
        <div style={DIVIDER}/>
        <div style={INNER}>
          {awareness.length===0?(
            <div style={{display:"flex",alignItems:"center",gap:10,fontSize:15,color:"var(--green)"}}>
              <i className="ti ti-circle-check" style={{fontSize:19}}/>
              Nothing due this week or next — you're clear!
            </div>
          ):awareness.map((item,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:12,
              padding:"10px 0",borderBottom:i<awareness.length-1?"1px solid var(--b1)":"none"}}>
              {/* Urgency dot */}
              <div style={{width:9,height:9,borderRadius:"50%",background:lvlColor[item.lvl],flexShrink:0}}/>
              {/* Main text */}
              <span style={{flex:1,fontSize:15,color:"var(--t1)"}}>{item.text}</span>
              {/* Time tag — amber normally, red if missing date */}
              <span style={{fontSize:13,fontWeight:500,whiteSpace:"nowrap",
                color:item.tag==="⚠ Enter date"?"var(--red)":"var(--amber)",
                background:item.tag==="⚠ Enter date"?"var(--red-bg)":"var(--amber-bg)",
                padding:"2px 9px",borderRadius:8}}>
                {item.tag}
              </span>
              {/* Focus status */}
              {item.planned
                ?<span style={{fontSize:12,color:"var(--green)",whiteSpace:"nowrap"}}>✓ planned</span>
                :<span className="tt" data-tt="Study time gets scheduled closer to the due date — this isn't a gap, it's intentional (see Study Preferences for when each item's window opens)"
                  style={{fontSize:12,color:"var(--t3)",whiteSpace:"nowrap",cursor:"help"}}>not yet</span>
              }
            </div>
          ))}
        </div>
      </div>

      {/* Missing due dates */}
      {missing.length>0&&(
        <div style={{...BOX,background:"var(--amber-bg)",borderLeft:"3px solid var(--amber)"}}>
          <div style={INNER}>
            <div style={{fontSize:15,color:"var(--amber)",marginBottom:8}}>
              ⚠ {missing.length} assignment{missing.length>1?"s":""} missing due date — go to Academics to fix
            </div>
            {missing.slice(0,3).map((a,i)=>(
              <div key={i} style={{fontSize:14,color:"var(--t3)",marginBottom:3}}>· {a.title} ({courseNameFor(data.courses,a.courseId)})</div>
            ))}
          </div>
        </div>
      )}

      {/* ── 3. TODAY'S CLASSES ── */}
      {classes.length>0&&(
        <div style={BOX}>
          <div style={TITLE_ROW}>
            <i className="ti ti-school" style={TITLE_ICON}/>
            <span style={TITLE_TEXT}>Today's Classes</span>
          </div>
          <div style={DIVIDER}/>
          <div style={INNER}>
            {classes.map((c,i,arr)=>{
              const dep=m2t(t2m(c.startTime)-p.commuteMins-10);
              return(
                <div key={c.id} style={{display:"flex",alignItems:"center",gap:14,
                  padding:"11px 0",borderBottom:i<arr.length-1?"1px solid var(--b1)":"none"}}>
                  <div style={{width:9,height:9,borderRadius:"50%",background:c.color.border,flexShrink:0}}/>
                  <div style={{flex:1}}>
                    {/* Course name — larger */}
                    <div style={{fontSize:16,color:"var(--t1)",marginBottom:3}}>{c.name}</div>
                    {/* Time — amber, then secondary info */}
                    <div style={{fontSize:13,color:"var(--t3)"}}>
                      <span style={{color:"var(--amber)",fontWeight:500}}>{c.startTime} – {c.endTime}</span>
                      {c.room&&<span> · Room {c.room}</span>}
                      <span style={{marginLeft:10}}>Leave by <span style={{color:"var(--amber)"}}>{f12(dep)}</span></span>
                    </div>
                  </div>
                  <DiffBadge score={c.difficulty} label={c.difficultyLabel}/>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── FOCUS TIME — each session in the list is its own timer trigger; no separate global
          control row anymore. Only one row can run at a time; starting a different row just
          switches (no confirmation — nothing destructive happens to the one left running). ── */}
      <div style={BOX}>
        <div style={TITLE_ROW}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <i className="ti ti-brain" style={TITLE_ICON}/>
            <span style={TITLE_TEXT}>Focus Time</span>
          </div>
          <div style={{display:"flex",gap:8}}>
            {(()=>{const logged=(data.pomodoroLogs||[]).filter(l=>l.date===td).reduce((s,l)=>s+l.mins,0);
              return logged>0&&(
                <span style={{fontSize:12,color:"var(--green)",background:"var(--a-study-bg)",padding:"3px 10px",borderRadius:8}}>
                  <i className="ti ti-flame" style={{fontSize:11,marginRight:3}}/>{fmtDur(logged)} logged
                </span>
              );})()}
            {todayRealBlocks.length>0&&(
              <span style={{fontSize:12,color:"var(--amber)",background:"var(--amber-bg)",padding:"3px 10px",borderRadius:8}}>
                {fmtDur(todayRealBlocks.reduce((s,b)=>s+(b.duration||25),0))} total
              </span>
            )}
          </div>
        </div>
        <div style={DIVIDER}/>
        <div style={INNER}>
          {todayRealBlocks.length===0?(
            <div style={{textAlign:"center",padding:"10px 0",color:"var(--t3)",fontSize:13}}>
              Nothing scheduled today — plan today from the calendar to get started.
            </div>
          ):todayRealBlocks.map((b,i,arr)=>{
            const endMins=t2m(b.time)+(b.duration||25);
            const endTime=b.endTime||m2t(endMins);
            const course=data.courses.find(c=>c.id===b.courseId);
            const col=course?.color?.border||"var(--a-study-t)";
            const isRunning=runningBlockId===b.id;
            const mm=Math.floor(secsLeft/60).toString().padStart(2,"0");
            const ss=(secsLeft%60).toString().padStart(2,"0");
            const rowIconBtn={width:28,height:28,borderRadius:"50%",border:"1px solid var(--b1)",cursor:"pointer",
              display:"flex",alignItems:"center",justifyContent:"center",padding:0,flexShrink:0,background:"var(--card2)"};
            return(
              <div key={i} style={{
                display:"flex",alignItems:"stretch",gap:0,
                padding:"12px 0",
                opacity:b.completed?0.55:1,
                borderBottom:i<arr.length-1?"1px solid var(--b1)":"none"}}>

                {/* Left: colored course stripe */}
                <div style={{
                  width:4,borderRadius:2,background:col,
                  flexShrink:0,marginRight:14,alignSelf:"stretch",minHeight:40}}/>

                {/* Center: task (primary) + course (secondary) — capped, not flex:1, so it
                    doesn't absorb all available space and leave the right side clustered at the
                    true edge with a big empty gap before it. */}
                <div style={{flex:"0 1 340px",minWidth:0}}>
                  <div style={{fontSize:15,color:"var(--t1)",lineHeight:1.5,marginBottom:4}}>
                    {b.completed&&"✓ "}{b.task}
                  </div>
                  {b.course&&(
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      <span style={{fontSize:12,color:"var(--t3)"}}>{b.course}</span>
                    </div>
                  )}
                </div>

                {/* Right: [Play/Pause+Complete button(s) + Duration] as one fixed-width pair,
                    and [Time range] as a separate group pinned to the true right edge —
                    matching the reference image precisely: a tight button+duration pair, then a
                    clearly larger gap, then the time range alone. Fixed widths on both groups
                    (not flexible) guarantee they land at the same horizontal position on every
                    row regardless of how long that row's task text is. */}
                <div style={{flex:1,marginLeft:14,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  {isRunning?(
                    <>
                      <div style={{flex:"0 0 auto",display:"flex",alignItems:"center",gap:8}}>
                        <button className="tt" data-tt={paused?"Resume":"Pause"} onClick={()=>setPaused(p=>!p)}
                          style={{...rowIconBtn,color:"var(--amber)"}}>
                          <i className={`ti ${paused?"ti-player-play":"ti-player-pause"}`} style={{fontSize:13}}/>
                        </button>
                        <button className="tt" data-tt="Mark complete" onClick={()=>completeSession(b.id,false)}
                          style={{...rowIconBtn,color:"var(--green)"}}>
                          <i className="ti ti-check" style={{fontSize:14}}/>
                        </button>
                      </div>
                      <span style={{flex:"0 0 170px",fontSize:18,fontFamily:"'Syne',sans-serif",fontWeight:700,color:"var(--amber)",textAlign:"right"}}>
                        {mm}:{ss}
                      </span>
                    </>
                  ):(
                    <>
                      <div style={{flex:"0 0 auto",display:"flex",alignItems:"center",gap:8}}>
                        {b.completed?(
                          <i className="ti ti-circle-check" style={{fontSize:20,color:"var(--green)"}}/>
                        ):(
                          <button className="tt" data-tt="Start" onClick={()=>startSession(b)}
                            style={{...rowIconBtn,background:"var(--amber-bg)",color:"var(--amber)"}}>
                            <i className="ti ti-player-play" style={{fontSize:13}}/>
                          </button>
                        )}
                        <span style={{fontSize:13,color:"var(--t3)"}}>
                          {fmtDur(b.duration||25)}
                        </span>
                      </div>
                      <span style={{flex:"0 0 170px",fontSize:14,color:"var(--amber)",fontWeight:500,whiteSpace:"nowrap",textAlign:"right"}}>
                        {f12(b.time)} – {f12(endTime)}
                      </span>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 5. OTHER ACTIVITIES ── */}
      {(gd||chores.length>0||todayAdhoc.length>0)&&(
        <div style={BOX}>
          <div style={TITLE_ROW}>
            <i className="ti ti-activity" style={TITLE_ICON}/>
            <span style={TITLE_TEXT}>Today's Other Activities</span>
          </div>
          <div style={DIVIDER}/>
          <div style={INNER}>
            {gd&&(
              <div style={{display:"flex",alignItems:"center",gap:14,padding:"11px 0",
                borderBottom:(chores.length>0||todayAdhoc.length>0)?"1px solid var(--b1)":"none"}}>
                <div style={{minWidth:115,flexShrink:0}}>
                  <span style={{fontSize:15,color:"var(--amber)",fontWeight:500}}>{gd.s} – {gd.e}</span>
                </div>
                <div style={{width:8,height:8,borderRadius:"50%",background:"var(--a-gym-t)",flexShrink:0}}/>
                <div style={{flex:1}}>
                  <div style={{fontSize:15,color:"var(--t1)"}}>💪 Gym</div>
                  <div style={{fontSize:13,color:"var(--t3)",marginTop:2}}>{gymWk}/{gymTarget} sessions this week</div>
                </div>
                {gymDone
                  ?<span className="badge badge-green">done ✓</span>
                  :<button className="btn btn-ghost btn-sm" onClick={()=>{upd({gymLogs:[...(data.gymLogs||[]),{id:Date.now(),date:td,dur:60}]});toast2("💪 Gym logged!");}}>Log done</button>
                }
              </div>
            )}
            {chores.map((c,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:14,padding:"11px 0",
                borderBottom:i<chores.length-1||todayAdhoc.length>0?"1px solid var(--b1)":"none"}}>
                <div style={{minWidth:115,flexShrink:0}}>
                  {c.time&&<span style={{fontSize:15,color:"var(--amber)",fontWeight:500}}>{f12(c.time)}</span>}
                </div>
                <div style={{width:8,height:8,borderRadius:"50%",background:"var(--a-chore-t)",flexShrink:0}}/>
                <div style={{flex:1}}>
                  <div style={{fontSize:15,color:"var(--t1)"}}>{c.e||"📋"} {c.n}</div>
                  <div style={{fontSize:13,color:"var(--t3)",marginTop:2}}>{c.dur} min</div>
                </div>
              </div>
            ))}
            {todayAdhoc.map((e,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:14,padding:"11px 0",
                borderBottom:i<todayAdhoc.length-1?"1px solid var(--b1)":"none"}}>
                <div style={{minWidth:115,flexShrink:0}}>
                  {e.time&&<span style={{fontSize:15,color:"var(--amber)",fontWeight:500}}>{f12(e.time)}</span>}
                </div>
                <div style={{width:8,height:8,borderRadius:"50%",background:"var(--a-fun-t)",flexShrink:0}}/>
                <div style={{flex:1}}>
                  <div style={{fontSize:15,color:"var(--t1)"}}>{e.title}</div>
                  <div style={{fontSize:13,color:"var(--t3)",marginTop:2}}>{e.dur} min</div>
                </div>
                <DelBtn onClick={()=>upd({adhoc:(data.adhoc||[]).filter(x=>x.id!==e.id)})}/>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add event */}
      <details style={{marginBottom:20}}>
        <summary style={{padding:"10px 16px",background:"var(--card)",borderRadius:10,
          fontSize:14,color:"var(--t2)",cursor:"pointer",display:"flex",alignItems:"center",gap:8}}>
          <i className="ti ti-plus" style={{fontSize:15,color:"var(--blue)"}}/>
          Add event to today
        </summary>
        <div style={{marginTop:8,background:"var(--card)",borderRadius:10,padding:"16px 18px"}}>
          <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr auto",gap:10}}>
            <div><label>Event name</label><input value={adhocT} onChange={e=>setAT(e.target.value)} placeholder="NBA game, movie, etc."/></div>
            <div><label>Time</label><input type="time" value={adhocTm} onChange={e=>setATm(e.target.value)}/></div>
            <div><label>Duration (min)</label><input type="number" min="15" max="480" value={adhocD} onChange={e=>setAD(+e.target.value)}/></div>
            <div style={{display:"flex",alignItems:"flex-end"}}>
              <button className="btn btn-action" onClick={()=>{if(!adhocT)return;upd({adhoc:[...(data.adhoc||[]),{id:Date.now(),date:td,title:adhocT,time:adhocTm,dur:adhocD}]});setAT("");setATm("");setAD(90);toast2("Added!");}} disabled={!adhocT}>
                <i className="ti ti-plus"/>
              </button>
            </div>
          </div>
        </div>
      </details>

      <button className="btn btn-ghost btn-sm" onClick={gen} disabled={busy}>
        <i className="ti ti-refresh"/> Regenerate briefing
      </button>

      {showCalendar&&(
        <div style={{position:"fixed",inset:0,zIndex:9000,background:"rgba(0,0,0,0.55)",
          display:"flex",alignItems:"center",justifyContent:"center",padding:20}}
          onClick={()=>setShowCalendar(false)}>
          <div style={{background:"var(--card)",borderRadius:14,padding:"20px 24px",
            maxWidth:900,width:"100%",maxHeight:"85vh",overflowY:"auto",
            boxShadow:"0 24px 60px rgba(0,0,0,0.5)"}}
            onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <div style={{fontSize:16,fontWeight:600,color:"var(--t1)"}}>
                <i className="ti ti-calendar" style={{marginRight:8,color:"var(--blue)"}}/>Today's Calendar
              </div>
              <button className="btn btn-ghost btn-sm" onClick={()=>setShowCalendar(false)}><i className="ti ti-x"/></button>
            </div>
            {!weekHasBeenPlanned(data,td)?(
              <div style={{textAlign:"center",padding:"24px 0",color:"var(--t2)"}}>
                <i className="ti ti-calendar-off" style={{fontSize:26,marginBottom:8,display:"block",color:"var(--t3)"}}/>
                This week hasn't been planned yet — nothing to show here until it is.
                <div style={{marginTop:12}}>
                  <button className="btn btn-sm" style={{background:"var(--red)",color:"#fff"}} onClick={refreshQuarterPlan} disabled={planning}>
                    {planning?<><Sp sz={12}/> Planning...</>:<><i className="ti ti-sparkles"/> Plan now</>}
                  </button>
                </div>
              </div>
            ):(
              <Timeline dateStr={td} data={data} upd={upd} studyBlocks={todayRealBlocks}/>
            )}
          </div>
        </div>
      )}

      {showWhatsApp&&(
        <div style={{position:"fixed",inset:0,zIndex:9000,background:"rgba(0,0,0,0.55)",
          display:"flex",alignItems:"center",justifyContent:"center",padding:20}}
          onClick={()=>setShowWhatsApp(false)}>
          <div style={{background:"var(--card)",borderRadius:14,padding:"20px 24px",
            maxWidth:400,width:"100%",maxHeight:"85vh",overflowY:"auto",
            boxShadow:"0 24px 60px rgba(0,0,0,0.5)"}}
            onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <div style={{fontSize:16,fontWeight:600,color:"var(--t1)"}}>
                <i className="ti ti-brand-whatsapp" style={{marginRight:8,color:"var(--green)"}}/>WhatsApp Morning Message
              </div>
              <button className="btn btn-ghost btn-sm" onClick={()=>setShowWhatsApp(false)}><i className="ti ti-x"/></button>
            </div>
            <div className="wapp" style={{display:"flex",flexDirection:"column",gap:9}}>
              {brief?.whatsAppGreeting&&<div style={{fontSize:14,fontWeight:600,color:"var(--t1)"}}>{brief.whatsAppGreeting}</div>}
              {brief?.whatsAppLines?.map((line,i)=>(
                <div key={i} style={{fontSize:13.5,color:"var(--t2)",lineHeight:1.4}}>{line}</div>
              ))}
              {brief?.whatsAppClosing&&<div style={{fontSize:14,fontWeight:600,color:"var(--t1)",marginTop:2}}>{brief.whatsAppClosing}</div>}
            </div>
            <div style={{fontSize:12,color:"var(--t3)",marginTop:12,textAlign:"center"}}>
              Sends automatically via Twilio at <span style={{color:"var(--amber)"}}>{p.wakeTime}</span> once deployed
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
// ── WEEK ─────────────────────────────────────────────────────────────────────
function Week({data,upd,ai,busy,planning,toast2,refreshQuarterPlan,refreshWeekPlan,planMsg}){
  const {confirm,modal}=useConfirm();
  const [selDay,setSel]=useState(null);
  const [mode,setMode]=useState("week");
  const [editState,setEditState]=useState(null); // {dateStr, block|null} — lifted up from WeekGrid so the Add Activity button can live in this header row, next to Clear plan/Refresh Plan
  const p=data.profile;

  // Build the list of Sunday-start weeks spanning the active term, if known.
  // The range auto-extends to cover any exam or dated assignment already on record,
  // so a mis-set Term End (e.g. instruction-end instead of finals-end) can never hide real deadlines.
  const rawTermRange=getTermRange(p);
  const termRange=(()=>{
    if(!rawTermRange)return null;
    let{start,end}=rawTermRange;
    const allDates=[
      ...data.exams.map(e=>e.date),
      ...data.assignments.filter(a=>a.dueDate&&a.dueDate.length===10).map(a=>a.dueDate),
    ].filter(Boolean);
    allDates.forEach(d=>{if(d<start)start=d;if(d>end)end=d;});
    return{start,end};
  })();
  const termWeeks=(()=>{
    if(!termRange)return[];
    const out=[];
    let cur=sundayOf(new Date(termRange.start+"T12:00:00"));
    const endSunday=sundayOf(new Date(termRange.end+"T12:00:00"));
    let i=1;
    while(cur<=endSunday&&i<=30){ // 30-week hard cap, safety valve
      out.push({index:i,start:new Date(cur)});
      cur=new Date(cur);cur.setDate(cur.getDate()+7);
      i++;
    }
    return out;
  })();
  const todaySunday=sundayOf(new Date());
  const defaultIdx=termWeeks.length
    ?Math.max(0,termWeeks.findIndex(w=>w.start.getTime()===todaySunday.getTime()))
    :0;
  const [selWeekIdx,setSelWeekIdx]=useState(defaultIdx);
  const clampedIdx=termWeeks.length?Math.min(selWeekIdx,termWeeks.length-1):0;
  const weekStart=termWeeks.length?termWeeks[clampedIdx].start:todaySunday;
  const rangeLabel=fmtWeekRange(weekStart);
  const isCurrentWeek=weekStart.getTime()===todaySunday.getTime();
  const atFirst=clampedIdx<=0,atLast=!termWeeks.length||clampedIdx>=termWeeks.length-1;
  const weekKey=iso(weekStart);
  const isWeekPlanned=!!data.studyPlan?.weeks?.[weekKey];

  if(mode==="day"&&selDay)return(
    <div className="fade">
      <div className="row" style={{marginBottom:16}}>
        <button className="btn btn-ghost btn-sm" onClick={()=>{setMode("week");setSel(null);}}><i className="ti ti-arrow-left"/> Weekly</button>
        <h2 style={{fontSize:19}}>{new Date(selDay+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}</h2>
        {selDay===iso()&&<span className="badge badge-blue">Today</span>}
      </div>
      {!weekHasBeenPlanned(data,selDay)?(
        <div className="card" style={{padding:"20px",textAlign:"center",color:"var(--t2)"}}>
          <i className="ti ti-calendar-off" style={{fontSize:28,marginBottom:8,display:"block",color:"var(--t3)"}}/>
          This week hasn't been planned yet.
          <div style={{marginTop:12}}>
            <button className="btn btn-sm" style={{background:"var(--red)",color:"#fff"}} onClick={()=>refreshWeekPlan(weekKey)} disabled={planning}>
              {planning?<><Sp sz={12}/> Planning...</>:<><i className="ti ti-sparkles"/> Plan this week</>}
            </button>
          </div>
        </div>
      ):(
        <div className="card" style={{padding:"12px 14px"}}>
          <Timeline dateStr={selDay} data={data} upd={upd} studyBlocks={realDayBlocks(data,selDay)}/>
        </div>
      )}
    </div>
  );

  const gymD=(p.gymDays||GYM0).filter(g=>g.on);
  const gymTarget=gymD.length;
  const ws=new Date();ws.setDate(new Date().getDate()-new Date().getDay());
  const gymDone=(data.gymLogs||[]).filter(g=>{const d=new Date(g.date);return d>=ws&&d<=new Date(ws.getTime()+6*864e5);}).length;
  // Real scheduled time for the currently-viewed week — reads the actual persisted plan
  // (data.studyPlan.weeks), the same data the calendar itself renders, not a fresh recomputation
  // via the old algorithm (which could silently disagree with what's actually on the calendar).
  const weekDatesForBalance=Array.from({length:7},(_,i)=>{const d=new Date(weekStart);d.setDate(weekStart.getDate()+i);return iso(d);});
  const weekPlacedAll=weekDatesForBalance.flatMap(ds=>data.studyPlan?.weeks?.[weekStartOf(ds)]?.days?.[ds]||[]);
  const studyH=weekPlacedAll.filter(b=>b.kind==="study").reduce((s,b)=>s+(b.e-b.s),0)/60;
  const homeworkH=weekPlacedAll.filter(b=>b.kind==="homework").reduce((s,b)=>s+(b.e-b.s),0)/60;
  const classH=data.courses.reduce((s,c)=>{const[sh,sm]=c.startTime.split(":").map(Number);const[eh,em]=c.endTime.split(":").map(Number);return s+((c.days||[]).length*((eh*60+em-sh*60-sm)/60));},0);
  const gymH=gymD.reduce((s,g)=>s+(t2m(g.e)-t2m(g.s))/60,0);
  const funH=(p.funWD*5)+(p.funWE*2);
  const tot=studyH+homeworkH+classH+gymH+funH+10.5+56;

  return(
    <div className="fade">
      {/* Compact single-row nav bar — nav/view buttons left, week chips center, Refresh Plan far right */}
      <div className="card" style={{padding:"8px 12px",marginBottom:10}}>
        <div style={{display:"flex",alignItems:"center",gap:16}}>
          <div className="row" style={{gap:6,flexShrink:0}}>
            {termWeeks.length>0&&(
              <button className="btn btn-ghost btn-sm tt" data-tt="Previous week" style={{padding:"6px 10px",fontSize:15}}
                onClick={()=>setSelWeekIdx(i=>Math.max(0,i-1))} disabled={atFirst}>
                <i className="ti ti-chevron-left"/>
              </button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={()=>setSelWeekIdx(defaultIdx)} disabled={isCurrentWeek}>Today</button>
            {termWeeks.length>0&&(
              <button className="btn btn-ghost btn-sm tt" data-tt="Next week" style={{padding:"6px 10px",fontSize:15}}
                onClick={()=>setSelWeekIdx(i=>Math.min(termWeeks.length-1,i+1))} disabled={atLast}>
                <i className="ti ti-chevron-right"/>
              </button>
            )}
            <button className={`btn btn-sm ${mode==="week"?"btn-action":"btn-ghost"}`} onClick={()=>setMode("week")}>Schedule</button>
            <button className={`btn btn-sm ${mode==="balance"?"btn-action":"btn-ghost"}`} onClick={()=>setMode("balance")}>Time Allocation</button>
          </div>

          {termWeeks.length>0?(
            <div style={{display:"flex",gap:6,overflowX:"auto",flex:1,minWidth:0}}>
              {termWeeks.map((w,i)=>(
                <button key={w.index} onClick={()=>setSelWeekIdx(i)}
                  title={fmtWeekRange(w.start)}
                  style={{flexShrink:0,padding:"4px 10px",borderRadius:7,border:"none",cursor:"pointer",
                    fontFamily:"inherit",fontSize:12,fontWeight:400,whiteSpace:"nowrap",
                    background:i===clampedIdx?"var(--amber-bg)":"var(--card2)",
                    color:i===clampedIdx?"var(--amber)":"var(--t3)",
                    outline:w.start.getTime()===todaySunday.getTime()?"1px solid var(--blue)":"none"}}>
                  Wk{w.index}
                </button>
              ))}
            </div>
          ):(
            <div style={{fontSize:12,color:"var(--t3)",flex:1}}>
              Set your term dates in <b>Settings → School Info</b> to browse your full term week by week.
            </div>
          )}

          {refreshWeekPlan&&(
            <button className="btn btn-sm btn-ghost tt tt-below" data-tt="Re-plans just this one week, using its existing scope — cheaper than Refresh Plan, but has no awareness of demand from adjacent weeks" style={{flexShrink:0}}
              onClick={()=>refreshWeekPlan(weekKey)} disabled={busy}>
              <i className="ti ti-refresh" style={{marginRight:4}}/>{isWeekPlanned?"Update this week":"Plan this week"}
            </button>
          )}
          <button className="btn btn-sm btn-ghost tt tt-below" data-tt="Add a one-off activity to today" style={{flexShrink:0}}
            onClick={()=>setEditState({dateStr:iso(),block:null})}>
            <i className="ti ti-plus" style={{fontSize:15}}/>
          </button>
          <button className="btn btn-sm btn-ghost tt tt-below" data-tt="Removes AI-planned study/homework blocks from today forward so you can regenerate fresh. Past days (history) are never touched. Offers to also clear edited/completed blocks if you want a truly clean slate." style={{flexShrink:0}}
            onClick={async()=>{
              const weeks=data.studyPlan?.weeks||{};
              const today=iso();
              let toClear=0,toKeep=0;
              Object.values(weeks).forEach(week=>{
                Object.entries(week.days||{}).forEach(([dateStr,blocks])=>{
                  if(dateStr<today)return; // history — never touched by Clear plan
                  (blocks||[]).forEach(b=>{if(b.userEdited)toKeep++;else toClear++;});
                });
              });
              if(toClear===0&&toKeep===0){toast2("No study plan to clear from today forward — nothing scheduled yet.");return;}
              const ok=await confirm(`Clear the generated study plan from today forward? This removes ${toClear} AI-planned block${toClear!==1?"s":""}. Past days are never touched.${toKeep>0?` ${toKeep} upcoming block${toKeep!==1?"s":""} marked as edited or completed will be kept for now — you'll get a chance to clear those too.`:""}`);
              if(!ok)return;
              const keptWeeks={};
              Object.entries(weeks).forEach(([weekStart,week])=>{
                const days={};
                Object.entries(week.days||{}).forEach(([dateStr,blocks])=>{
                  days[dateStr]=dateStr<today?(blocks||[]):(blocks||[]).filter(b=>b.userEdited);
                });
                keptWeeks[weekStart]={...week,days};
              });
              upd({studyPlan:{weeks:keptWeeks},quarterPlan:null,briefCache:null,briefDate:null});
              if(toKeep>0){
                const forceOk=await confirm(`${toKeep} upcoming block${toKeep!==1?"s":""} were kept because they're marked as edited or completed — this includes blocks you customized on purpose, but can also include blocks that only got that flag from checking "Mark Complete" in an older version. Clear those too for a fully clean slate (today forward only — history stays untouched)? This can't be undone.`);
                if(forceOk){
                  const emptied={};
                  Object.entries(keptWeeks).forEach(([weekStart,week])=>{
                    const days={};
                    Object.entries(week.days||{}).forEach(([dateStr,blocks])=>{
                      days[dateStr]=dateStr<today?blocks:[];
                    });
                    emptied[weekStart]={...week,days};
                  });
                  upd({studyPlan:{weeks:emptied}});
                  toast2("Study plan fully cleared from today forward. History was kept. Hit Refresh Plan to regenerate.");
                  return;
                }
              }
              toast2(`Study plan cleared from today forward${toKeep>0?` — kept ${toKeep} edited block${toKeep!==1?"s":""}.`:"."} History was kept. Hit Refresh Plan to regenerate.`);
            }}>
            <i className="ti ti-calendar-off" style={{marginRight:4}}/>Clear plan
          </button>
          <button className="btn btn-sm tt tt-below tt-right" data-tt="Re-plans every day from this week through the end of your term using current settings, assignments, and exams" style={{background:"var(--red)",color:"#fff",flexShrink:0}} onClick={refreshQuarterPlan} disabled={planning}>
            {planning?<><Sp sz={12}/> Planning...</>:<><i className="ti ti-sparkles"/> Refresh Plan</>}
          </button>
        </div>
        {planning&&planMsg&&(
          <div style={{fontSize:11,color:"var(--t3)",marginTop:7,textAlign:"right"}}>{planMsg}</div>
        )}
      </div>
      {modal}

      {/* Real, live status of the persisted plan — no dependency on any of the superseded planner functions */}
      <details style={{marginBottom:10}}>
        <summary style={{padding:"7px 12px",background:"var(--card2)",borderRadius:8,fontSize:12,color:"var(--t3)",cursor:"pointer"}}>
          <i className="ti ti-stethoscope" style={{marginRight:6}}/>Plan status
        </summary>
        <div className="card" style={{marginTop:8,fontSize:12,lineHeight:1.7}}>
          <div>
            <b>Study Plan (Refresh Plan history):</b> {data.quarterPlan?`generated ${data.quarterPlan.generatedAt}, through ${data.quarterPlan.generatedThrough}, ${data.quarterPlan.datesPlanned||Object.keys(data.quarterPlan.tasksByDate||{}).length} days`:"never generated"}
            {data.quarterPlan?.lastError&&<div style={{color:"var(--red)",marginTop:4}}>⚠ Last Refresh Plan error ({data.quarterPlan.lastErrorAt}): {data.quarterPlan.lastError}</div>}
          </div>
        </div>
      </details>

      {mode==="week"&&(
        <div>
          {/* Rounded card, aligned with the nav banner above (no more full-bleed edge-to-edge) */}
          <div style={{
            background:"var(--card)",
            borderRadius:12,
            padding:"18px 20px",
          }}>
            <WeekGrid data={data} upd={upd} weekStart={weekStart} onDay={d=>{setSel(d);setMode("day");}} refreshWeekPlan={refreshWeekPlan} busy={busy} editState={editState} setEditState={setEditState}/>
          </div>
        </div>
      )}

      {mode==="balance"&&(
        <div>
          <div className="card" style={{marginBottom:12}}>
            <SecHead icon="ti-chart-bar" title="Weekly time balance"/>
            {[
              {l:"📚 Study",h:studyH,c:"var(--a-study-t)"},
              {l:"📝 Homework",h:homeworkH,c:"var(--a-homework-t)"},
              {l:"🏫 Classes",h:classH,c:"var(--a-class-t)"},
              {l:"💪 Gym",h:gymH,c:"var(--a-gym-t)",x:`${gymDone}/${gymTarget} done`},
              {l:"🎮 Fun",h:funH,c:"var(--a-fun-t)"},
              {l:"🍽 Meals",h:10.5,c:"var(--a-lunch-t)"},
              {l:"😴 Sleep",h:56,c:"var(--a-sleep-t)"},
            ].map((item,i)=>(
              <div key={i} style={{marginBottom:11}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                  <span style={{fontSize:14,color:"var(--t1)"}}>{item.l}</span>
                  <div className="row" style={{gap:9}}>
                    {item.x&&<span style={{fontSize:11,color:"var(--t3)"}}>{item.x}</span>}
                    <span style={{fontSize:13,color:item.c}}>{item.h.toFixed(1)}h</span>
                    <span style={{fontSize:11,color:"var(--t3)"}}>{tot>0?Math.round(item.h/tot*100):0}%</span>
                  </div>
                </div>
                <div className="bar"><div className="bar-fill" style={{width:`${tot>0?item.h/tot*100:0}%`,background:item.c}}/></div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
// ── ACADEMICS ────────────────────────────────────────────────────────────────
function Acad({data,upd,ai,busy,planning,toast2,progress,setProgress,refreshQuarterPlan,planMsg}){
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
  const [diffSortBy,setDiffSortBy]=useState("class");
  const [diffBaseline,setDiffBaseline]=useState(null); // JSON snapshot of {userValue,userHours} at last load/save

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
      const freshA={},freshE={}; // items with no prior estimate — cache their computed values back to data
      for(const a of data.assignments){
        if(a.status==="done")continue;
        const course=data.courses.find(c=>c.id===a.courseId);
        const key=`a_${a.id}`;
        if(a.estimatorValue!=null){
          next[key]={kind:"assignment",id:a.id,courseId:a.courseId,courseName:course?.name||"(unknown)",title:a.title,
            weight:a.weight,dueDate:a.dueDate,estimatorValue:a.estimatorValue,userValue:a.userValue||null,
            aiHours:a.aiHours??a.estimatedHours??2,userHours:a.userHours??null};
        }else{
          const r=await estimateDifficulty(a,course);
          const aiHours=estimateStudyHours(a,course,"homework");
          next[key]={kind:"assignment",id:a.id,courseId:a.courseId,courseName:course?.name||"(unknown)",title:a.title,
            weight:a.weight,dueDate:a.dueDate,estimatorValue:r.value,userValue:null,aiHours,userHours:null};
          freshA[a.id]={estimatorValue:r.value,aiHours};
        }
      }
      for(const e of data.exams){
        const course=data.courses.find(c=>c.id===e.courseId);
        const key=`e_${e.id}`;
        if(e.estimatorValue!=null){
          next[key]={kind:"exam",id:e.id,courseId:e.courseId,courseName:course?.name||"(unknown)",title:e.title||"Exam",
            weight:e.weight,dueDate:e.date,estimatorValue:e.estimatorValue,userValue:e.userValue||null,
            aiHours:e.aiHours??e.estimatedHours??4,userHours:e.userHours??null};
        }else{
          const r=await estimateDifficulty(e,course);
          const aiHours=estimateStudyHours(e,course,"exam");
          next[key]={kind:"exam",id:e.id,courseId:e.courseId,courseName:course?.name||"(unknown)",title:e.title||"Exam",
            weight:e.weight,dueDate:e.date,estimatorValue:r.value,userValue:null,aiHours,userHours:null};
          freshE[e.id]={estimatorValue:r.value,aiHours};
        }
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

  function setDiffOverride(key,value){
    setDiffRatings(r=>({...r,[key]:{...r[key],userValue:value}}));
  }
  // Receives an already-parsed number|null from HoursInput's commit (blur/Enter) — HoursInput
  // handles all typing/parsing/validation itself via its own local state, so this just stores
  // the final committed value. No per-keystroke involvement here at all.
  function setHoursOverride(key,value){
    setDiffRatings(r=>({...r,[key]:{...r[key],userHours:value}}));
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
    upd({assignments:[...data.assignments,{id:Date.now(),courseId:course.id,title:na.title,dueDate:na.dueDate,weight:null,estimatedHours:na.estimatedHours,status:"not-started",...est,userHours:na.estimatedHours}]});
    setNa({course:"",title:"",dueDate:"",estimatedHours:2,status:"not-started"});
    setShowAddAssign(false);toast2("Assignment added!");
  }
  async function addExam(){
    if(!ne.course||!ne.date)return;
    const course=findMatchingCourse(termCourses,ne.course);
    if(!course){toast2("Couldn't find that course",true);return;}
    const est=await computeEstimateFields({weight:null,dueDate:ne.date},course,"exam");
    upd({exams:[...data.exams,{id:Date.now(),courseId:course.id,title:ne.title||"",date:ne.date,topics:ne.topics||"",weight:null,prepDays:ne.prepDays||7,status:"not-started",estimatedHours:est.aiHours,...est}]});
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
SYLLABI:\n${texts.join("\n")}`,8000,{temperature:0,model:"claude-opus-5"});
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
SYLLABI:\n${texts.join("\n")}`,8000,{temperature:0,model:"claude-opus-5"});
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
        const info=await CI(c.courseName);
        course={
          id:Date.now()+Math.floor(Math.random()*1000),
          termId:viewingTermId,
          name:c.courseName,
          days:primary?.days||[],
          startTime:primary?.startTime||"09:00",
          endTime:primary?.endTime||"10:00",
          professor:"",room:primary?.location||"",units:4,
          difficulty:info.difficultyScore||5,difficultyLabel:info.difficultyLabel||"Medium",
          weeklyHours:info.weeklyStudyHours||5,startExamPrepDays:info.startExamPrepDays||5,
          description:info.description||"",tips:info.tips||[],
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
        nA.push({id:Date.now()+i+Math.floor(Math.random()*1000),courseId:course.id,title:a.title,dueDate:a.dueDate,weight:a.weight??null,estimatedHours:est.aiHours,status:"not-started",...est});
        added++;itemsByCourse[c.courseName].assignments++;
      }
      for(const[i,e]of(c.exams||[]).entries()){
        if(!e.date)continue;
        const isDup=data.exams.find(x=>x.courseId===course.id&&x.date===e.date);
        if(isDup){skippedDuplicate++;continue;}
        const est=await computeEstimateFields(e,course,"exam");
        nE.push({id:Date.now()+100+i+Math.floor(Math.random()*1000),courseId:course.id,title:e.title,date:e.date,topics:e.topics||"",weight:e.weight??null,prepDays:e.prepDays||7,status:"not-started",estimatedHours:est.aiHours,...est});
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
                <table style={{width:"100%",borderCollapse:"collapse"}}>
                  <thead>
                    <tr style={{borderBottom:"1px solid var(--b1)"}}>
                      <th style={{width:28}}></th>
                      <TableHead label="Class" col="class" sortBy={assignSort} setSortBy={setAssignSort}/>
                      <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"left",padding:"0 8px 8px",fontWeight:600}}>Assignment</th>
                      <TableHead label="Due" col="due" sortBy={assignSort} setSortBy={setAssignSort}/>
                      <TableHead label="Weight" col="weight" sortBy={assignSort} setSortBy={setAssignSort}/>
                      <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"left",padding:"0 8px 8px",fontWeight:600}}>Grade</th>
                      <th style={{width:170}}></th>
                    </tr>
                  </thead>
                  <tbody>
              {active.map((a,i,arr)=>{
                const d=(a.dueDate&&a.dueDate.length===10)?du(a.dueDate):null;
                const isEditing=editId===a.id;

                if(isEditing) return(
                  <tr key={a.id}>
                    <td colSpan={8} style={{padding:0}}>
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
                    <td style={{padding:"9px 8px",fontSize:13,color:"var(--t2)",whiteSpace:"nowrap"}}>{courseNameFor(data.courses,a.courseId)}</td>
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
                    <td style={{padding:"9px 8px",whiteSpace:"nowrap"}}>
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
                <table style={{width:"100%",borderCollapse:"collapse"}}>
                  <tbody>
                {done.map((a,i,arr)=>(
                  <tr key={a.id} style={{borderBottom:i<arr.length-1?"1px solid var(--b1)":"none"}}>
                    <td style={{padding:"9px 8px",width:28}}>
                      <div style={{width:20,height:20,borderRadius:6,background:"var(--green)",
                        flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                        <i className="ti ti-check" style={{fontSize:12,color:"#052e16",fontWeight:700}}/>
                      </div>
                    </td>
                    <td style={{padding:"9px 8px",fontSize:14,color:"var(--t2)"}}>{a.title}</td>
                    <td style={{padding:"9px 8px",fontSize:13,color:"var(--t3)",whiteSpace:"nowrap"}}>{courseNameFor(data.courses,a.courseId)}</td>
                    <td style={{padding:"9px 8px",fontSize:12,color:"var(--t3)",whiteSpace:"nowrap"}}>{a.dueDate?new Date(a.dueDate+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"}):"—"}</td>
                    <td style={{padding:"6px 8px"}}>
                      <GradeInput value={a.grade} onChange={v=>upd({assignments:data.assignments.map(x=>x.id===a.id?{...x,grade:v}:x)})}/>
                    </td>
                    <td style={{padding:"9px 8px",whiteSpace:"nowrap"}}>
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
                        <table style={{width:"100%",borderCollapse:"collapse",marginBottom:20}}>
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
                <div style={{display:"flex",gap:7,flexWrap:"wrap",marginBottom:c.description||c.tips?.length?10:0}}>
                  <DiffBadge score={c.difficulty} label={c.difficultyLabel}/>
                  <span className="badge badge-blue">{c.weeklyHours}h/wk study</span>
                  <span className="badge badge-teal">prep {c.startExamPrepDays||5}d before exams</span>
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
              <div style={INNER}>
                <table style={{width:"100%",borderCollapse:"collapse"}}>
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
                const sorted=[...allItems].sort((a,b)=>{
                  if(diffSortBy==="due")return(a.dueDate||"9999").localeCompare(b.dueDate||"9999");
                  if(diffSortBy==="weight")return(b.weight??-1)-(a.weight??-1);
                  if(diffSortBy==="priority")return b.priority-a.priority;
                  return a.courseName.localeCompare(b.courseName)||(a.dueDate||"").localeCompare(b.dueDate||"");
                });
                if(sorted.length===0)return <div style={{color:"var(--t3)",padding:"20px 0"}}>No active assignments or exams to review.</div>;
                return(
                  <table style={{width:"100%",borderCollapse:"collapse"}}>
                    <thead>
                      <tr style={{borderBottom:"1px solid var(--b1)"}}>
                        <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"left",padding:"0 8px 8px",fontWeight:600}}>Item</th>
                        <TableHead label="Class" col="class" sortBy={diffSortBy} setSortBy={setDiffSortBy}/>
                        <TableHead label="Due" col="due" sortBy={diffSortBy} setSortBy={setDiffSortBy}/>
                        <TableHead label="Weight" col="weight" sortBy={diffSortBy} setSortBy={setDiffSortBy}/>
                        <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"left",padding:"0 8px 8px",fontWeight:600}}>AI Estimate</th>
                        <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"left",padding:"0 8px 8px",fontWeight:600}}>Student Estimate</th>
                        <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"left",padding:"0 8px 8px",fontWeight:600}}>Hours</th>
                        <TableHead label="Priority" col="priority" sortBy={diffSortBy} setSortBy={setDiffSortBy}/>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map(item=>(
                        <tr key={item.key} style={{borderBottom:"1px solid var(--b1)"}}>
                          <td style={{padding:"9px 8px",fontSize:14,color:"var(--t1)"}}>
                            <i className={`ti ${item.kind==="exam"?"ti-file-text":"ti-notebook"}`} style={{fontSize:13,color:"var(--t3)",marginRight:6}}/>
                            {item.title}
                          </td>
                          <td style={{padding:"9px 8px",fontSize:13,color:"var(--t2)",whiteSpace:"nowrap"}}>{item.courseName}</td>
                          <td style={{padding:"9px 8px",fontSize:13,color:"var(--t2)",whiteSpace:"nowrap"}}>{item.dueDate||"—"}</td>
                          <td style={{padding:"9px 8px",fontSize:13,color:"var(--t2)",whiteSpace:"nowrap"}}>{item.weight!=null?item.weight+"%":"—"}</td>
                          <td style={{padding:"9px 8px"}}><DiffPill value={item.estimatorValue} muted={!!item.userValue}/></td>
                          <td style={{padding:"9px 8px"}}>
                            <select value={item.userValue||""} onChange={e=>setDiffOverride(item.key,e.target.value||null)}
                              style={{fontSize:12,padding:"4px 7px",width:120,
                                borderColor:item.userValue?"var(--amber)":undefined,
                                fontWeight:item.userValue?600:400,
                                color:item.userValue?"var(--amber)":undefined}}>
                              <option value="">— none —</option>
                              <option value="Low">Low</option>
                              <option value="Mid">Mid</option>
                              <option value="High">High</option>
                            </select>
                          </td>
                          <td style={{padding:"9px 8px"}}>
                            <HoursInput value={item.userHours??item.aiHours} isOverridden={item.userHours!=null}
                              onCommit={v=>setHoursOverride(item.key,v)}/>
                            <span style={{fontSize:11,color:"var(--t3)",marginLeft:4}}>h</span>
                          </td>
                          <td style={{padding:"9px 8px",fontSize:13,color:"var(--t2)"}}>{item.priority}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
                {heading:"Difficulty",body:"We research how hard the course actually is (drawing on student feedback and course history), combined with how much this item counts toward your grade."},
                {heading:"Hours",body:"Based on the difficulty and grade weight %, our AI estimates how long it'll take to prep HW or study for exams. This is what gets blocked off on your calendar."},
                {heading:"Your inputs always win",body:"You always have the option to edit these estimates based on your own experience. Your input is what gets used to plan — never the AI's original estimate. Over time, we'll use your edits to personalize future estimates to you specifically."},
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
                    upd({courses:[...data.courses,{...ncCourse,id:Date.now(),termId:viewingTermId,color:CC[data.courses.length%CC.length]}]});
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
          onConfirm={correctedParsed=>finalizeSync(correctedParsed,pendingVerify.fileNames)}
          onCancel={()=>{setPendingVerify(null);setSylPdfs([]);}}
        />
      )}
    </div>
  );
}
// ── SCHOOL INFO ──────────────────────────────────────────────────────────────
function SchoolInfo({data,upd,updP,toast2}){
  const schools=data.schools||[];
  const termStatuses=computeTermStatuses(data.terms,iso());
  const currentTerm=termStatuses.find(t=>t.status==="current")||null;
  const currentSchoolId=currentTerm?.schoolId||null;
  const [expandedSchoolId,setExpandedSchoolId]=useState(currentSchoolId);
  useEffect(()=>{if(currentSchoolId&&expandedSchoolId===null)setExpandedSchoolId(currentSchoolId);},[currentSchoolId]); // eslint-disable-line

  // Same card styling used throughout Academics/Today/Preferences — for real visual consistency
  // rather than the ad-hoc custom card styling this tab started with.
  const BOX={background:"var(--card)",borderRadius:12,marginBottom:14};
  const TITLE_ROW={display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 20px 0 20px"};
  const TITLE_LEFT={display:"flex",alignItems:"center",gap:8};
  const TITLE_ICON={fontSize:17,color:"var(--blue)"};
  const TITLE_TEXT={fontSize:13,fontWeight:500,color:"var(--t2)",textTransform:"uppercase",letterSpacing:"0.08em"};
  const DIVIDER={borderTop:"1px solid var(--b1)",margin:"10px 20px 0 20px"};
  const INNER={padding:"14px 20px 18px 20px"};

  const [showAddTerm,setShowAddTerm]=useState(false);
  const [newSchool,setNewSchool]=useState("");
  const [newType,setNewType]=useState("quarter");
  const [newName,setNewName]=useState("");
  const [newStart,setNewStart]=useState("");
  const [newEnd,setNewEnd]=useState("");
  const [lookupState,setLookupState]=useState("idle"); // idle | loading | done | error

  // Editing an EXISTING term — name/type/dates only (typo correction), not which school it
  // belongs to (that's a bigger structural move, out of scope for a simple correction).
  const [editingTerm,setEditingTerm]=useState(null); // {id, name, type, start, end} while a term is being edited, else null
  function startEditTerm(t){setEditingTerm({id:t.id,name:t.name,type:t.type,start:t.start,end:t.end});}
  function saveEditedTerm(){
    if(!editingTerm.start||!editingTerm.end){toast2("Both dates are required",true);return;}
    upd({terms:data.terms.map(t=>t.id===editingTerm.id?{...t,name:editingTerm.name||"Untitled term",type:editingTerm.type,start:editingTerm.start,end:editingTerm.end}:t)});
    toast2("Term updated");
    setEditingTerm(null);
  }

  const bySchool={};
  termStatuses.forEach(t=>{(bySchool[t.schoolId]=bySchool[t.schoolId]||[]).push(t);});
  const schoolIds=Object.keys(bySchool).sort((a,b)=>a===currentSchoolId?-1:b===currentSchoolId?1:0);

  async function handleSchoolSelected(schoolName){
    setNewSchool(schoolName);
    const existing=schools.find(s=>s.name===schoolName);
    if(existing){
      // Existing school — pre-fill the type as an editable default from its most recent term,
      // but never auto-guess the NEW term's own dates just from knowing the school.
      const existingTerms=termStatuses.filter(t=>t.schoolId===existing.id);
      if(existingTerms.length)setNewType(existingTerms[existingTerms.length-1].type);
      return;
    }
    // New school — try the same auto-fill lookup already used elsewhere in the app.
    setLookupState("loading");
    try{
      const result=await fetchCollegeCalendar(schoolName);
      if(result.scheduleType==="quarter"||result.scheduleType==="semester")setNewType(result.scheduleType);
      if(result.termStart)setNewStart(result.termStart);
      if(result.termEnd)setNewEnd(result.termEnd);
      if(result.termName)setNewName(result.termName);
      setLookupState("done");
    }catch(err){
      console.error("StudyOS: school lookup failed —",err);
      setLookupState("error");
      toast2("Couldn't auto-fill that school — please fill in the term manually.",true);
    }
  }

  function saveNewTerm(){
    if(!newSchool||!newStart||!newEnd){toast2("School name and both dates are required",true);return;}
    const existing=schools.find(s=>s.name===newSchool);
    const schoolId=existing?existing.id:"sch_"+Date.now();
    const patch={};
    if(!existing)patch.schools=[...schools,{id:schoolId,name:newSchool,address:"",schoolType:newType}];
    patch.terms=[...(data.terms||[]),{id:"term_"+Date.now(),schoolId,name:newName||"New term",type:newType,start:newStart,end:newEnd,holidays:[],source:null,fetchedAt:null}];
    upd(patch);
    toast2(existing?"Term added!":"New school and term added!");
    setExpandedSchoolId(schoolId);
    setShowAddTerm(false);
    setNewSchool("");setNewName("");setNewStart("");setNewEnd("");setLookupState("idle");
  }

  const statusColor=s=>s==="current"?"var(--amber)":s==="upcoming"?"var(--blue)":"var(--t3)";

  return(
    <div className="fade">
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
        <h2>School Info</h2>
        <button className="btn btn-action btn-sm" onClick={()=>setShowAddTerm(true)}>
          <i className="ti ti-plus"/> Add term
        </button>
      </div>

      {schoolIds.length===0&&(
        <div className="card" style={{padding:20,textAlign:"center",color:"var(--t3)"}}>
          No school on record yet — click "Add term" to get started.
        </div>
      )}

      {schoolIds.map(schoolId=>{
        const school=schools.find(s=>s.id===schoolId);
        const terms=bySchool[schoolId].sort((a,b)=>a.start.localeCompare(b.start));
        const isCurrent=schoolId===currentSchoolId;
        const isExpanded=expandedSchoolId===schoolId;
        const completedCount=terms.filter(t=>t.status==="completed").length;
        if(!isExpanded){
          return(
            <button key={schoolId} onClick={()=>setExpandedSchoolId(schoolId)}
              className="card" style={{width:"100%",textAlign:"left",padding:"12px 16px",marginBottom:10,
                display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",border:"none"}}>
              <span style={{fontSize:14,color:"var(--t2)"}}>
                <i className="ti ti-chevron-right" style={{marginRight:6}}/>{school?.name||"(unknown school)"} · {terms.length} term{terms.length!==1?"s":""}
                {completedCount>0&&`, ${completedCount} completed`}
              </span>
              <i className="ti ti-history" style={{color:"var(--t3)"}}/>
            </button>
          );
        }
        return(
          <div key={schoolId} style={{marginBottom:20}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,padding:"0 2px"}}>
              <i className="ti ti-building" style={TITLE_ICON}/>
              <span style={{...TITLE_TEXT,color:"var(--t1)",fontSize:15,textTransform:"none",letterSpacing:"normal",fontWeight:600}}>{school?.name||"(unknown school)"}</span>
              {isCurrent&&<span className="badge badge-amber" style={{fontSize:13}}>Current school</span>}
              {schoolIds.length>1&&(
                <button className="btn btn-ghost btn-sm" style={{marginLeft:"auto",fontSize:12}} onClick={()=>setExpandedSchoolId(null)}>Collapse</button>
              )}
            </div>
            {school?.address&&<div style={{fontSize:12,color:"var(--t3)",marginBottom:12,paddingLeft:2}}>{school.address}</div>}
            {terms.map(t=>(
              <div key={t.id} style={BOX}>
                <div style={TITLE_ROW}>
                  <div style={TITLE_LEFT}>
                    <div style={{width:10,height:10,borderRadius:"50%",background:statusColor(t.status)}}/>
                    <span style={{...TITLE_TEXT,color:"var(--t1)",fontSize:16,textTransform:"none",letterSpacing:"normal",fontWeight:500}}>{t.name}</span>
                    <span className="badge" style={{background:"transparent",border:`1px solid ${statusColor(t.status)}`,color:statusColor(t.status),fontSize:10,textTransform:"uppercase"}}>
                      {t.status}
                    </span>
                  </div>
                  <button className="tt" data-tt="Edit name/type/dates" onClick={()=>startEditTerm(t)}
                    style={{width:26,height:26,borderRadius:"50%",flexShrink:0,
                      border:"1px solid var(--b1)",background:"var(--card2)",color:"var(--t2)",cursor:"pointer",
                      display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>
                    <i className="ti ti-pencil" style={{fontSize:13}}/>
                  </button>
                </div>
                <div style={DIVIDER}/>
                <div style={INNER}>
                  <div style={{fontSize:14,fontWeight:600,color:"var(--t1)"}}>{t.start||"?"} – {t.end||"?"}</div>
                  <div style={{fontSize:13,color:"var(--t3)",marginTop:4}}>
                    {t.type==="quarter"?"Quarter":"Semester"}
                    {t.status==="upcoming"&&" · starts once the current term ends"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        );
      })}

      {showAddTerm&&(
        <div style={{position:"fixed",inset:0,zIndex:9000,background:"rgba(0,0,0,0.55)",
          display:"flex",alignItems:"center",justifyContent:"center",padding:20}}
          onClick={()=>setShowAddTerm(false)}>
          <div style={{background:"var(--card)",borderRadius:14,padding:"20px 24px",maxWidth:420,width:"100%",
            maxHeight:"85vh",overflowY:"auto",boxShadow:"0 24px 60px rgba(0,0,0,0.5)"}}
            onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div style={{fontSize:16,fontWeight:600}}>Add term</div>
              <button className="btn btn-ghost btn-sm" onClick={()=>setShowAddTerm(false)}><i className="ti ti-x"/></button>
            </div>
            <div style={{marginBottom:12}}>
              <label>School</label>
              <CollegeAutocomplete value={newSchool} onChange={setNewSchool} onSelect={handleSchoolSelected} placeholder="Type an existing school, or a new one to transfer..."/>
              {lookupState==="loading"&&<div style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:"var(--t3)",marginTop:5}}><Sp sz={12}/> Looking up term dates...</div>}
            </div>
            <div className="g2" style={{marginBottom:12}}>
              <div><label>Term name</label><input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="e.g. Winter 2027"/></div>
              <div><label>Type</label>
                <select value={newType} onChange={e=>setNewType(e.target.value)}>
                  <option value="quarter">Quarter</option><option value="semester">Semester</option>
                </select>
              </div>
            </div>
            <div className="g2" style={{marginBottom:16}}>
              <div><label>Start</label><input type="date" value={newStart} onChange={e=>setNewStart(e.target.value)}/></div>
              <div><label>End</label><input type="date" value={newEnd} onChange={e=>setNewEnd(e.target.value)}/></div>
            </div>
            <button className="btn btn-action" style={{width:"100%"}} onClick={saveNewTerm} disabled={!newSchool||!newStart||!newEnd}>
              <i className="ti ti-plus"/> Add term
            </button>
          </div>
        </div>
      )}

      {editingTerm&&(
        <div style={{position:"fixed",inset:0,zIndex:9000,background:"rgba(0,0,0,0.55)",
          display:"flex",alignItems:"center",justifyContent:"center",padding:20}}
          onClick={()=>setEditingTerm(null)}>
          <div style={{background:"var(--card)",borderRadius:14,padding:"20px 24px",maxWidth:420,width:"100%",
            maxHeight:"85vh",overflowY:"auto",boxShadow:"0 24px 60px rgba(0,0,0,0.5)"}}
            onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div style={{fontSize:16,fontWeight:600}}>Edit term</div>
              <button className="btn btn-ghost btn-sm" onClick={()=>setEditingTerm(null)}><i className="ti ti-x"/></button>
            </div>
            <div className="g2" style={{marginBottom:12}}>
              <div><label>Term name</label><input value={editingTerm.name} onChange={e=>setEditingTerm(t=>({...t,name:e.target.value}))} placeholder="e.g. Fall 2026"/></div>
              <div><label>Type</label>
                <select value={editingTerm.type} onChange={e=>setEditingTerm(t=>({...t,type:e.target.value}))}>
                  <option value="quarter">Quarter</option><option value="semester">Semester</option>
                </select>
              </div>
            </div>
            <div className="g2" style={{marginBottom:16}}>
              <div><label>Start</label><input type="date" value={editingTerm.start} onChange={e=>setEditingTerm(t=>({...t,start:e.target.value}))}/></div>
              <div><label>End</label><input type="date" value={editingTerm.end} onChange={e=>setEditingTerm(t=>({...t,end:e.target.value}))}/></div>
            </div>
            <button className="btn btn-action" style={{width:"100%"}} onClick={saveEditedTerm} disabled={!editingTerm.start||!editingTerm.end}>
              <i className="ti ti-device-floppy"/> Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── SETTINGS ─────────────────────────────────────────────────────────────────

function Sett({data,upd,updP,toast2,refreshQuarterPlan,planMsg,busy,planning}){
  const {confirm,modal}=useConfirm();
  const [sec,setSec]=useState("schedule");
  const [nc,setNc]=useState({n:"",e:"📋",days:[],time:"",dur:30});
  const p=data.profile;

  // Fields that actually feed the scheduler — a change to any of these means the existing plan is
  // now stale and worth refreshing. Changing anything ELSE (reminders...) doesn't affect
  // scheduling at all, so "Save & Replan" shouldn't burn a full quarter-wide replan on those —
  // just save quietly. termStart/termEnd/collegeCalendar moved to Account along with School Info,
  // so they're no longer part of what this page can change.
  const PLAN_RELEVANT_FIELDS=[
    "wakeTime","sleepTime","breakfastTime","breakfastDur","lunchTime","lunchDur","dinnerTime","dinnerDur",
    "commuteMins","focusMins","breakMins","sessionPreset","energyPeak","gymDays","gymStretch","gymDrive","chores"];
  function planRelevantSnapshot(profile){
    const snap={};
    PLAN_RELEVANT_FIELDS.forEach(f=>{snap[f]=profile[f];});
    return JSON.stringify(snap);
  }
  // Dynamic dirty check — compares only the plan-relevant fields against a snapshot taken at last
  // save/load, not the whole profile. Comparing the whole profile was the actual bug: it meant
  // any edit anywhere (even something with zero scheduling impact) lit up "plan not yet
  // refreshed", when saveReplan()'s own internal check already knew better and would silently
  // no-op the replan for exactly those changes. Now the indicator and the real behavior agree.
  const [baseline,setBaseline]=useState(()=>planRelevantSnapshot(data.profile));
  const dirty=planRelevantSnapshot(data.profile)!==baseline;
  // Runs the EXACT same quarter-wide replanning as Weekly's "Refresh Plan" button — not a
  // different, lighter action. Marks the current profile as the new saved baseline either way.
  async function saveReplan(){
    await refreshQuarterPlan();
    setBaseline(planRelevantSnapshot(data.profile));
  }

  function mk(fn){fn();}

  const SECS=[
    {id:"schedule",l:"Daily Schedule"},
    {id:"life",    l:"Gym & Fun"},
    {id:"chores",  l:"Chores"},
    {id:"notifs",  l:"Notifications"},
  ];

  const [notifPerm,setNotifPerm]=useState(typeof Notification!=="undefined"?Notification.permission:"unsupported");
  async function enableNotifs(){
    if(typeof Notification==="undefined"){toast2("Notifications aren't supported in this browser",true);return;}
    const perm=await Notification.requestPermission();
    setNotifPerm(perm);
    if(perm==="granted"){updP({remindersOn:true});toast2("Notifications enabled! 🔔");}
    else{toast2("Permission denied — enable it in your browser's site settings",true);}
  }

  return(
    <div className="fade">
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <h2>Preferences</h2>
        <div className="row">
          {dirty&&<span className="badge badge-amber">● plan not yet refreshed</span>}
          <button className={`btn btn-sm tt ${dirty?"btn-action":"btn-ghost"}`} data-tt="Re-plans every day from today through the end of your term — but only if something that actually affects scheduling changed (term dates, wake/sleep/meal times, focus length, energy peak, gym days). Other changes just save." onClick={saveReplan} disabled={planning||!dirty} title={dirty?"Refresh your plan with these new settings":"No changes to refresh"}>
            {planning?<><Sp sz={12}/> Replanning...</>:<><i className="ti ti-refresh"/> Save &amp; Replan</>}
          </button>
        </div>
      </div>
      {busy&&planMsg&&(
        <div style={{fontSize:12,color:"var(--t3)",marginTop:-10,marginBottom:14,textAlign:"right"}}>{planMsg}</div>
      )}

      {/* Section tabs */}
      <div className="row" style={{marginBottom:16,flexWrap:"wrap",paddingBottom:10,borderBottom:"1px solid var(--b1)"}}>
        {SECS.map(s=>(
          <button key={s.id} className="btn btn-sm"
            style={{background:sec===s.id?"var(--amber-bg)":undefined,color:sec===s.id?"var(--amber)":undefined}}
            onClick={()=>setSec(s.id)}>{s.l}</button>
        ))}
      </div>

      {sec==="schedule"&&(
        <div>
          <div className="card">
            <SecHead icon="ti-clock" title="Sleep & Wake"/>
            <div className="g3">
              <div><label>Wake time</label><input type="time" value={p.wakeTime} onChange={e=>mk(()=>updP({wakeTime:e.target.value}))}/></div>
              <div><label>Sleep time</label><input type="time" value={p.sleepTime} onChange={e=>mk(()=>updP({sleepTime:e.target.value}))}/></div>
              <div><label>Commute (min)</label><input type="number" min="5" max="120" value={p.commuteMins} onChange={e=>mk(()=>updP({commuteMins:+e.target.value}))}/></div>
            </div>
          </div>
          <div className="card">
            <SecHead icon="ti-brain" title="Study preferences"/>
            <div style={{marginBottom:16}}>
              <label>Study session length <span style={{color:"var(--t3)",fontWeight:400}}>(used when planning your schedule)</span></label>
              <div className="row" style={{marginTop:6}}>
                {[{v:30,l:"30 min (25 study + 5 break)"},{v:45,l:"45 min (40 study + 5 break)"},{v:60,l:"60 min (50 study + 10 break)"}].map(opt=>(
                  <button key={opt.v} className={`opt-btn${+p.sessionPreset===opt.v?" sel":""}`}
                    onClick={()=>mk(()=>updP({sessionPreset:opt.v}))}>{opt.l}</button>
                ))}
              </div>
            </div>
            <div style={{marginBottom:16}}>
              <label>Focus block length <span style={{color:"var(--t3)",fontWeight:400}}>(Pomodoro timer only)</span></label>
              <div className="row" style={{marginTop:6}}>
                {[15,20,25,30,45].map(n=>(
                  <button key={n} className={`opt-btn${+p.focusMins===n?" sel":""}`}
                    onClick={()=>mk(()=>updP({focusMins:n}))}>{n} min</button>
                ))}
              </div>
            </div>
            <div style={{marginBottom:16}}>
              <label>Break between focus blocks <span style={{color:"var(--t3)",fontWeight:400}}>(Pomodoro timer only)</span></label>
              <div className="row" style={{marginTop:6}}>
                {[5,10,15].map(n=>(
                  <button key={n} className={`opt-btn${+p.breakMins===n?" sel":""}`}
                    onClick={()=>mk(()=>updP({breakMins:n}))}>{n} min</button>
                ))}
              </div>
            </div>
            <div>
              <label>Energy peak — when you think clearest</label>
              <div className="row" style={{marginTop:6}}>
                {[["morning","Morning ☀️"],["afternoon","Afternoon 🌤"],["evening","Evening 🌙"]].map(([v,l])=>(
                  <button key={v} className={`opt-btn${p.energyPeak===v?" sel":""}`}
                    onClick={()=>mk(()=>updP({energyPeak:v}))}>{l}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Meal times with conflict detection */}
          <div className="card">
            <SecHead icon="ti-bowl-spoon" title="Meal times"/>
            <div style={{background:"var(--blue-bg)",borderRadius:8,padding:"9px 12px",marginBottom:14,fontSize:13,color:"var(--blue)",display:"flex",gap:8}}>
              <i className="ti ti-info-circle" style={{fontSize:14,flexShrink:0,marginTop:1}}/>
              These are your preferred times. On days they'd overlap a class or exam, StudyOS automatically pushes the meal later (with a short walking buffer) — flagged below with ↻ on the calendar.
            </div>
            {[["Breakfast","breakfastTime","breakfastDur"],["Lunch","lunchTime","lunchDur"],["Dinner","dinnerTime","dinnerDur"]].map(([l,tk,dk])=>{
              const mStart=t2m(p[tk]);
              const mEnd=mStart+(+p[dk]||30);
              // Check conflicts across all days for this meal
              const conflictDays=data.courses.filter(c=>{
                const cStart=t2m(c.startTime)-p.commuteMins;
                const cEnd=t2m(c.endTime)+p.commuteMins;
                return mStart<cEnd&&mEnd>cStart;
              });
              const hasConflict=conflictDays.length>0;
              return(
                <div key={tk} style={{padding:"12px 0",borderBottom:tk!=="dinnerTime"?"1px solid var(--b1)":"none"}}>
                  <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:hasConflict?10:0}}>
                    <div style={{fontSize:18,width:30}}>{l==="Breakfast"?"🍳":l==="Lunch"?"🥗":"🍽"}</div>
                    <div style={{flex:1,fontSize:15,color:"var(--t1)"}}>{l}</div>
                    <input type="time" value={p[tk]} onChange={e=>mk(()=>updP({[tk]:e.target.value}))} style={{width:150}}/>
                    <select value={p[dk]} onChange={e=>mk(()=>updP({[dk]:+e.target.value}))} style={{width:120}}>
                      {[15,20,30,45,60].map(n=><option key={n} value={n}>{n} min</option>)}
                    </select>
                  </div>
                  {hasConflict&&(
                    <div style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px",background:"var(--amber-bg)",borderRadius:8,fontSize:13,color:"var(--amber)"}}>
                      <i className="ti ti-arrows-shuffle" style={{fontSize:14,flexShrink:0}}/>
                      Overlaps {conflictDays.map(c=>c.name.split("(")[0].trim()).join(", ")}
                      <span style={{color:"var(--t3)",marginLeft:4}}>— will auto-shift on those days</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {sec==="life"&&(
        <div>
          <div className="card">
            <SecHead icon="ti-barbell" title="Gym schedule"/>
            <div style={{background:"var(--amber-bg)",borderRadius:8,padding:"9px 12px",marginBottom:12,fontSize:13,color:"var(--amber)",display:"flex",gap:8}}>
              <i className="ti ti-alert-triangle" style={{fontSize:14,flexShrink:0,marginTop:1}}/>
              Gym cannot overlap class or commute time. Conflicts shown per day.
            </div>
            {(p.gymDays||GYM0).map((gd,i)=>{
              // Check if this gym slot conflicts with any class on this day
              const dayClasses=data.courses.filter(c=>c.days.includes(gd.day));
              const gymStart=t2m(gd.s);
              const gymEnd=t2m(gd.e);
              const stretchStart=gymStart-(+p.gymStretch||30)-(+p.gymDrive||10);
              const driveEnd=gymEnd+(+p.gymDrive||10);
              const conflict=gd.on&&dayClasses.some(c=>{
                const cStart=t2m(c.startTime)-p.commuteMins;
                const cEnd=t2m(c.endTime)+p.commuteMins;
                return stretchStart<cEnd&&driveEnd>cStart;
              });
              return(
                <div key={gd.day} style={{padding:"10px 0",borderBottom:i<6?"1px solid var(--b1)":"none"}}>
                  <div className="list-item" style={{padding:0,gap:10,borderBottom:"none"}}>
                    <div style={{display:"flex",alignItems:"center",gap:7,width:78}}>
                      <input type="checkbox" checked={gd.on} onChange={e=>{const d=[...(p.gymDays||GYM0)];d[i]={...d[i],on:e.target.checked};mk(()=>updP({gymDays:d}));}} style={{width:14,height:14}}/>
                      <span style={{fontSize:13,color:gd.on?"var(--t1)":"var(--t3)"}}>{DF[gd.day].slice(0,3)}</span>
                    </div>
                    {gd.on?(
                      <div className="row" style={{flex:1,gap:5}}>
                        <input type="time" value={gd.s} onChange={e=>{const d=[...(p.gymDays||GYM0)];d[i]={...d[i],s:e.target.value};mk(()=>updP({gymDays:d}));}} style={{width:85,fontSize:12,padding:"4px 7px"}}/>
                        <span style={{fontSize:11,color:"var(--t3)"}}>→</span>
                        <input type="time" value={gd.e} onChange={e=>{const d=[...(p.gymDays||GYM0)];d[i]={...d[i],e:e.target.value};mk(()=>updP({gymDays:d}));}} style={{width:85,fontSize:12,padding:"4px 7px"}}/>
                        <span style={{fontSize:11,color:"var(--t3)"}}>{Math.round((t2m(gd.e)-t2m(gd.s)))}m</span>
                      </div>
                    ):<span style={{fontSize:12,color:"var(--t3)"}}>rest day</span>}
                  </div>
                  {conflict&&(
                    <div style={{display:"flex",alignItems:"center",gap:7,padding:"6px 10px",background:"var(--red-bg)",borderRadius:7,marginTop:6,fontSize:12,color:"var(--red)"}}>
                      <i className="ti ti-alert-circle" style={{fontSize:13}}/>
                      Overlaps class or commute on {DF[gd.day]} — adjust time
                    </div>
                  )}
                </div>
              );
            })}
            <div className="g2" style={{marginTop:12}}>
              <div><label>Stretch prep (min)</label><input type="number" min="10" max="60" value={p.gymStretch||30} onChange={e=>mk(()=>updP({gymStretch:+e.target.value}))}/></div>
              <div><label>Drive to gym (min)</label><input type="number" min="5" max="30" value={p.gymDrive||10} onChange={e=>mk(()=>updP({gymDrive:+e.target.value}))}/></div>
            </div>
          </div>
          <div className="card">
            <SecHead icon="ti-mood-smile" title="Fun time targets"/>
            <div className="g2">
              <div><label>Weekday (hrs/day)</label><input type="number" min="0" max="8" step="0.5" value={p.funWD} onChange={e=>mk(()=>updP({funWD:+e.target.value}))}/><div style={{fontSize:11,color:"var(--t3)",marginTop:3}}>Mon–Fri · {(p.funWD*5).toFixed(1)}h total</div></div>
              <div><label>Weekend (hrs/day)</label><input type="number" min="0" max="12" step="0.5" value={p.funWE} onChange={e=>mk(()=>updP({funWE:+e.target.value}))}/><div style={{fontSize:11,color:"var(--t3)",marginTop:3}}>Sat+Sun · {(p.funWE*2).toFixed(1)}h total</div></div>
            </div>
          </div>
        </div>
      )}

      {sec==="chores"&&(
        <div>
          <p style={{fontSize:14,marginBottom:14}}>Weekly chores appear in Today under "Other Activities" and in the calendar.</p>
          {(p.chores||[]).length>0&&(
            <div className="card" style={{marginBottom:12}}>
              <SecHead icon="ti-list" title="Active chores"/>
              {(p.chores||[]).map((c,i,arr)=>(
                <div key={c.id} className="list-item">
                  <span style={{fontSize:18}}>{c.e}</span>
                  <div style={{flex:1}}>
                    <div className="list-item-title">{c.n}</div>
                    <div className="list-item-sub">{c.days.map(d=>DS[d]).join(", ")}{c.time&&` · ${f12(c.time)}`} · {c.dur}min</div>
                  </div>
                  <DelBtn onClick={()=>{mk(()=>updP({chores:(p.chores||[]).filter(x=>x.id!==c.id)}));}}/>
                </div>
              ))}
            </div>
          )}
          <div className="card">
            <SecHead icon="ti-plus" title="Add Chore"/>
            <div style={{marginBottom:10}}>
              <label>Quick select</label>
              <div className="row" style={{flexWrap:"wrap"}}>
                {CHORE_PRESETS.map(pr=>(
                  <button key={pr.n} className="btn btn-sm"
                    style={{background:nc.n===pr.n?"var(--teal-bg)":undefined,color:nc.n===pr.n?"var(--teal)":undefined}}
                    onClick={()=>setNc(c=>({...c,n:pr.n,e:pr.e}))}>
                    {pr.e} {pr.n}
                  </button>
                ))}
              </div>
            </div>
            <div className="g2" style={{marginBottom:10}}>
              <div><label>Or custom name</label><input value={nc.n} onChange={e=>setNc(c=>({...c,n:e.target.value}))} placeholder="e.g. Water plants"/></div>
              <div><label>Emoji</label><input value={nc.e} onChange={e=>setNc(c=>({...c,e:e.target.value}))} style={{maxWidth:80}}/></div>
            </div>
            <div style={{marginBottom:10}}><label>Which days?</label><DayPick val={nc.days} onChange={days=>setNc(c=>({...c,days}))} col="var(--teal)"/></div>
            <div className="g3" style={{marginBottom:12}}>
              <div><label>Time (optional)</label><input type="time" value={nc.time} onChange={e=>setNc(c=>({...c,time:e.target.value}))}/></div>
              <div><label>Duration (min)</label><input type="number" min="10" max="180" value={nc.dur} onChange={e=>setNc(c=>({...c,dur:+e.target.value}))}/></div>
            </div>
            <button className="btn btn-action" style={{width:"100%"}} onClick={()=>{if(!nc.n||!nc.days.length)return;mk(()=>updP({chores:[...(p.chores||[]),{...nc,id:Date.now()}]}));setNc({n:"",e:"📋",days:[],time:"",dur:30});toast2("Chore added");}} disabled={!nc.n||!nc.days.length}>
              <i className="ti ti-plus"/> Add Chore
            </button>
          </div>
          <div style={{padding:"8px 12px",background:"var(--card2)",borderRadius:8,fontSize:12,color:"var(--t3)"}}>
            Changes saved as draft — use "Save &amp; Replan" to update your schedule.
          </div>
        </div>
      )}

      {sec==="notifs"&&(
        <div>
          <div className="card" style={{marginBottom:12}}>
            <SecHead icon="ti-bell" title="Due-date reminders"/>
            <p style={{fontSize:14,marginBottom:14,lineHeight:1.6}}>
              Get a browser notification for anything due today or in the next 2 days, and when it's time to start exam prep. Sent at most once per day, only while StudyOS is open in a tab.
            </p>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 14px",background:"var(--card2)",borderRadius:9,marginBottom:12}}>
              <div>
                <div style={{fontSize:14,color:"var(--t1)"}}>Browser permission</div>
                <div style={{fontSize:12,color:"var(--t3)",marginTop:2}}>
                  {notifPerm==="granted"?"Granted":notifPerm==="denied"?"Blocked — check your browser's site settings":notifPerm==="unsupported"?"Not supported in this browser":"Not yet requested"}
                </div>
              </div>
              <span className={`badge ${notifPerm==="granted"?"badge-green":notifPerm==="denied"?"badge-red":"badge-amber"}`}>
                {notifPerm==="granted"?"✓ On":notifPerm==="denied"?"✗ Blocked":"Off"}
              </span>
            </div>
            {notifPerm!=="granted"&&notifPerm!=="unsupported"&&(
              <button className="btn btn-action" style={{width:"100%"}} onClick={enableNotifs}>
                <i className="ti ti-bell"/> Enable notifications
              </button>
            )}
            {notifPerm==="granted"&&(
              <div className="toggle-group">
                <button className={`toggle-opt${p.remindersOn!==false?" on":""}`} onClick={()=>{mk(()=>updP({remindersOn:true}));toast2("Reminders on");}}>On</button>
                <button className={`toggle-opt${p.remindersOn===false?" on":""}`} onClick={()=>{mk(()=>updP({remindersOn:false}));toast2("Reminders off");}}>Off</button>
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{marginTop:18,paddingTop:14,borderTop:"1px solid var(--b1)"}}>
        <button className="btn btn-sm" style={{color:"var(--red)",background:"transparent"}} onClick={async()=>{if(await confirm("Reset ALL data? Cannot be undone."))upd({...ED});}}>
          <i className="ti ti-trash"/> Reset all data
        </button>
      </div>
      {modal}
    </div>
  );
}
// ── HISTORY ──────────────────────────────────────────────────────────────────
function HistoryDetail({entry,onBack}){
  const BOX={background:"var(--card)",borderRadius:12,marginBottom:14};
  const TITLE_ROW={display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 20px 0 20px"};
  const TITLE_LEFT={display:"flex",alignItems:"center",gap:8};
  const TITLE_ICON={fontSize:17,color:"var(--blue)"};
  const TITLE_TEXT={fontSize:13,fontWeight:500,color:"var(--t2)",textTransform:"uppercase",letterSpacing:"0.08em"};
  const DIVIDER={borderTop:"1px solid var(--b1)",margin:"10px 20px 0 20px"};
  const INNER={padding:"14px 20px 18px 20px"};
  const gradedCount=(entry.courses||[]).filter(c=>c.grade!=null&&c.grade!=="").length;
  const doneCount=(entry.assignments||[]).filter(a=>a.status==="done").length;

  return(
    <div className="fade">
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
        <button className="btn btn-ghost btn-sm" onClick={onBack}><i className="ti ti-arrow-left"/> Back to History</button>
      </div>
      <div style={{marginBottom:20}}>
        <h2 style={{marginBottom:6}}>{entry.name}</h2>
        <div style={{fontSize:13,color:"var(--t3)"}}>Archived {entry.closedAt} · View only</div>
      </div>

      <div style={{...BOX,padding:"18px 20px",textAlign:"center"}}>
        <div style={{fontSize:12,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Final GPA</div>
        <div style={{fontSize:40,fontFamily:"'Syne',sans-serif",fontWeight:700,color:"var(--amber)"}}>
          {entry.gpa!==null&&entry.gpa!==undefined?entry.gpa.toFixed(2):"—"}
        </div>
        <div style={{fontSize:13,color:"var(--t3)",marginTop:4}}>
          Based on {gradedCount} graded course{gradedCount!==1?"s":""} · {doneCount}/{(entry.assignments||[]).length} assignments completed
        </div>
      </div>

      <div style={BOX}>
        <div style={TITLE_ROW}>
          <div style={TITLE_LEFT}><i className="ti ti-school" style={TITLE_ICON}/><span style={TITLE_TEXT}>Courses</span></div>
        </div>
        <div style={DIVIDER}/>
        <div style={INNER}>
          {(entry.courses||[]).length===0
            ?<div style={{fontSize:14,color:"var(--t3)"}}>No courses recorded</div>
            :entry.courses.map(c=>{
              const{letter}=letterFromPct(c.grade);
              return(
                <div key={c.id} className="list-item">
                  <div style={{width:8,height:8,borderRadius:"50%",background:c.color?.border||"var(--t3)",flexShrink:0}}/>
                  <div style={{flex:1,fontSize:14,color:"var(--t1)"}}>{c.name}</div>
                  <span className="badge badge-amber" style={{fontSize:12}}>{letter}</span>
                  <span style={{fontSize:12,color:"var(--t3)",marginLeft:8}}>{c.credits??4} cr</span>
                </div>
              );
            })
          }
        </div>
      </div>

      <div style={BOX}>
        <div style={TITLE_ROW}>
          <div style={TITLE_LEFT}><i className="ti ti-clipboard-list" style={TITLE_ICON}/><span style={TITLE_TEXT}>Assignments — {doneCount}/{(entry.assignments||[]).length} done</span></div>
        </div>
        <div style={DIVIDER}/>
        <div style={INNER}>
          {(entry.assignments||[]).length===0
            ?<div style={{fontSize:14,color:"var(--t3)"}}>No assignments recorded</div>
            :entry.assignments.map(a=>(
              <div key={a.id} className="list-item">
                <div className={`chk${a.status==="done"?" on":""}`} style={{cursor:"default"}}>
                  {a.status==="done"&&<i className="ti ti-check" style={{fontSize:10,color:"var(--green)"}}/>}
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:14,color:"var(--t1)"}}>{a.title}</div>
                  <div style={{fontSize:12,color:"var(--t3)"}}>{courseNameFor(entry.courses||[],a.courseId)}{a.dueDate&&` · due ${a.dueDate}`}</div>
                </div>
              </div>
            ))
          }
        </div>
      </div>

      <div style={BOX}>
        <div style={TITLE_ROW}>
          <div style={TITLE_LEFT}><i className="ti ti-writing" style={TITLE_ICON}/><span style={TITLE_TEXT}>Exams</span></div>
        </div>
        <div style={DIVIDER}/>
        <div style={INNER}>
          {(entry.exams||[]).length===0
            ?<div style={{fontSize:14,color:"var(--t3)"}}>No exams recorded</div>
            :entry.exams.map(e=>(
              <div key={e.id} className="list-item">
                <div style={{flex:1}}>
                  <div style={{fontSize:14,color:"var(--t1)"}}>{courseNameFor(entry.courses||[],e.courseId)}{e.topics&&<span style={{color:"var(--t3)"}}> — {e.topics}</span>}</div>
                  <div style={{fontSize:12,color:"var(--t3)"}}>{e.date}</div>
                </div>
              </div>
            ))
          }
        </div>
      </div>
    </div>
  );
}
function History({data,upd,toast2}){
  const{confirm,modal}=useConfirm();
  const[viewing,setViewing]=useState(null);
  const[closing,setClosing]=useState(false);
  const[qName,setQName]=useState(()=>{const q=getQ(data.profile);return q?q.name:"";});
  const hist=[...(data.history||[])].sort((a,b)=>new Date(b.closedAt)-new Date(a.closedAt));

  async function closeQuarter(){
    const name=qName.trim();
    if(!name)return;
    const ok=await confirm(`Archive "${name}" with ${data.courses.length} course${data.courses.length!==1?"s":""} and ${data.assignments.length} assignment${data.assignments.length!==1?"s":""}? Your active Courses, Assignments, and Exams will move to History and be cleared so you can start the next term fresh.`);
    if(!ok)return;
    const snapshot={
      id:Date.now(),
      name,
      closedAt:iso(),
      courses:data.courses,
      assignments:data.assignments,
      exams:data.exams,
      gpa:calcGPA(data.courses),
    };
    upd({
      history:[...(data.history||[]),snapshot],
      courses:[],assignments:[],exams:[],
      briefCache:null,briefDate:null,
    });
    setClosing(false);
    setQName("");
    toast2(`"${snapshot.name}" archived to History! Ready for a new term.`);
  }

  if(viewing){
    const h=hist.find(x=>x.id===viewing);
    if(h)return <HistoryDetail entry={h} onBack={()=>setViewing(null)}/>;
    setViewing(null);
  }

  return(
    <div className="fade">
      <h2 style={{marginBottom:16}}>History</h2>

      <div className="card" style={{marginBottom:16}}>
        <SecHead icon="ti-archive" title="Current term"/>
        <p style={{fontSize:14,marginBottom:14,lineHeight:1.6}}>
          When your quarter or semester ends, close it out to archive your courses, assignments, exams, and final GPA — then your active lists reset for the next term.
        </p>
        {!closing?(
          <button className="btn btn-action" onClick={()=>setClosing(true)} disabled={!data.courses.length&&!data.assignments.length}>
            <i className="ti ti-archive"/> Close current term
          </button>
        ):(
          <div>
            <div style={{marginBottom:10}}>
              <label>Term name</label>
              <input value={qName} onChange={e=>setQName(e.target.value)} placeholder="e.g. Spring 2026"/>
            </div>
            <div className="row">
              <button className="btn btn-action" style={{flex:1}} onClick={closeQuarter} disabled={!qName.trim()}>
                <i className="ti ti-check"/> Archive &amp; start fresh
              </button>
              <button className="btn btn-ghost" onClick={()=>setClosing(false)}>Cancel</button>
            </div>
          </div>
        )}
        {!data.courses.length&&!data.assignments.length&&!closing&&(
          <div style={{fontSize:12,color:"var(--t3)",marginTop:10}}>Nothing active to archive yet — add courses in Academics first.</div>
        )}
      </div>

      <div className="card">
        <SecHead icon="ti-history" title={`Archived terms — ${hist.length}`}/>
        {hist.length===0
          ?<div style={{fontSize:14,color:"var(--t3)",textAlign:"center",padding:"20px 0"}}>No archived terms yet</div>
          :hist.map(h=>(
            <div key={h.id} className="list-item" style={{cursor:"pointer"}} onClick={()=>setViewing(h.id)}>
              <div style={{width:8,height:8,borderRadius:"50%",background:"var(--blue)",flexShrink:0}}/>
              <div style={{flex:1}}>
                <div className="list-item-title">{h.name}</div>
                <div className="list-item-sub">{(h.courses||[]).length} course{(h.courses||[]).length!==1?"s":""} · archived {h.closedAt}</div>
              </div>
              {h.gpa!==null&&h.gpa!==undefined&&<span className="badge badge-amber">{h.gpa.toFixed(2)} GPA</span>}
              <i className="ti ti-chevron-right" style={{fontSize:14,color:"var(--t3)"}}/>
            </div>
          ))
        }
      </div>
      {modal}
    </div>
  );
}
// ── PROGRESS ─────────────────────────────────────────────────────────────────
function Prog({data,upd,toast2,ai,busy}){
  const logs=data.dailyLogs||[],gymLogs=data.gymLogs||[],p=data.profile;
  const td=iso(),gymD=(p.gymDays||GYM0).filter(g=>g.on),gymTarget=gymD.length;
  const streak=(()=>{let s=0;for(let i=0;i<30;i++){const d=iso(new Date(Date.now()-i*864e5));const l=logs.find(x=>x.date===d);if(l&&l.completed?.length>0)s++;else if(i>0)break;}return s;})();
  const cr=logs.length?Math.round(logs.filter(l=>l.completed?.length>0).length/logs.length*100):0;
  const g30=gymLogs.filter(g=>{const d=new Date(g.date);const a=new Date();a.setDate(a.getDate()-30);return d>=a;}).length;
  const hs=Math.min(100,Math.round(streak*4+cr*0.4+Math.min(20,g30*2)+(data.onboarded?10:0)));
  const ms=[
    {l:"7+ day study streak",ok:streak>=7},
    {l:"Consistent check-ins (14+ days)",ok:logs.length>=14},
    {l:"Gym habit (12+ sessions/month)",ok:g30>=12},
    {l:"Completion rate above 70%",ok:cr>=70},
    {l:"10+ day streak",ok:streak>=10},
    {l:"No missed exam prep",ok:data.exams.every(e=>du(e.date)<0||du(e.date)>e.prepDays)},
  ];
  const tl=logs.find(l=>l.date===td)||{date:td,completed:[],skipped:[],notes:""};
  const [comp,setComp]=useState(tl.completed||[]);
  const [notes,setNotes]=useState(tl.notes||"");
  const [fb,setFb]=useState(null);
  const [sub,setSub]=useState(false);
  const tasks=[
    ...data.assignments.filter(a=>a.status!=="done"&&a.dueDate&&du(a.dueDate)<=2).map(a=>({id:`a-${a.id}`,l:`${a.title} (${courseNameFor(data.courses,a.courseId)})`,t:"assignment",days:du(a.dueDate)})),
    ...data.exams.filter(e=>{const d=du(e.date);return d>=0&&d<=e.prepDays;}).map(e=>({id:`e-${e.id}`,l:`Study for ${courseNameFor(data.courses,e.courseId)} exam`,t:"exam",days:du(e.date)})),
  ].sort((a,b)=>a.days-b.days);

  async function submit(){
    setSub(true);
    const nl={date:td,completed:comp,skipped:tasks.map(t=>t.id).filter(id=>!comp.includes(id)),notes,savedAt:new Date().toISOString()};
    upd({dailyLogs:[...logs.filter(l=>l.date!==td),nl]});
    try{
      const t=await AI(`Warm encouraging assistant. ${p.name} has ADD. Lead with achievements. 3-4 sentences. Plain text.`,
        `Check-in: ${comp.length}/${tasks.length} done.
Done: ${comp.map(id=>tasks.find(t=>t.id===id)?.l||id).join(", ")||"None"}
Notes: ${notes||"None"}
Celebrate, no guilt, one encouragement for tomorrow.`);
      setFb(t);
    }catch{}
    toast2("Check-in saved! 🎯");setSub(false);
  }

  const dp=tasks.length?Math.round(comp.length/tasks.length*100):100;
  const gpa=calcGPA(data.courses);
  const pomoLogs=data.pomodoroLogs||[];
  const focus30=pomoLogs.filter(l=>{const d=new Date(l.date);const a=new Date();a.setDate(a.getDate()-30);return d>=a;}).reduce((s,l)=>s+l.mins,0);

  return(
    <div className="fade">
      <h2 style={{marginBottom:16}}>Progress</h2>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(105px,1fr))",gap:10,marginBottom:14}}>
        <StatCard label="Habit score" value={hs} sub="/100" col="var(--blue)" icon="ti-star"/>
        <StatCard label="Streak" value={streak} sub=" days" col="var(--a-study-t)" icon="ti-flame"/>
        <StatCard label="Completion" value={cr} sub="%" col="var(--amber)" icon="ti-chart-bar"/>
        <StatCard label="Gym/30d" value={g30} sub={`/${gymTarget*4}`} col="var(--a-gym-t)" icon="ti-barbell"/>
        <StatCard label="GPA" value={gpa!==null?gpa.toFixed(2):"—"} sub="" col="var(--amber)" icon="ti-award"/>
        <StatCard label="Focus/30d" value={focus30} sub=" min" col="var(--a-study-t)" icon="ti-clock-play"/>
        <StatCard label="UCSD ready" value={ms.filter(m=>m.ok).length} sub={`/${ms.length}`} col="var(--lime)" icon="ti-school"/>
      </div>

      <div className="card" style={{marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <SecHead icon="ti-star" title="Habit Score"/>
          <span style={{fontSize:18,color:"var(--blue)"}}>{hs}/100</span>
        </div>
        <div className="bar" style={{marginBottom:7}}><div className="bar-fill" style={{width:`${hs}%`,background:hs>=75?"var(--a-study-t)":hs>=50?"var(--amber)":"var(--blue)"}}/></div>
        <div style={{fontSize:13,color:"var(--t2)"}}>{hs>=75?"UCSD-ready habits forming":hs>=50?"Good progress — keep going":"Every check-in builds the habit"}</div>
      </div>

      <div className="card" style={{marginBottom:12}}>
        <SecHead icon="ti-checkbox" title="Evening Check-in"/>
        <p style={{fontSize:13,marginBottom:12}}>No judgment — tracking so tomorrow's plan is smarter.</p>
        {tasks.length===0
          ?<div style={{fontSize:14,color:"var(--a-study-t)",textAlign:"center",padding:"10px"}}>Nothing urgent today</div>
          :<div>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
              <span style={{fontSize:13,color:"var(--t2)"}}>What got done?</span>
              <span style={{fontSize:13,color:dp>=80?"var(--a-study-t)":dp>=50?"var(--amber)":"var(--red)"}}>{dp}%</span>
            </div>
            <div className="bar" style={{marginBottom:12}}><div className="bar-fill" style={{width:`${dp}%`,background:dp>=80?"var(--a-study-t)":dp>=50?"var(--amber)":"var(--red)"}}/></div>
            {tasks.map((t,i)=>(
              <div key={t.id} className="list-item" style={{cursor:"pointer",opacity:comp.includes(t.id)?0.5:1}} onClick={()=>setComp(prev=>prev.includes(t.id)?prev.filter(x=>x!==t.id):[...prev,t.id])}>
                <div className={`chk${comp.includes(t.id)?" on":""}`}>{comp.includes(t.id)&&<i className="ti ti-check" style={{fontSize:10,color:"var(--green)"}}/>}</div>
                <span style={{fontSize:14,flex:1,textDecoration:comp.includes(t.id)?"line-through":"none",color:"var(--t1)"}}>{t.l}</span>
                <span className={`badge ${t.t==="exam"?"badge-amber":"badge-blue"}`} style={{fontSize:11}}>{t.t}</span>
              </div>
            ))}
          </div>
        }
        <textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Anything to add?" style={{width:"100%",minHeight:55,fontFamily:"inherit",fontSize:13,resize:"vertical",marginTop:12,marginBottom:10}}/>
        <button className="btn btn-action" style={{width:"100%"}} onClick={submit} disabled={sub}>
          {sub?<><Sp sz={13}/> Saving...</>:<><i className="ti ti-send"/> Submit Check-in</>}
        </button>
        {fb&&<div style={{marginTop:11,padding:"12px 15px",background:"var(--green-bg)",borderRadius:9,fontSize:13,lineHeight:1.7,color:"var(--t2)"}}><div style={{fontSize:10,color:"var(--a-study-t)",textTransform:"uppercase",letterSpacing:"0.09em",marginBottom:5}}>AI feedback</div>{fb}</div>}
      </div>

      <div className="card" style={{marginBottom:12}}>
        <SecHead icon="ti-school" title="UCSD Readiness"/>
        {ms.map((m,i)=>(
          <div key={i} className="list-item">
            <div style={{width:17,height:17,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,background:m.ok?"var(--green-bg)":"var(--card2)"}}>
              {m.ok&&<i className="ti ti-check" style={{fontSize:10,color:"var(--green)"}}/>}
            </div>
            <span style={{fontSize:13,color:m.ok?"var(--t1)":"var(--t3)",flex:1}}>{m.l}</span>
            {m.ok&&<span style={{fontSize:11,color:"var(--green)"}}>✓</span>}
          </div>
        ))}
      </div>

      <div className="card">
        <SecHead icon="ti-calendar" title="Last 14 days"/>
        <div className="row" style={{flexWrap:"wrap",marginBottom:7}}>
          {Array.from({length:14},(_,i)=>{
            const d=iso(new Date(Date.now()-(13-i)*864e5));
            const l=logs.find(x=>x.date===d);const dn=l?.completed?.length||0;
            const gym=gymLogs.some(g=>g.date===d);const isT=d===iso();
            return(
              <div key={i} title={d} style={{width:30,height:30,borderRadius:7,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
                background:dn>0?"var(--a-study)":l?"var(--amber-bg)":"var(--card2)",
                outline:isT?"2px solid var(--blue)":"none"}}>
                <span style={{fontSize:11,color:dn>0?"var(--a-study-t)":l?"var(--amber)":"var(--t3)"}}>{dn>0?dn:"·"}</span>
                {gym&&<span style={{fontSize:7,color:"var(--a-gym-t)"}}>💪</span>}
              </div>
            );
          })}
        </div>
        <div style={{fontSize:11,color:"var(--t3)"}}>Number = tasks completed · 💪 = gym</div>
      </div>
    </div>
  );
}

export default App;
