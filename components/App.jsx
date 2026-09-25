"use client";
import React, { useState, useEffect, useRef } from "react";
import { iso } from "@/lib/time";
import { AI } from "@/lib/api";
import { APP_VERSION, APP_BUILD_DATE, APP_BUILD_TIME } from "@/lib/version";
import { freeSlots, weekStartOf, hasCheckInWork, scheduleReminders } from "@/lib/calendar";
import { useConfirm, AccountModal, BugReportModal } from "@/components/shared";
import { planHorizon } from "@/lib/planner";
import { ADMIN_EMAILS } from "@/lib/constants";
import { submitBugReport } from "@/lib/bugReports";
import {
  ED,
  load,
  save,
  getQ,
  isHol,
  isFin,
  termScopedForPlanning,
  migrateLegacyTermIfNeeded,
  migrateTermStatusIfNeeded,
  backfillTermsInitializedIfNeeded,
  dedupeItemIdsIfNeeded,
  normalizeCourseNamesIfNeeded,
  repairTermLinkageIfNeeded,
  syncActiveTermToProfilePatch,
  pushNotification,
  markAllNotificationsRead,
  urgentItems,
} from "@/lib/data";
import { planningRange } from "@/lib/planningRange";
import { supabase } from "@/lib/supabase";
import { Today } from "@/components/Today";
import { Week } from "@/components/Week";
import { Acad } from "@/components/Acad";
import { Onboard } from "@/components/Onboard";
import { SchoolInfo } from "@/components/SchoolInfo";
import { Help } from "@/components/Help";
import { Sett } from "@/components/Sett";
import { Prog } from "@/components/Prog";
import { Login } from "@/components/Login";
import { BugReports } from "@/components/BugReports";
console.log(`StudyOS v${APP_VERSION} (built ${APP_BUILD_DATE} ${APP_BUILD_TIME}) loaded`);
// Short relative-time label for the notification panel ("Just now", "5m ago", "3h ago", "2d ago")
// — falls back to a real date once it's more than a week old.
function timeAgo(iso){
  const mins=Math.floor((Date.now()-new Date(iso).getTime())/60000);
  if(mins<1)return"Just now";
  if(mins<60)return`${mins}m ago`;
  const hrs=Math.floor(mins/60);
  if(hrs<24)return`${hrs}h ago`;
  const days=Math.floor(hrs/24);
  if(days<7)return`${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US",{month:"short",day:"numeric"});
}
// ── Reminders ─────────────────────────────────────────────────────────────
// urgentItems() now lives in lib/data/notifications.js — shared with the server-side cron
// (app/api/cron/notify-urgent-items) that populates the bell log even when the computer itself
// was asleep/closed at the time, so the two never define "urgent" two different ways.

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

// URL <-> top-level tab mapping — so the browser's address bar, back/forward, and bookmarks all
// reflect which tab is open (e.g. www.studyos.io/courses), while the app underneath stays exactly
// the single-page client state machine it already was (tab id, not the route, is still what every
// `tab==="..."` check in this file reads). Plain browser APIs (history.pushState/popstate), not
// next/navigation's router hooks — matches how this app already reads the ?invite= query param
// (components/Login.jsx, via window.location.search directly) rather than introducing a second
// URL-handling convention. Slugs are the human-readable, user-facing version of each tab's
// internal id (which stays as-is everywhere else — "acad"/"week"/"settings" etc. — to avoid
// touching the many tab==="..." checks throughout this file for a purely cosmetic URL change).
// The catch-all route (app/[...slug]/page.jsx) is what makes a fresh load of /courses (not just a
// same-session navigation) resolve to this same app instead of 404ing — see that file's comment.
const TAB_SLUGS={today:"today",week:"calendar",acad:"courses",prog:"progress",school:"school-info",help:"help",settings:"preferences",bugs:"bug-reports"};
const SLUG_TO_TAB=Object.fromEntries(Object.entries(TAB_SLUGS).map(([id,slug])=>[slug,id]));
function tabFromLocation(){
  if(typeof window==="undefined")return "today";
  const slug=window.location.pathname.replace(/^\/+|\/+$/g,"").split("/")[0];
  return SLUG_TO_TAB[slug]||"today";
}

function App(){
  // Auth session: undefined = still checking on mount, null = signed out, object = signed in.
  // load()/save() (lib/data/store.js) key off the Supabase session themselves, so `data` is only
  // ever populated while signed in — see the load effect and the render gates further down.
  const [session,setSession]=useState(undefined);
  // True after the user follows a password-reset link — App shows <Login recoveryMode> so they can
  // set a new password, even though Supabase has already established a (recovery) session.
  const [recovery,setRecovery]=useState(false);
  useEffect(()=>{
    supabase.auth.getSession().then(({data})=>setSession(data.session));
    const {data:{subscription}}=supabase.auth.onAuthStateChange((evt,s)=>{
      if(evt==="PASSWORD_RECOVERY")setRecovery(true);
      setSession(s);
    });
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
  const [tab,setTab]=useState(tabFromLocation);
  // Keeps the address bar in sync with `tab` — both directions. go() below pushes a new URL on
  // every deliberate navigation; this effect handles the OTHER direction, the browser's own
  // back/forward buttons (a popstate event fires then, not a normal render), which otherwise
  // wouldn't update `tab` at all despite the URL having changed underneath it.
  useEffect(()=>{
    function onPopState(){setTab(tabFromLocation());}
    window.addEventListener("popstate",onPopState);
    return ()=>window.removeEventListener("popstate",onPopState);
  },[]);
  // Tracks "arrived at Progress via the Today check-in shortcut" so Progress can offer an easy
  // way straight back — cleared on any NORMAL tab navigation (go()) so it only ever shows right
  // after that specific shortcut, never lingers once the user's navigated elsewhere on purpose.
  const [progBackTo,setProgBackTo]=useState(null);
  function go(id){
    setProgBackTo(null);
    setTab(id);
    const path="/"+(TAB_SLUGS[id]||id);
    if(window.location.pathname!==path)window.history.pushState({},"",path);
  }
  function goCheckIn(){setProgBackTo("today");setTab("prog");window.history.pushState({},"","/"+TAB_SLUGS.prog);}
  // Help tab (components/Help.jsx) — helpJump is the deep-link a "Take me there" click sends down
  // to whichever tab component owns the target sub-section (Sett.jsx's `sec`, Acad.jsx's `view`),
  // each filtering on helpJump.tab being its own id. `token` (not sec itself) is what their
  // effects key off, so clicking the same link twice in a row still re-applies even though the
  // target value didn't change. No separate open/close state anymore — Help is a normal tab now
  // (`tab==="help"`), not a drawer, so jumping away from it is just go() like any other tab
  // navigation.
  const [helpJump,setHelpJump]=useState(null);
  function jumpTo(tabId,sec){
    setHelpJump({tab:tabId,sec,token:Date.now()});
    go(tabId);
  }
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
  const [showBugReport,setShowBugReport]=useState(false);
  const [showNotifPanel,setShowNotifPanel]=useState(false);
  const [showMobileMenu,setShowMobileMenu]=useState(false); // hamburger dropdown, mobile-only (<768px)
  // App is the root component and never unmounts — the render gates below just swap in <Login/>.
  // So any modal state left open when the session ends (Sign out lives inside AccountModal itself)
  // would still be open on the next login. Force it shut whenever there's no session.
  useEffect(()=>{if(!session){setShowAccount(false);setShowBugReport(false);}},[session]);
  const [planDrawerOpen,setPlanDrawerOpen]=useState(false); // Weekly-tab Plan status drawer — lifted here so a replan can auto-open it on a shortfall

  function upd(p){setD(prev=>{const n={...prev,...p};save(n);return n;});}
  function updP(p){upd({profile:{...data.profile,...p}});}
  // Routine confirmations ("Added!", "Saved!") still auto-dismiss quickly — fine to miss, low
  // stakes. `e:true` used to mean both "persist + show ×" AND "color it red" at once — but red is
  // this app's established color for something that actually FAILED (delete buttons, overdue
  // badges), and not every persistent toast is a failure: "N items came up short" after a
  // successful replan is a heads-up needing attention, not an error, so it belongs in amber (this
  // app's established attention/warning color — missing-due-date badges, "Changes not applied
  // yet" banners) instead. The optional 3rd arg lets a call override the color without changing
  // the persist behavior; `e:true` alone still defaults to red, so every existing call site keeps
  // working exactly as before. toastTimer tracks the pending auto-dismiss so a second toast2()
  // call while one is already showing cancels the old timer instead of two racing to clear
  // whichever toast happens to be up.
  const toastTimer=useRef(null);
  function toast2(m,e,severity){
    const sev=severity||(e?"error":"success");
    if(toastTimer.current){clearTimeout(toastTimer.current);toastTimer.current=null;}
    setToast({m,sev});
    if(sev==="success")toastTimer.current=setTimeout(()=>{setToast(null);toastTimer.current=null;},3000);
  }
  async function sendBugReport(message){
    await submitBugReport({message,page:tab,appVersion:APP_VERSION});
    setShowBugReport(false);
    toast2("Thanks — bug report sent!");
  }

  // One-time legacy migration — synthesizes a school+term entry from existing profile fields the
  // first time this loads with terms[] still empty. Runs on every render but is a genuine no-op
  // once migrated (migrateLegacyTermIfNeeded returns null once terms[].length>0), so it's safe
  // without a separate version flag.
  useEffect(()=>{
    if(!data)return;
    const migration=migrateLegacyTermIfNeeded(data);
    if(migration)upd(migration);
  },[data?.terms?.length,data?.profile.schoolName,data?.profile.termName,data?.profile.termStart,data?.profile.termEnd]); // eslint-disable-line

  // One-time repair for colliding assignment/exam ids from earlier builds (see dedupeItemIdsIfNeeded).
  useEffect(()=>{
    if(!data)return;
    const fix=dedupeItemIdsIfNeeded(data);
    if(fix)upd(fix);
  },[data?.assignments?.length,data?.exams?.length]); // eslint-disable-line

  // Seed profile name / phone from what was collected at sign-up (stored in the Supabase user's
  // metadata) the first time this account's data loads without them.
  useEffect(()=>{
    if(!data)return;
    const m=session?.user?.user_metadata||{};
    const patch={};
    if(!data.profile.name&&m.full_name)patch.name=m.full_name;
    if(!data.profile.phone&&m.phone)patch.phone=m.phone;
    if(Object.keys(patch).length)updP(patch);
  },[data?.profile?.name,data?.profile?.phone,session?.user?.id]); // eslint-disable-line

  // Collapse full AI course titles to canonical codes ("MATH 180A") so every account renders identically.
  useEffect(()=>{
    if(!data)return;
    const fix=normalizeCourseNamesIfNeeded(data);
    if(fix)upd(fix);
  },[data?.courses?.length]); // eslint-disable-line

  // Heal a broken term/course linkage (dateless term, or courses not linked to it) — otherwise the
  // planner scopes to nothing and the plan comes out empty. See repairTermLinkageIfNeeded.
  useEffect(()=>{
    if(!data)return;
    const fix=repairTermLinkageIfNeeded(data);
    if(fix)upd(fix);
  },[data?.terms?.length,data?.courses?.length,data?.profile?.termStart,data?.profile?.termEnd]); // eslint-disable-line

  // One-time backfill for accounts that already had terms before status became a stored, manually-
  // set field — see migrateTermStatusIfNeeded. Real request: "add a field to manage the term
  // states: Current, Upcoming, Archive."
  useEffect(()=>{
    if(!data)return;
    const fix=migrateTermStatusIfNeeded(data);
    if(fix)upd(fix);
  },[data?.terms?.length]); // eslint-disable-line

  // One-time backfill for accounts whose first term was created before `termsInitialized` existed
  // as a marker — see the guard atop migrateLegacyTermIfNeeded (real, shipped bug: "I deleted all
  // terms, and still showing term" — a deleted term got resynthesized from stale profile fields).
  // Without this, any account that already has a term but predates the fix is still one deletion
  // away from the same resurrection.
  useEffect(()=>{
    if(!data)return;
    const fix=backfillTermsInitializedIfNeeded(data);
    if(fix)upd(fix);
  },[data?.terms?.length,data?.termsInitialized]); // eslint-disable-line

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
            profileHash:JSON.stringify({wake:data.profile.wakeTime,sleep:data.profile.sleepTime,focus:data.profile.focusMins,brk:data.profile.breakMins,peak:data.profile.energyPeakTime}),
          },
          days,
        };
      });

      upd({
        quarterPlan:{tasksByDate,generatedAt:iso(),generatedThrough:allDates[allDates.length-1],datesPlanned:allDates.length,version:APP_VERSION,lastError:null},
        studyPlan:{weeks:newWeeks},
        briefCache:null,briefPeriod:null,planStale:false,
      });

      // Summary message — completion is never silent. Names any shortfall with exact hours, per
      // the agreed "plan shall not miss completion" rule, instead of a generic "done!" toast that
      // hides a real shortage. Structured (title/lines/footer), not one run-on sentence — one item
      // per line actually reads at a glance instead of needing to be parsed out of a paragraph.
      // Amber, not red: the replan itself succeeded — this is "needs your attention", not a
      // failure, and red is reserved for things that actually failed elsewhere in the app.
      // Explicitly calls out currently-prioritised (forced) items by name in BOTH outcomes —
      // "did the item I just prioritised actually get filled" is the one thing a generic top-N
      // shortfall summary never answered on its own.
      const totalBlocks=Object.values(placedByDate).reduce((s,b)=>s+b.length,0);
      const forcedItems=result.summaryItems.filter(it=>it.forced);
      // Nudge if the typed term-end doesn't match the real last deadline — planning is fine either
      // way (anchored on the deadline), but Finals Week / holidays / term status still use the date.
      // Folded into whichever toast fires below, never its own separate toast2() call: toast2()
      // only ever holds ONE toast (see its own comment above), so firing this as a second call
      // right after the real result toast used to silently replace it — not add to it — the
      // instant both ran in the same tick, so the student never actually saw the "re-planned
      // successfully" confirmation, only this date nudge, styled as a persistent red error with no
      // sign the plan (which had, in fact, already saved) had completed at all. Real, confirmed
      // report from exactly this shape of case: "when I clicked save, it did not save" — it always
      // had; only the confirmation was ever shown to say so.
      const w=termRange.termEndWarning;
      const termEndNote=w?`Term end is set ${w.gapDays} day${w.gapDays!==1?"s":""} ${w.direction} your last deadline (${w.lastDeadline}) — planning is fine either way, it's anchored on the deadline — double check School Info if that gap isn't intentional.`:null;
      if(result.shortfalls.length===0){
        const msg=forcedItems.length
          ?`Re-planned ${allDates.length} days through ${termRange.end} — ${totalBlocks} blocks scheduled. ⭐ ${forcedItems.length===1?`"${forcedItems[0].title}" is`:`All ${forcedItems.length} prioritised items are`} fully scheduled. 🎯`
          :`Re-planned ${allDates.length} days through ${termRange.end} — ${totalBlocks} blocks scheduled. Everything fits! 🎯`;
        if(termEndNote)toast2({title:msg,sub:termEndNote},true,"warning");
        else toast2(msg);
      }else{
        const forcedShort=result.shortfalls.filter(it=>it.forced);
        const otherShort=result.shortfalls.filter(it=>!it.forced);
        const lines=[
          ...forcedShort.slice(0,4).map(it=>`⭐ ${it.title} — still short: ${it.plannedHours}h of ${it.desiredHours}h`),
          ...otherShort.slice(0,Math.max(0,6-forcedShort.length)).map(it=>`${it.title} — ${it.plannedHours}h of ${it.desiredHours}h`),
        ];
        toast2({
          title:forcedShort.length
            ?`${forcedShort.length} prioritised item${forcedShort.length!==1?"s":""} still short`
            :`${result.shortfalls.length} item${result.shortfalls.length!==1?"s":""} came up short`,
          sub:[`Re-planned ${allDates.length} days through ${termRange.end}.`,
            forcedShort.length&&otherShort.length?`+${otherShort.length} other item${otherShort.length!==1?"s":""} also short.`:null,
          ].filter(Boolean).join(" "),
          lines,
          footer:[
            result.shortfalls.length>lines.length?`+${result.shortfalls.length-lines.length} more. `:"",
            "Check Courses → Study Preferences.",
            termEndNote,
          ].filter(Boolean).join(" "),
        },true,"warning");
        setPlanDrawerOpen(true); // surface the shortfall in the Plan status drawer, not just a fleeting toast
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
        profileHash:JSON.stringify({wake:data.profile.wakeTime,sleep:data.profile.sleepTime,focus:data.profile.focusMins,brk:data.profile.breakMins,peak:data.profile.energyPeakTime}),
      },
      days,
    };
    upd({studyPlan:{weeks:{...(data.studyPlan?.weeks||{}),[weekStart]:newWeek}},planStale:false});
    // Same forced-item callout as refreshQuarterPlan — see its comment for why.
    const forcedItemsWk=(result.summaryItems||[]).filter(it=>it.forced);
    if(result.shortfalls.length===0){
      toast2(forcedItemsWk.length
        ?`Week updated — ⭐ ${forcedItemsWk.length===1?`"${forcedItemsWk[0].title}" is`:`All ${forcedItemsWk.length} prioritised items are`} fully scheduled. 🎯`
        :"Week updated — everything fits!");
    }else{
      const forcedShortWk=result.shortfalls.filter(it=>it.forced);
      const otherShortWk=result.shortfalls.filter(it=>!it.forced);
      const linesWk=[
        ...forcedShortWk.slice(0,4).map(it=>`⭐ ${it.title} — still short: ${it.plannedHours}h of ${it.desiredHours}h`),
        ...otherShortWk.slice(0,Math.max(0,6-forcedShortWk.length)).map(it=>`${it.title} — ${it.plannedHours}h of ${it.desiredHours}h`),
      ];
      toast2({
        title:forcedShortWk.length
          ?`${forcedShortWk.length} prioritised item${forcedShortWk.length!==1?"s":""} still short`
          :`${result.shortfalls.length} item${result.shortfalls.length!==1?"s":""} came up short`,
        sub:["Week updated.",
          forcedShortWk.length&&otherShortWk.length?`+${otherShortWk.length} other item${otherShortWk.length!==1?"s":""} also short.`:null,
        ].filter(Boolean).join(" "),
        lines:linesWk,
        footer:`${result.shortfalls.length>linesWk.length?`+${result.shortfalls.length-linesWk.length} more. `:""}Check Courses → Study Preferences.`,
      },true,"warning");
      setPlanDrawerOpen(true); // surface the shortfall in the Plan status drawer
    }
  }

  useEffect(()=>{
    fetch("/api/health").then(r=>r.json()).then(j=>setApi(j.hasApiKey)).catch(()=>setApi(false));
  },[]);

  // Daily browser-notification reminder for due dates / exam prep — fires at most once per day
  useEffect(()=>{
    if(!data||!data.onboarded)return;
    if(data.profile.browserNotifsEnabled===false||data.profile.notifyBrowserPriorities===false)return;
    if(typeof Notification==="undefined"||Notification.permission!=="granted")return;
    const key="studyos_notified_"+iso();
    if(localStorage.getItem(key))return;
    const items=urgentItems(data);
    if(items.length){
      const title="StudyOS — today's priorities",body=items.slice(0,3).join("\n");
      try{
        new Notification(title,{body});
        localStorage.setItem(key,"1");
      }catch{}
      pushNotification(data,upd,{title,body,priority:"high"}); // logged regardless of whether the OS Notification itself succeeded — the in-app bell is the reliable fallback
    }
  },[data?.onboarded]);

  // Schedule-driven study/break reminders — fires at the PLANNED clock time of each of today's
  // real study/homework/project sessions, independent of whether the user has ever clicked Play
  // on Today's Focus Time timer (that timer is still there as a separate, self-contained active-
  // session tool — this is the passive "it's time" nudge the click-to-start flow can't provide by
  // itself). Real reported gap this fixes: notifications only fired for a session the student had
  // already manually started; StudyOS never proactively said "10:00 MATH 180A — start studying."
  // Refs (not the effect's own dependency array) keep the ticking interval's closure on the
  // LATEST data/upd without tearing down and losing notifiedRef's per-block/day dedupe on every
  // unrelated data change — the effect itself only needs to (re)start once onboarding completes.
  const dataRef=useRef(data); dataRef.current=data;
  const updRef=useRef(upd); updRef.current=upd;
  const notifiedRef=useRef(new Set()); // "date|blockId|phase" keys already fired this session
  useEffect(()=>{
    if(!data?.onboarded)return;
    function check(){
      const d=dataRef.current,u=updRef.current;
      if(!d)return;
      const today=iso();
      // scheduleReminders' key is "<blockId>|start"/"|break"/"|done" (lib/calendar/weeks.js) —
      // "start" is the session-start nudge, "break"/"done" are both break start/end, so they share
      // notifyBrowserBreaks (the same toggle Today.jsx's own Focus Timer break chime now checks,
      // so "turn off break reminders" covers both mechanisms that can produce one).
      if(d.profile?.browserNotifsEnabled===false)return;
      scheduleReminders(d).forEach(({key,title,body})=>{
        const kind=key.split("|")[1];
        const enabled=kind==="start"?d.profile?.notifyBrowserSessions!==false:d.profile?.notifyBrowserBreaks!==false;
        if(!enabled)return;
        const fullKey=`${today}|${key}`;
        if(notifiedRef.current.has(fullKey))return;
        notifiedRef.current.add(fullKey);
        try{if(typeof Notification!=="undefined"&&Notification.permission==="granted")new Notification(title,{body});}catch{}
        pushNotification(d,u,{title,body});
      });
    }
    check();
    const t=setInterval(check,30*1000);
    return()=>clearInterval(t);
  },[data?.onboarded]); // eslint-disable-line

  // Evening "report complete" nudge — a small amber badge in the top bar from 8pm onward,
  // ONLY when there's actually something to report (hasCheckInWork) and today's check-in hasn't
  // been submitted yet. The × hides it from view but does NOT stop the nudge: `nudgeSnoozedUntil`
  // just delays the next re-show by 30 minutes — the badge keeps coming back on that cadence
  // until the real condition (today's dailyLogs entry existing) clears it, never from the × alone.
  // `nowTick` exists purely so this re-evaluates over time without any user interaction — a plain
  // derived boolean computed once at mount would never notice 8pm arriving or 30 minutes passing.
  const [nudgeSnoozedUntil,setNudgeSnoozedUntil]=useState(null);
  const [nowTick,setNowTick]=useState(()=>Date.now());
  useEffect(()=>{
    const t=setInterval(()=>setNowTick(Date.now()),60*1000);
    return()=>clearInterval(t);
  },[]);

  // Render gates — placed after every hook so hook count/order stays identical across renders,
  // per the rules of hooks. Order: still checking the session → nothing; signed out → Login;
  // signed in but this user's row still loading → nothing.
  if(recovery)return <Login recoveryMode onDone={()=>setRecovery(false)}/>;
  if(session===undefined)return null;
  if(!session)return <Login/>;
  if(!data)return null;

  const p=data.profile,q=getQ(p),td=iso(),fin=isFin(td,p),hol=isHol(td,p);
  const missing=data.assignments.filter(a=>!a.dueDate&&a.status!=="done").length;
  const checkedInToday=(data.dailyLogs||[]).some(l=>l.date===td);
  const notifLog=data.notifications||[];
  const unreadCount=notifLog.filter(n=>!n.read).length;
  const nudgeEligible=data.onboarded&&new Date(nowTick).getHours()>=20&&!checkedInToday&&hasCheckInWork(data);
  const nudgeShown=nudgeEligible&&(!nudgeSnoozedUntil||nowTick>=nudgeSnoozedUntil);

  const isAdmin=ADMIN_EMAILS.includes(session.user?.email);
  const TABS=data.onboarded?[
    {id:"today",   icon:"ti-sun",          label:"Today"},
    {id:"week",    icon:"ti-calendar-week",label:"Calendar"},
    {id:"acad",    icon:"ti-school",       label:"Courses"},
    {id:"prog",    icon:"ti-chart-bar",    label:"Progress"},
    {id:"school",  icon:"ti-building",     label:"School Info"},
    {id:"help",    icon:"ti-help",         label:"Help"},
    {id:"settings",icon:"ti-settings",    label:"Preferences"},
    ...(isAdmin?[{id:"bugs",icon:"ti-bug",label:"Bug Reports"}]:[]),
  ]:[];

  return(
    <div style={{fontFamily:"'Inter',sans-serif",minHeight:"100vh",background:"var(--bg)",color:"var(--t1)"}}>
      {/* FIXED HEADER — top bar + nav never scroll, only the content below does */}
      <div style={{position:"fixed",top:0,left:0,right:0,zIndex:100}}>
        {/* TOP BAR */}
        <div className="topbar-row">
          {/* Hamburger — mobile-only (<768px, see .mobile-menu-btn in globals.css), replaces the
              icon-row nav entirely on narrow screens instead of squeezing it down further. The
              standard "square with a few lines" mobile menu icon, opening a dropdown with full
              tab labels — more recognizable than the cramped icon+tiny-label row it replaces, and
              it also gives back the vertical space that row used to take. */}
          {data.onboarded&&(
            <div style={{position:"relative"}}>
              <button className="mobile-menu-btn icon-btn-28" onClick={()=>setShowMobileMenu(v=>!v)}
                style={{borderRadius:8,border:"1px solid var(--b1)",background:showMobileMenu?"var(--card2)":"transparent",
                  color:"var(--t1)",cursor:"pointer",alignItems:"center",justifyContent:"center",padding:0,flexShrink:0}}>
                <i className="ti ti-menu-2" style={{fontSize:18}}/>
              </button>
              {showMobileMenu&&(
                <>
                  {/* Click-outside-to-close — same invisible full-screen catcher pattern already
                      used for Today's health-dot popover. Sits at a lower z-index than the
                      dropdown itself so clicks ON the dropdown still work normally; catches
                      everything else. Without this the menu only ever closed via picking an
                      option, never by clicking away — the reported bug. */}
                  <div onClick={()=>setShowMobileMenu(false)} style={{position:"fixed",inset:0,zIndex:199}}/>
                  <div style={{position:"absolute",top:"120%",left:0,zIndex:200,minWidth:200,
                    background:"var(--card)",border:"1px solid var(--b1)",borderRadius:10,
                    boxShadow:"0 12px 30px rgba(0,0,0,0.4)",padding:6}}>
                    {TABS.map(t=>(
                      <button key={t.id} onClick={()=>{go(t.id);setShowMobileMenu(false);}}
                        style={{display:"flex",alignItems:"center",gap:10,width:"100%",textAlign:"left",
                          padding:"11px 12px",borderRadius:7,border:"none",fontFamily:"inherit",fontSize:14,
                          background:tab===t.id?"var(--amber-bg)":"transparent",
                          color:tab===t.id?"var(--amber)":"var(--t1)",cursor:"pointer"}}>
                        <i className={`ti ${t.icon}`} style={{fontSize:16,width:18,textAlign:"center"}}/>
                        {t.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          <span style={{fontFamily:"'Syne',sans-serif",fontSize:18,fontWeight:700,letterSpacing:"0.01em",background:"linear-gradient(120deg,var(--blue),var(--teal))",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",flexShrink:0}}>STUDYOS</span>
          <span style={{fontSize:9.5,fontWeight:700,color:"var(--t3)",letterSpacing:"0.06em",marginLeft:5,flexShrink:0}}>BETA</span>
          {data.onboarded&&p.name&&<span className="topbar-greet" style={{fontSize:13,color:"var(--t2)"}}>Hey {p.name}</span>}
          {q&&<span className="badge badge-blue topbar-term">{q.name}{fin&&" · Finals"}{hol&&" · Holiday"}</span>}
          {missing>0&&<span className="badge badge-amber topbar-missing" style={{cursor:"pointer"}} onClick={()=>go("acad")}>⚠ {missing} missing due date{missing>1?"s":""}</span>}
          {/* The "click to report complete" text + × only appear once the nudge is actually
              active — the icon itself (below, in the right-hand icon group) is always there. */}
          {nudgeShown&&(
            <span className="badge badge-amber topbar-missing" style={{cursor:"pointer",display:"inline-flex",alignItems:"center",gap:6}} onClick={()=>go("prog")}>
              Click to report complete
              <i className="ti ti-x" style={{fontSize:12,opacity:0.8}} onClick={e=>{e.stopPropagation();setNudgeSnoozedUntil(Date.now()+30*60*1000);}}/>
            </span>
          )}
          <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:10}}>
            {api!==null&&<span className={`badge ${api?"badge-green":"badge-red"} topbar-api`}>{api?"✓ Connected":"✗ No API key"}</span>}
            <span className="tt topbar-version" data-tt={`Built ${APP_BUILD_DATE} ${APP_BUILD_TIME}`} style={{fontSize:11,color:"var(--t3)",flexShrink:0,cursor:"default"}}>
              v{APP_VERSION}
            </span>
            {/* Notification log — the real alerts StudyOS has sent (daily priorities, Focus
                Time break/study signals), not routine toasts. Opening the panel marks every
                currently-listed entry read in one pass (markAllNotificationsRead), matching how
                most notification bells behave — no per-item click needed. */}
            {data.onboarded&&(
              <div style={{position:"relative"}}>
                <button className="tt tt-below tt-right icon-btn-28" data-tt="Notifications" onClick={()=>{
                  const opening=!showNotifPanel;
                  setShowNotifPanel(v=>!v);
                  if(opening)markAllNotificationsRead(data,upd);
                }}
                  style={{borderRadius:"50%",border:"1px solid var(--b1)",background:"var(--card2)",
                    color:"var(--t2)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0,flexShrink:0,position:"relative"}}>
                  <i className="ti ti-bell" style={{fontSize:15}}/>
                  {unreadCount>0&&(
                    <span style={{position:"absolute",top:-2,right:-2,minWidth:14,height:14,borderRadius:7,
                      background:"var(--red)",color:"#fff",fontSize:9,fontWeight:700,lineHeight:"14px",
                      textAlign:"center",padding:"0 3px",border:"1.5px solid var(--bg)"}}>
                      {unreadCount>9?"9+":unreadCount}
                    </span>
                  )}
                </button>
                {showNotifPanel&&(
                  <>
                    <div onClick={()=>setShowNotifPanel(false)} style={{position:"fixed",inset:0,zIndex:199}}/>
                    <div style={{position:"absolute",top:"120%",right:0,zIndex:200,width:320,maxHeight:400,overflowY:"auto",
                      background:"var(--card)",border:"1px solid var(--b1)",borderRadius:10,boxShadow:"0 12px 30px rgba(0,0,0,0.4)"}}>
                      <div style={{padding:"11px 14px",borderBottom:"1px solid var(--b1)",fontSize:13,fontWeight:600,color:"var(--t1)"}}>Notifications</div>
                      {notifLog.length===0?(
                        <div style={{padding:"20px 14px",textAlign:"center",fontSize:13,color:"var(--t3)"}}>No notifications yet</div>
                      ):notifLog.map(n=>(
                        // High-priority = an upcoming exam (≤5 days) or assignment due (≤2 days) —
                        // see urgentItems()/priority:"high" above. Amber background, white body
                        // text (not amber-on-amber — same tinted-bg readability fix used
                        // everywhere else in this app), amber only on the title as the color cue.
                        <div key={n.id} style={{padding:"10px 14px",borderBottom:"1px solid var(--b1)",
                          background:n.priority==="high"?"var(--amber-bg)":undefined}}>
                          <div style={{fontSize:13,fontWeight:600,color:n.priority==="high"?"var(--amber)":"var(--t1)",marginBottom:2}}>{n.title}</div>
                          <div style={{fontSize:12,color:n.priority==="high"?"#fff":"var(--t2)",whiteSpace:"pre-wrap",marginBottom:4}}>{n.body}</div>
                          <div style={{fontSize:11,color:"var(--t3)"}}>{timeAgo(n.createdAt)}</div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            {/* The "?" icon that used to live here now points at a real nav tab (Help,
                components/Help.jsx) instead of a drawer — see TABS below. */}
            {/* Real reported duplication: this used to be a second "Evening check-in" checkbox
                icon, always present on every tab — Today.jsx already has its own (amber, only
                shown once there's actually unchecked-off work), so the header one was pure
                redundancy rather than a different affordance. The "click to report complete" text
                badge above still covers the header-level nudge; the icon itself is gone. */}
            {data.onboarded&&(
              <button className="tt tt-below tt-right icon-btn-28" data-tt="Report a bug" onClick={()=>setShowBugReport(true)}
                style={{borderRadius:"50%",border:"1px solid var(--b1)",background:"var(--card2)",
                  color:"var(--t2)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0,flexShrink:0}}>
                <i className="ti ti-bug" style={{fontSize:15}}/>
              </button>
            )}
            {/* Account button is the only way to sign out — same icon-btn-28 touch-target bump as
                Today's Focus Time buttons applies here too. */}
            <button className="tt tt-below tt-right icon-btn-28" data-tt="Account &amp; sign out" onClick={()=>setShowAccount(true)}
              style={{borderRadius:"50%",border:"1px solid var(--b1)",background:"var(--card2)",
                color:"var(--t2)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0,flexShrink:0}}>
              <i className="ti ti-user-circle" style={{fontSize:16}}/>
            </button>
          </div>
        </div>
        {/* NAV — Sub-project: Web-Mobile Enablement item #3 made this scrollable instead of
            clipped once the 8 tabs didn't fit a narrow screen. Below 768px this whole row is
            replaced by the hamburger dropdown above (see .nav-row in globals.css) rather than
            squeezed further — desktop (≥768px) is unaffected. */}
        {data.onboarded&&(
          <div className="nav-row">
            {TABS.map(t=>(
              <button key={t.id} className="nav-tab-btn" onClick={()=>go(t.id)}
                style={{color:tab===t.id?"var(--amber)":"var(--t3)",borderBottom:tab===t.id?"2px solid var(--amber)":"2px solid transparent"}}>
                <i className={`ti ${t.icon}`} style={{fontSize:14}}/>{t.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {/* Spacer — reserves the space the fixed header would otherwise occupy, since fixed
          elements are removed from normal flow. .header-spacer-nav shrinks to just the top bar's
          height below 768px, matching .nav-row's display:none there — otherwise a dead gap of
          empty space would sit where the nav row used to be. */}
      <div className={data.onboarded?"header-spacer-nav":undefined} style={data.onboarded?undefined:{height:50}}/>
      {/* MAIN */}
      <div style={{maxWidth:tab==="week"?"100%":960,margin:"0 auto",padding:tab==="week"?"10px 14px":"20px 16px"}}>
        {!data.onboarded
          ?<Onboard data={data} upd={upd} updP={updP} ai={ai} busy={busy} toast2={toast2} setTab={setTab} setProgress={setProgress}/>
          :tab==="today"   ?<Today    data={data} upd={upd} ai={ai} busy={busy} toast2={toast2} refreshQuarterPlan={refreshQuarterPlan} planning={planning} setTab={setTab} onCheckIn={goCheckIn}/>
          :tab==="week"    ?<Week     data={data} upd={upd} ai={ai} busy={busy} planning={planning} toast2={toast2} refreshQuarterPlan={refreshQuarterPlan} refreshWeekPlan={refreshWeekPlan} planMsg={planMsg} planDrawerOpen={planDrawerOpen} setPlanDrawerOpen={setPlanDrawerOpen}/>
          :tab==="acad"    ?<Acad     data={data} upd={upd} ai={ai} busy={busy} planning={planning} toast2={toast2} progress={progress} setProgress={setProgress} refreshQuarterPlan={refreshQuarterPlan} planMsg={planMsg} helpJump={helpJump}/>
          :tab==="prog"    ?<Prog     data={data} upd={upd} toast2={toast2} ai={ai} busy={busy} backTo={progBackTo} onBack={()=>go("today")}/>
          :tab==="school"  ?<SchoolInfo data={data} upd={upd} updP={updP} toast2={toast2}/>
          :tab==="help"    ?<Help data={data} updP={updP} onJump={jumpTo}/>
          :tab==="bugs"    ?(isAdmin?<BugReports toast2={toast2}/>:null)
          :<Sett data={data} upd={upd} updP={updP} toast2={toast2} ai={ai} busy={busy} planning={planning} refreshQuarterPlan={refreshQuarterPlan} planMsg={planMsg} helpJump={helpJump}/>
        }
      </div>
      {toast&&(()=>{
        // Background stays severity-tinted (dark red/amber card, same as .card-critical/.card-warn
        // elsewhere), but the TEXT is near-white (--t1) rather than the severity color itself —
        // amber-on-amber-tinted-dark read poorly (real reported bug: "display text in amber over
        // dark background - look bad"). Severity is still legible at a glance via a colored left
        // accent bar, same pattern .card-warn/.card-critical already use for the same reason.
        // Explicit #fff (not var(--t1)) for error/warning specifically — real reported bug:
        // near-white text over the dark-red/amber tint still read as low-contrast/reddish at a
        // glance. Pure white against these dark, low-saturation tints leaves no ambiguity.
        const palette={error:{bg:"var(--red-bg)",accent:"var(--red)"},warning:{bg:"var(--amber-bg)",accent:"var(--amber)"},success:{bg:"var(--card2)",accent:null}};
        const{bg,accent}=palette[toast.sev]||palette.success;
        const fg=toast.sev==="success"?"var(--t2)":"#fff";
        const structured=typeof toast.m==="object";
        return(
          <div className="toast" style={{background:bg,color:fg,borderLeft:accent?`3px solid ${accent}`:undefined}}>
            {/* Top row: content (title+lines, or a plain string) on the left, × pinned to the
                top-right corner of the box via alignItems:flex-start on this row — not inline at
                the end of a single line of text, which is where it sat before. Only persistent
                (non-success) toasts get it; routine ones just fade on their own. */}
            <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
              <div style={{flex:1,minWidth:0}}>
                {structured?(
                  <>
                    <div style={{fontWeight:700,fontSize:14}}>{toast.m.title}</div>
                    {toast.m.sub&&<div style={{fontSize:12,opacity:0.85,marginTop:2}}>{toast.m.sub}</div>}
                  </>
                ):<span>{toast.m}</span>}
              </div>
              {toast.sev!=="success"&&(
                <button onClick={()=>setToast(null)} aria-label="Dismiss"
                  style={{background:"transparent",border:"none",color:"inherit",cursor:"pointer",padding:2,display:"flex",flexShrink:0}}>
                  <i className="ti ti-x" style={{fontSize:15}}/>
                </button>
              )}
            </div>
            {/* Structured body: one line per item, real bullets (not run together in a sentence) —
                a filled dot reads more clearly as a list marker than the earlier middle-dot did,
                now that it's not fighting amber-on-amber contrast either. */}
            {structured&&toast.m.lines?.length>0&&(
              <ul style={{margin:"8px 0 0",padding:0,listStyle:"none",display:"flex",flexDirection:"column",gap:5}}>
                {toast.m.lines.map((l,i)=>(
                  <li key={i} style={{fontSize:13,paddingLeft:14,position:"relative"}}>
                    <span style={{position:"absolute",left:0,color:accent||"inherit"}}>•</span>{l}
                  </li>
                ))}
              </ul>
            )}
            {structured&&toast.m.footer&&(
              <div style={{fontSize:12,opacity:0.85,marginTop:8}}>{toast.m.footer}</div>
            )}
          </div>
        );
      })()}
      {modalApp}
      {/* Always mounted once onboarded (not just while showAccount is true) so the SideDrawer's
          open/close actually animates — see the note atop AccountModal's own definition for what
          that costs and how it's handled (draft/subform state now resets explicitly, keyed on
          `open`, instead of getting it for free from unmounting). */}
      {data.onboarded&&<AccountModal open={showAccount} data={data} updP={updP} toast2={toast2} onClose={()=>setShowAccount(false)}
        onSignOut={()=>supabase.auth.signOut()} onReset={()=>upd({...ED})} userEmail={session.user?.email}/>}
      {showBugReport&&<BugReportModal onSubmit={sendBugReport} onCancel={()=>setShowBugReport(false)}/>}
    </div>
  );
}
export default App;
