"use client";
import React, { useState, useEffect, useRef } from "react";
import { iso, t2m, du, f12 } from "@/lib/time";
import { courseNameFor, findMatchingCourse } from "@/lib/courses";
import { DS, DF, CC } from "@/lib/constants";
import { calcGPA, letterFromPct } from "@/lib/grades";
import { CI } from "@/lib/api";
import { PDF } from "@/lib/pdf";
import { APP_VERSION, APP_BUILD_DATE, APP_BUILD_TIME } from "@/lib/version";
import { freeSlots, weekStartOf } from "@/lib/calendar";
import { fetchCollegeCalendar, applyCollegeCalendarResult } from "@/lib/colleges";
import {
  Sp,
  CollegeAutocomplete,
  SecHead,
  DelBtn,
  PdfDrop,
  DayPick,
  StatCard,
  useConfirm,
  AccountModal,
  WeekGrid,
} from "@/components/shared";
import { planHorizon } from "@/lib/planner";
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
import { Today } from "@/components/Today";
import { Week } from "@/components/Week";
import { Acad } from "@/components/Acad";
console.log(`StudyOS v${APP_VERSION} (built ${APP_BUILD_DATE} ${APP_BUILD_TIME}) loaded`);
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
// Backward-ramp weight for a day that is `d` days before a deadline, within a `windowDays`-long
// planning horizon — later days (closer to the deadline) get proportionally more time than earlier ones.
function rampMinutes(windowDays,d,totalMinutes,minPerDay,maxPerDay){
  if(d<0||d>windowDays)return 0;
  const totalWeight=((windowDays+1)*(windowDays+2))/2;
  const weight=windowDays-d+1;
  const raw=totalMinutes*weight/totalWeight;
  return Math.min(maxPerDay,Math.max(minPerDay,Math.round(raw)));
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
