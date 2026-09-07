"use client";
import React, { useState, useEffect, useRef } from "react";
import { iso, du } from "@/lib/time";
import { courseNameFor } from "@/lib/courses";
import { AI } from "@/lib/api";
import { APP_VERSION, APP_BUILD_DATE, APP_BUILD_TIME } from "@/lib/version";
import { freeSlots, weekStartOf } from "@/lib/calendar";
import { useConfirm, AccountModal } from "@/components/shared";
import { planHorizon } from "@/lib/planner";
import {
  ED,
  load,
  save,
  getQ,
  isHol,
  isFin,
  termScopedForPlanning,
  migrateLegacyTermIfNeeded,
  dedupeItemIdsIfNeeded,
  normalizeCourseNamesIfNeeded,
  syncActiveTermToProfilePatch,
} from "@/lib/data";
import { planningRange } from "@/lib/planningRange";
import { supabase } from "@/lib/supabase";
import { Today } from "@/components/Today";
import { Week } from "@/components/Week";
import { Acad } from "@/components/Acad";
import { Onboard } from "@/components/Onboard";
import { SchoolInfo } from "@/components/SchoolInfo";
import { Sett } from "@/components/Sett";
import { History } from "@/components/History";
import { Prog } from "@/components/Prog";
import { Login } from "@/components/Login";
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
  // Auth session: undefined = still checking on mount, null = signed out, object = signed in.
  // load()/save() (lib/data/store.js) key off the Supabase session themselves, so `data` is only
  // ever populated while signed in — see the load effect and the render gates further down.
  const [session,setSession]=useState(undefined);
  useEffect(()=>{
    supabase.auth.getSession().then(({data})=>setSession(data.session));
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_evt,s)=>setSession(s));
    return ()=>subscription.unsubscribe();
  },[]);

  // Starts null (not {...ED}) because load() is async and needs a signed-in user. Re-runs whenever
  // the session changes: loads that user's row on sign-in, clears on sign-out. The loading gate
  // below (after every hook is declared, before any data.* access) renders nothing until load()
  // resolves for the current user.
  const [data,setD]=useState(null);
  useEffect(()=>{
    if(!session){setD(null);return;}
    let cancelled=false;
    load().then(d=>{if(!cancelled)setD(d||{...ED});});
    return ()=>{cancelled=true;};
  },[session?.user?.id]); // eslint-disable-line
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
  const [planDrawerOpen,setPlanDrawerOpen]=useState(false); // Weekly-tab Plan status drawer — lifted here so a replan can auto-open it on a shortfall

  function upd(p){setD(prev=>{const n={...prev,...p};save(n);return n;});}
  function updP(p){upd({profile:{...data.profile,...p}});}
  function toast2(m,e){setToast({m,e});setTimeout(()=>setToast(null),3000);}

  // One-time legacy migration — synthesizes a school+term entry from existing profile fields the
  // first time this loads with terms[] still empty. Runs on every render but is a genuine no-op
  // once migrated (migrateLegacyTermIfNeeded returns null once terms[].length>0), so it's safe
  // without a separate version flag.
  useEffect(()=>{
    if(!data)return;
    const migration=migrateLegacyTermIfNeeded(data);
    if(migration)upd(migration);
  },[data?.terms?.length,data?.profile.schoolName]); // eslint-disable-line

  // One-time repair for colliding assignment/exam ids from earlier builds (see dedupeItemIdsIfNeeded).
  useEffect(()=>{
    if(!data)return;
    const fix=dedupeItemIdsIfNeeded(data);
    if(fix)upd(fix);
  },[data?.assignments?.length,data?.exams?.length]); // eslint-disable-line

  // Collapse full AI course titles to canonical codes ("MATH 180A") so every account renders identically.
  useEffect(()=>{
    if(!data)return;
    const fix=normalizeCourseNamesIfNeeded(data);
    if(fix)upd(fix);
  },[data?.courses?.length]); // eslint-disable-line

  // Keeps profile's termStart/termEnd/schoolName/schoolAddress/schoolType/collegeCalendar
  // mirrored to whichever term is currently active — every existing consumer of those fields
  // (the planner, getTermRange, isFin/isHol, WeekGrid) keeps working unchanged, now always
  // reflecting the active term instead of being hand-edited directly.
  useEffect(()=>{
    if(!data)return;
    const patch=syncActiveTermToProfilePatch(data);
    if(patch)updP(patch);
  },[JSON.stringify(data?.terms),JSON.stringify(data?.schools)]); // eslint-disable-line

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
    // End-of-plan is anchored on the last real deadline, not the term-end date the student typed
    // (see lib/planningRange.js) — a mis-typed term-end can't stretch a pointless empty tail or
    // hide real deadlines.
    const termRange=planningRange(data);
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
        setPlanDrawerOpen(true); // surface the shortfall in the Plan status drawer, not just a fleeting toast
      }
      // Nudge if the typed term-end doesn't match the real last deadline — planning is fine either
      // way (anchored on the deadline), but Finals Week / holidays / term status still use the date.
      const w=termRange.termEndWarning;
      if(w)toast2(`Planned through your last deadline (${w.lastDeadline}). Your term end is set ${w.gapDays} day${w.gapDays!==1?"s":""} ${w.direction} that — fix it in School Info if it's wrong.`,true);
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
      setPlanDrawerOpen(true); // surface the shortfall in the Plan status drawer
    }
  }

  useEffect(()=>{
    fetch("/api/health").then(r=>r.json()).then(j=>setApi(j.hasApiKey)).catch(()=>setApi(false));
  },[]);

  // Daily browser-notification reminder for due dates / exam prep — fires at most once per day
  useEffect(()=>{
    if(!data||!data.onboarded)return;
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
  },[data?.onboarded]);

  // Render gates — placed after every hook so hook count/order stays identical across renders,
  // per the rules of hooks. Order: still checking the session → nothing; signed out → Login;
  // signed in but this user's row still loading → nothing.
  if(session===undefined)return null;
  if(!session)return <Login/>;
  if(!data)return null;

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
            <button className="tt" data-tt={`Sign out (${session.user?.email||""})`} onClick={()=>supabase.auth.signOut()}
              style={{width:28,height:28,borderRadius:"50%",border:"1px solid var(--b1)",background:"var(--card2)",
                color:"var(--t2)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0,flexShrink:0}}>
              <i className="ti ti-logout" style={{fontSize:15}}/>
            </button>
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
          :tab==="today"   ?<Today    data={data} upd={upd} ai={ai} busy={busy} toast2={toast2} refreshQuarterPlan={refreshQuarterPlan} planning={planning} setTab={setTab}/>
          :tab==="week"    ?<Week     data={data} upd={upd} ai={ai} busy={busy} planning={planning} toast2={toast2} refreshQuarterPlan={refreshQuarterPlan} refreshWeekPlan={refreshWeekPlan} planMsg={planMsg} planDrawerOpen={planDrawerOpen} setPlanDrawerOpen={setPlanDrawerOpen}/>
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
export default App;
