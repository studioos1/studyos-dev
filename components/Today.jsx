import { useState, useEffect, useRef, Fragment } from "react";
import { iso, du, m2t, t2m, f12, fmtDur, briefPeriodStart } from "@/lib/time";
import { sparkleBurst } from "@/lib/sparkle";
import { notifyPhase } from "@/lib/notify";
import { termScopedForPlanning, getQ, isFin, isHol, GYM0 } from "@/lib/data";
import {
  findRawDayBlock,
  saveBlockToDay,
  logCompletion,
  realDayBlocks,
  weekHasBeenPlanned,
  isItemScheduled,
} from "@/lib/calendar";
import { courseNameFor } from "@/lib/courses";
import { DF } from "@/lib/constants";
import { assignmentOnTimeScore, splitOnTimeScore } from "@/lib/metrics";
import { dedupeCourseFromTaskLabel } from "@/lib/taskLabel";
import { Sp, DiffBadge, DelBtn, DayAgenda, PaceRunner } from "@/components/shared";

// ── TODAY ────────────────────────────────────────────────────────────────────
export function Today({data:rawData,upd,ai,busy,toast2,refreshQuarterPlan,planning,setTab,onCheckIn}){
  // Scoped to the current term — otherwise Deadline Awareness, Today's Classes, and everything
  // else here would consider every course/assignment/exam ever created, including years-old
  // completed terms kept for history. Safe: this component never writes directly to
  // courses/assignments/exams (only studyPlan/completionLog/pomodoroLogs via shared functions),
  // so there's no risk of the scoped copy accidentally overwriting other terms' data on save.
  const data=termScopedForPlanning(rawData);
  // Cached once per "brief period" (see briefPeriodStart — anchored to 8am local time, not
  // midnight and NOT the app's build version). The old briefVersion===APP_VERSION check meant
  // every rebuild/redeploy invalidated the cache and fired a real, paid AI call on next load,
  // regardless of whether the day's actual facts had changed — a real reported cost concern.
  const [brief,setBrief]=useState(()=>data.briefCache&&data.briefPeriod===briefPeriodStart()?data.briefCache:null);
  // Tracks the period the CURRENT brief actually belongs to — a ref, not just reading data.briefPeriod
  // directly, so the periodic re-check below (a mount-only effect) always sees the latest value
  // instead of a stale one captured in its closure at mount time.
  const briefPeriodRef=useRef(data.briefPeriod);
  const [adhocT,setAT]=useState("");
  const [adhocTm,setATm]=useState("");
  const [adhocD,setAD]=useState(90);
  const [showCalendar,setShowCalendar]=useState(false); // full-day calendar now opens on demand instead of always inline — the day-view design itself is still a work in progress
  const [showDailyMsg,setShowDailyMsg]=useState(false); // same on-demand pattern for the daily message preview — not tied to any one channel (copy/paste, not a live send)
  const [showHealth,setShowHealth]=useState(false); // health-dot popover — see below
  // Per-row Focus Time timer state — replaces the old single global "which session is current"
  // selector entirely. Only one row can be running at a time; starting a different row just
  // switches (no confirmation needed, nothing destructive happens to the abandoned one — it
  // simply isn't marked complete).
  const [runningBlockId,setRunningBlockId]=useState(null);
  const [secsLeft,setSecsLeft]=useState(0);
  const [paused,setPaused]=useState(false);
  // "study" or "break" — the timer runs BOTH phases back-to-back off one Play click (no second
  // click to start the break), using the real profile focusMins/breakMins split rather than the
  // block's own rounded combined duration — see lib/notify.js for the beep+notification fired at
  // each transition.
  const [phase,setPhase]=useState("study");
  const td=iso(),di=new Date().getDay(),p=data.profile;
  const q=getQ(p),fin=isFin(td,p),hol=isHol(td,p);
  const hr=new Date().getHours();

  const dueToday=data.assignments.filter(a=>a.dueDate===td&&a.status!=="done");
  const dueTomorrow=data.assignments.filter(a=>a.status!=="done"&&a.dueDate&&du(a.dueDate)===1);
  const dueWk=data.assignments.filter(a=>a.status!=="done"&&a.dueDate&&du(a.dueDate)>0&&du(a.dueDate)<=7);
  const dueNx=data.assignments.filter(a=>a.status!=="done"&&a.dueDate&&du(a.dueDate)>7&&du(a.dueDate)<=14);
  const exWk=data.exams.filter(e=>du(e.date)>=0&&du(e.date)<=7).sort((a,b)=>du(a.date)-du(b.date));
  const exPrep=data.exams.filter(e=>{const d=du(e.date);return d>0&&d<=e.prepDays;}).sort((a,b)=>du(a.date)-du(b.date));
  const missing=data.assignments.filter(a=>!a.dueDate&&a.status!=="done");
  // Health dot — a single glanceable red/yellow/green signal, built from cheap checks already
  // available on every Today render (plain array filters + the planStale flag). Deliberately
  // does NOT run a planner simulation just to color a dot — real plan shortfalls already have
  // their own dedicated surface (Plan status), this is a lighter-weight "is anything obviously
  // off" check, not a duplicate of that. Red = something needs a fix now; yellow = routine
  // upkeep pending; green = neither.
  const overdueItems=[
    ...data.assignments.filter(a=>a.dueDate&&a.dueDate<td&&a.status!=="done"),
    ...data.exams.filter(e=>e.date&&e.date<td&&e.status!=="done"),
  ];
  const checkedInToday=(data.dailyLogs||[]).some(l=>l.date===td);
  const healthReasons=[
    missing.length>0&&{level:"red",text:`${missing.length} assignment${missing.length!==1?"s":""} missing a due date`},
    overdueItems.length>0&&{level:"red",text:`${overdueItems.length} item${overdueItems.length!==1?"s":""} overdue, not marked done`},
    data.planStale&&{level:"yellow",text:"Plan doesn't reflect your latest changes yet"},
    !checkedInToday&&{level:"yellow",text:"Evening check-in not done yet"},
  ].filter(Boolean);
  const health=healthReasons.some(r=>r.level==="red")?"red":healthReasons.length?"yellow":"green";
  const healthColor={red:"var(--red)",yellow:"var(--amber)",green:"var(--green)"}[health];

  // Study Pace — term-accumulated: every study/homework/project minute the planner has actually
  // scheduled from the term's start through today, vs. how much of that is marked completed.
  // Reads straight from data.studyPlan.weeks (the same source realDayBlocks uses) rather than
  // walking a day-by-day date range, so it only touches weeks/days that actually exist in the
  // plan. null (not 0) when nothing's been planned yet in-range — that's "no data", not "0%".
  const termStart=p.termStart;
  let paceMinPlanned=0,paceMinDone=0;
  if(termStart&&termStart<=td){
    Object.values(data.studyPlan?.weeks||{}).forEach(week=>{
      Object.entries(week.days||{}).forEach(([dateStr,blocks])=>{
        if(dateStr<termStart||dateStr>td)return;
        (blocks||[]).forEach(b=>{
          const mins=b.e-b.s;
          paceMinPlanned+=mins;
          if(b.completed)paceMinDone+=mins;
        });
      });
    });
  }
  const studyPace=paceMinPlanned>0?Math.round(100*paceMinDone/paceMinPlanned):null;
  const paceColor=studyPace===null?"var(--t3)":studyPace<60?"var(--red)":studyPace<85?"var(--amber)":"var(--green)";

  // Assignments On-time — accumulated from the term's start through today: every assignment
  // EITHER already due, OR already done (even if its due date hasn't arrived yet — that's
  // exactly what "early" means, and it should count the moment it happens, not sit excluded
  // until the due date eventually passes it by). Scored individually via assignmentOnTimeScore()
  // above (on time=100%, early=bonus, late/still-missing=shrinking partial credit), then
  // averaged — a continuous score, not a binary on-time/late count, so it can exceed 100% when
  // enough items were done early (see splitOnTimeScore below for how that's displayed).
  // completedAt (stamped the moment status flips to "done" — see Acad.jsx / Prog.jsx) is the
  // reference date; an assignment marked done before that field existed has no completedAt and
  // defaults to its own due date (i.e. exactly on time) rather than being penalized retroactively
  // for data that was never recorded. A still-open, already-due item scores against TODAY, so it
  // keeps shrinking until it's actually done, then locks in wherever it landed.
  const dueToDate=termStart?data.assignments.filter(a=>a.dueDate&&a.dueDate>=termStart&&(a.dueDate<=td||a.status==="done")):[];
  const onTimeScores=dueToDate.map(a=>{
    const refDate=a.status==="done"?(a.completedAt?a.completedAt.slice(0,10):a.dueDate):td;
    const diffDays=Math.round((new Date(a.dueDate)-new Date(refDate))/864e5);
    return assignmentOnTimeScore(diffDays);
  });
  const onTimeRaw=onTimeScores.length>0?Math.round(onTimeScores.reduce((s,v)=>s+v,0)/onTimeScores.length):null;
  // The raw average can exceed 100 (early-submission bonus) — split so the main number/bar/color
  // stay a normal capped 0-100% reading, with any bonus earned above that as its own small badge.
  const {pct:onTimePct,bonus:onTimeBonus}=splitOnTimeScore(onTimeRaw);
  const onTimeColor=onTimePct===null?"var(--t3)":onTimePct<60?"var(--red)":onTimePct<85?"var(--amber)":"var(--green)";

  // One headline for the whole card, driven by whichever metric is currently worse — saying
  // "you're doing great" while one of the two numbers is actually struggling would be dishonest
  // encouragement. Tone shifts with the band: a plain "keep going" below green, a real
  // celebration once both are.
  const paceScores=[studyPace,onTimePct].filter(v=>v!==null);
  const paceWorst=paceScores.length?Math.min(...paceScores):null;
  const paceHeadline=paceWorst===null?null:paceWorst<60
    ?"Keep going — every session moves you forward."
    :paceWorst<85?"Keep going — you're building good momentum."
    :"You're doing great — keep it up! 🎉";
  // Deliberately NOT color-banded like the metrics below — this line is meant to read as
  // encouragement even on a rough day, and red/amber text made it read as a warning instead. A
  // fixed optimistic color (see .pace-headline in globals.css) keeps that true at every score.
  const classes=data.courses.filter(c=>(c.days||[]).includes(di));
  const gd=(p.gymDays||GYM0).find(g=>g.day===di&&g.on);
  const gymDone=(data.gymLogs||[]).some(g=>g.date===td);
  const gymTarget=(p.gymDays||GYM0).filter(g=>g.on).length;
  const gymWk=(()=>{const m=new Date();m.setDate(new Date().getDate()-new Date().getDay()+1);return(data.gymLogs||[]).filter(g=>new Date(g.date)>=m).length;})();
  const chores=(p.chores||[]).filter(c=>c.days?.includes(di));
  const todayAdhoc=(data.adhoc||[]).filter(e=>e.date===td);

  // Countdown for whichever row is currently running. At 0: study phase rolls straight into
  // break (no click needed — same Play that started study already committed to the whole
  // session), break phase auto-completes, same as a manual Complete click — see completeSession
  // below. A phase transition is exactly when notifyPhase fires.
  useEffect(()=>{
    if(!runningBlockId||paused)return;
    if(secsLeft<=0){
      if(phase==="study"){
        const breakMins=(+p.breakMins)||5;
        notifyPhase("break-start","Break time! ☕",`Take a ${breakMins}-min break — you've earned it.`);
        setPhase("break");
        setSecsLeft(breakMins*60);
        return;
      }
      notifyPhase("break-end","Break's over 💪","Back to it — resume when you're ready.");
      completeSession(runningBlockId,true);
      return;
    }
    const t=setTimeout(()=>setSecsLeft(s=>s-1),1000);
    return()=>clearTimeout(t);
  },[runningBlockId,paused,secsLeft,phase]); // eslint-disable-line

  function startSession(block){
    setRunningBlockId(block.id);
    setPhase("study");
    setSecsLeft(((+p.focusMins)||25)*60);
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
        // Same DOM node whether this is a manual click or the timer auto-completing at 0 —
        // looked up by id rather than threading an event target through, since the auto path
        // has no click event to grab one from.
        sparkleBurst(document.getElementById(`complete-btn-${blockId}`),"task");
      }
    }
    if(runningBlockId===blockId){setRunningBlockId(null);setPaused(false);}
  }

  async function gen(){
    // The real, deterministic plan (data.studyPlan.weeks) is the single source of truth for what
    // studying happens today — no longer computed here at all. gen()'s only job now is the AI
    // commentary layer (oneFocus/encouragement/dailyMessage/etc), which is given the real plan
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
Return JSON:{"oneFocus":"THE single most important thing today — one specific sentence, referencing the real plan above if there is one","urgencyAlert":null,"gymNudge":null,"encouragement":"one warm encouraging sentence","dailyGreeting":"short casual greeting, e.g. 'Hey ${p.name}! 💪'","dailyLines":["one SHORT line per distinct topic today — due items, exams, study sessions, gym — each its own array entry, NOT one paragraph. Keep each line under ~12 words, start with a relevant emoji, plain and scannable like a real text message."],"dailyClosing":"one short warm sign-off, e.g. 'You've got this! 🚀'"}`
      );
      const period=briefPeriodStart();
      briefPeriodRef.current=period;
      if(t){
        try{
          const b=JSON.parse(t.replace(/```json|```/g,"").trim());
          setBrief(b);upd({briefCache:b,briefPeriod:period});
        }catch{
          // AI text failed to parse — the real plan is already showing (read directly, not via
          // brief), so this only affects the commentary fields, which just fall back to plain text.
          upd({briefCache:immediate,briefPeriod:period});
        }
      }else{
        upd({briefCache:immediate,briefPeriod:period});
      }
    }catch(err){
      console.error("StudyOS: gen() failed —",err);
      toast2("Couldn't build today's briefing ("+(err?.message||"unknown error")+")",true);
      setBrief({oneFocus:"Briefing generation hit an error — see the notification for details."});
    }
  }

  useEffect(()=>{
    if(!brief)gen();
    // Re-check periodically so a tab left open across the 8am boundary actually regenerates —
    // "refreshed once per day at 8am", not just "once per app open". This only ever calls gen()
    // when the period has genuinely rolled over (at most once/day), not on a fixed schedule.
    const t=setInterval(()=>{
      if(briefPeriodStart()!==briefPeriodRef.current)gen();
    },10*60*1000);
    return ()=>clearInterval(t);
  },[]); // eslint-disable-line

  // Build unified awareness list, sorted earliest first. "planned" checks whether THIS SPECIFIC
  // item has a scheduled block anywhere in the plan (isItemScheduled, matched via the planner's
  // own source={type,id} tag on each block it places) — not just today's blocks by course. That
  // course-level, today-only check used to show "not yet" for an item genuinely scheduled for
  // tomorrow (or falsely show "planned" off a different item in the same course today), and
  // hardcoded false for exam-prep/due-next-week rows regardless of the real plan.
  const todayRealBlocks=realDayBlocks(data,td); // still the source for "what's scheduled today" (Focus Time etc.)
  const rawAwareness=[];
  dueToday.forEach(a=>{const cn=courseNameFor(data.courses,a.courseId);rawAwareness.push({days:0,lvl:0,text:`${a.title} — ${cn}`,tag:"Due TODAY",planned:isItemScheduled(data,"assignment",a.id)});});
  exWk.forEach(e=>{const cn=courseNameFor(data.courses,e.courseId);rawAwareness.push({days:du(e.date),lvl:du(e.date)<=2?0:1,text:`${cn} exam`,tag:`in ${du(e.date)} day${du(e.date)!==1?"s":""}`,planned:isItemScheduled(data,"exam",e.id)});});
  exPrep.filter(e=>!exWk.find(x=>x.id===e.id)).forEach(e=>{const cn=courseNameFor(data.courses,e.courseId);rawAwareness.push({days:du(e.date),lvl:1,text:`${cn} exam`,tag:`${du(e.date)}d — start prep`,planned:isItemScheduled(data,"exam",e.id)});});
  dueWk.forEach(a=>{const days=a.dueDate&&a.dueDate.length===10?du(a.dueDate):99;const cn=courseNameFor(data.courses,a.courseId);rawAwareness.push({days,lvl:2,text:`${a.title} — ${cn}`,tag:days<99?`${days}d`:"⚠ Enter date",planned:isItemScheduled(data,"assignment",a.id)});});
  dueNx.forEach(a=>{const days=a.dueDate&&a.dueDate.length===10?du(a.dueDate):99;const cn=courseNameFor(data.courses,a.courseId);rawAwareness.push({days,lvl:3,text:`${a.title} — ${cn}`,tag:days<99?`${days}d`:"⚠ Enter date",planned:isItemScheduled(data,"assignment",a.id)});});
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
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6,position:"relative"}}>
            <h1 style={{marginBottom:0}}>
              {/* Sub-project: Web-Mobile Enablement item #6 — the full greeting plus the 3 header
                  icon buttons (check-in/calendar/message) don't both fit on one line at phone
                  widths, so the icon row was wrapping onto its own line below the greeting.
                  Abbreviating the greeting on narrow screens (same show/hide-by-class pattern as
                  the Academics tab labels and onboarding step labels) keeps everything on one
                  row instead of relying on font-size guesswork. */}
              <span className="today-greet-full">{hr<12?"Good morning":hr<17?"Good afternoon":"Good evening"}, {p.name}</span>
              <span className="today-greet-short">Hi, {p.name}</span>
            </h1>
            {/* Health dot — tappable, not hover-only, so it actually works on a phone (a
                title/tooltip wouldn't). Bare color is the at-a-glance signal; tapping it is how
                you find out why, on any device. */}
            <button onClick={()=>setShowHealth(v=>!v)} aria-label={`Status: ${health}`}
              style={{width:11,height:11,borderRadius:"50%",background:healthColor,border:"none",
                cursor:"pointer",padding:0,flexShrink:0}}/>
            {showHealth&&(
              <>
                <div onClick={()=>setShowHealth(false)} style={{position:"fixed",inset:0,zIndex:60}}/>
                <div style={{position:"absolute",top:"100%",left:0,marginTop:8,zIndex:61,minWidth:230,
                  background:"var(--card)",border:"1px solid var(--b1)",borderRadius:10,padding:12,
                  boxShadow:"0 12px 30px rgba(0,0,0,0.4)"}}>
                  {healthReasons.length===0?(
                    <div style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:"var(--green)"}}>
                      <i className="ti ti-circle-check"/> All good — nothing needs attention.
                    </div>
                  ):(
                    <div style={{display:"flex",flexDirection:"column",gap:7}}>
                      {healthReasons.map((r,i)=>(
                        <div key={i} style={{display:"flex",alignItems:"center",gap:8,fontSize:13,
                          color:r.level==="red"?"var(--red)":"var(--amber)"}}>
                          <span style={{width:7,height:7,borderRadius:"50%",background:r.level==="red"?"var(--red)":"var(--amber)",flexShrink:0}}/>
                          {r.text}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          <div className="row" style={{gap:8}}>
            <span style={{fontSize:15,color:"var(--t2)"}}>
              {new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}
            </span>
            {q&&<span className="badge badge-amber">{q.name}</span>}
            {fin&&<span className="badge badge-red">⚠ Finals Week</span>}
            {hol&&<span className="badge badge-green">🎉 Holiday</span>}
          </div>
        </div>
        <div style={{display:"flex",gap:8,flexShrink:0}}>
          {/* Check-in nudge — was a full-width banner with its own button; folded into this same
              icon row instead (amber-tinted so it still reads as "needs attention" without text).
              Same destination (Progress tab) either way. */}
          {!(data.dailyLogs||[]).some(l=>l.date===iso())&&(
            <button className="tt" data-tt="Evening check-in not done yet — mark off what you finished" onClick={()=>(onCheckIn?onCheckIn():setTab?.("prog"))}
              style={{width:34,height:34,borderRadius:"50%",border:"1px solid var(--amber)",background:"var(--amber-bg)",
                color:"var(--amber)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
              <i className="ti ti-checkbox" style={{fontSize:16}}/>
            </button>
          )}
          <button className="tt" data-tt="View day calendar" onClick={()=>setShowCalendar(true)}
            style={{width:34,height:34,borderRadius:"50%",border:"1px solid var(--b1)",background:"var(--card2)",
              color:"var(--t2)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
            <i className="ti ti-calendar" style={{fontSize:16}}/>
          </button>
          {brief?.dailyLines?.length>0&&(
            <button className="tt" data-tt="View daily message" onClick={()=>setShowDailyMsg(true)}
              style={{width:34,height:34,borderRadius:"50%",border:"1px solid var(--b1)",background:"var(--card2)",
                color:"var(--t2)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
              <i className="ti ti-message-circle" style={{fontSize:16}}/>
            </button>
          )}
        </div>
      </div>

      {/* ── PROGRESS — term-to-date Study Pace + On-time Assignments, with the running-mascot
          we prototyped live and landed on. One shared headline carries the encouragement (tone
          driven by whichever metric is worse) instead of a hint line per metric — kept
          deliberately compact since this was already the largest thing on the tab with just one
          metric. Hidden entirely once there's genuinely nothing to show yet for either metric. */}
      {paceWorst!==null&&(
        <div style={BOX}>
          <div style={TITLE_ROW}>
            <i className="ti ti-trending-up" style={TITLE_ICON}/>
            <span style={TITLE_TEXT}>Progress</span>
          </div>
          <div style={DIVIDER}/>
          <div style={INNER}>
            {/* Headline stays a fixed optimistic color regardless of band — red text read as an
                alarm/error rather than encouragement, which undercuts the point of a message
                meant to motivate even on a rough day. Runner now sits on this same line (moved
                off the metrics rows per request) and follows the same worst-of-both score the
                headline text uses, so the character and the message never disagree. */}
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
              <div className="pace-headline">{paceHeadline}</div>
              <PaceRunner score={paceWorst} size={30}/>
            </div>
            <div className="pace-metrics">
              {studyPace!==null&&(
                <div className="pace-metric-row">
                  <span className="pace-metric-label">Study Pace</span>
                  <div className="pace-bonus-slot"/>
                  <span className="pace-pct" style={{color:paceColor}}>{studyPace}%</span>
                  <div className="pace-bar-wrap">
                    <div className="pace-bar"><div className="pace-bar-fill" style={{width:`${studyPace}%`,background:paceColor}}/></div>
                    <div className="pace-bar-arrow" style={{left:`${studyPace}%`,color:paceColor}}>▲</div>
                  </div>
                </div>
              )}
              {onTimePct!==null&&(
                <div className="pace-metric-row">
                  <span className="tt pace-metric-label" data-tt="Assignment on-time: 100% for on time, bonus for early, shrinking credit for late or still missing">Assignment on-time</span>
                  <div className="pace-bonus-slot">
                    {onTimeBonus>0&&
                      <span className="tt pace-bonus" data-tt="Bonus for submitting early">+{onTimeBonus}</span>
                    }
                  </div>
                  <span className="pace-pct" style={{color:onTimeColor}}>{onTimePct}%</span>
                  <div className="pace-bar-wrap">
                    <div className="pace-bar"><div className="pace-bar-fill" style={{width:`${onTimePct}%`,background:onTimeColor}}/></div>
                    <div className="pace-bar-arrow" style={{left:`${onTimePct}%`,color:onTimeColor}}>▲</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── TOP THINGS TO KEEP IN MIND — first content block. The due-today/tomorrow line is
          deterministic, not AI-written — per this app's standing preference (deterministic over
          AI wherever the two could achieve the same result), something as critical as "this is
          due tomorrow" shouldn't depend on whether the AI happened to mention it that particular
          regeneration. Renders even before/without the AI briefing loading, so it's never gated
          behind a call that might be slow or fail. ── */}
      {(brief||dueToday.length>0||dueTomorrow.length>0)&&(
        <div style={BOX}>
          <div style={TITLE_ROW}>
            <i className="ti ti-target" style={TITLE_ICON}/>
            <span style={TITLE_TEXT}>Top Things To Keep In Mind</span>
          </div>
          <div style={DIVIDER}/>
          <div style={INNER}>

            {/* Deterministic — always first, always shown when relevant, independent of brief */}
            {(dueToday.length>0||dueTomorrow.length>0)&&(
              <div style={{display:"flex",alignItems:"flex-start",gap:10,
                paddingBottom:brief?10:0,marginBottom:brief?10:0,
                borderBottom:brief?"1px solid var(--b1)":"none"}}>
                <div style={{width:8,height:8,borderRadius:"50%",background:"var(--red)",flexShrink:0,marginTop:6}}/>
                <span style={{fontSize:15,color:"var(--t1)",lineHeight:1.6}}>
                  {dueToday.length>0&&<><strong style={{color:"var(--red)"}}>Due today:</strong> {dueToday.map(a=>a.title).join(", ")}</>}
                  {dueToday.length>0&&dueTomorrow.length>0&&"  ·  "}
                  {dueTomorrow.length>0&&<><strong style={{color:"var(--amber)"}}>Due tomorrow:</strong> {dueTomorrow.map(a=>a.title).join(", ")}</>}
                </span>
              </div>
            )}

            {brief&&(<>

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

            </>)}

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
              {/* Time tag — amber normally, red if missing date. Fixed width + centered so
                  "3d"/"6d"/"in 6 days"/"⚠ Enter date" all occupy the same column width — without
                  this, the Focus-status column right after it (below) shifts left/right per row
                  depending on how long that row's tag text happens to be. */}
              <span style={{fontSize:13,fontWeight:500,whiteSpace:"nowrap",
                color:item.tag==="⚠ Enter date"?"var(--red)":"var(--amber)",
                background:item.tag==="⚠ Enter date"?"var(--red-bg)":"var(--amber-bg)",
                padding:"2px 9px",borderRadius:8,minWidth:72,textAlign:"center"}}>
                {item.tag}
              </span>
              {/* Focus status — fixed width so "not yet" and "✓ planned" always start at the
                  same x, regardless of the tag column's width on that row. */}
              {item.planned
                ?<span style={{fontSize:12,color:"var(--green)",whiteSpace:"nowrap",minWidth:64,display:"inline-block"}}>✓ planned</span>
                :<span className="tt" data-tt="Study time gets scheduled closer to the due date — this isn't a gap, it's intentional (see Study Preferences for when each item's window opens)"
                  style={{fontSize:12,color:"var(--t3)",whiteSpace:"nowrap",cursor:"help",minWidth:64,display:"inline-block"}}>not yet</span>
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
                  <div style={{flex:1,minWidth:0}}>
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
          ):(
          // ONE grid for the whole list, not one grid per row — a per-row grid (the previous
          // version) computes its "auto" columns independently per row, so the button+duration
          // column sizes to THAT row's own duration text ("30m" vs "1h 30m") and the play button
          // visibly drifts left/right between rows — a real, reported regression. Column widths
          // are only actually synced across rows when every row is a direct child of the SAME
          // grid, which is why each row below contributes its 4 cells directly (via Fragment, no
          // per-row wrapping div) rather than being its own nested grid.
          <div style={{display:"grid",gridTemplateColumns:"4px minmax(0,1fr) auto auto",
            alignItems:"center",columnGap:14}}>
          {todayRealBlocks.map((b,i,arr)=>{
            const endMins=t2m(b.time)+(b.duration||25);
            const endTime=b.endTime||m2t(endMins);
            const course=data.courses.find(c=>c.id===b.courseId);
            const col=course?.color?.border||"var(--a-study-t)";
            const isRunning=runningBlockId===b.id;
            const mm=Math.floor(secsLeft/60).toString().padStart(2,"0");
            const ss=(secsLeft%60).toString().padStart(2,"0");
            // This row also shows the course name as its own line right below — dedupeCourseFromTaskLabel
            // (lib/taskLabel.js) strips the same leading course-name prefix off the task label for
            // display only, so the two lines stop repeating each other.
            const displayTask=dedupeCourseFromTaskLabel(b.task,b.course);
            // width/height live in the "icon-btn-28" CSS class (not here) so the mobile touch-
            // target media query in globals.css can bump them on narrow screens — 28px is under
            // Apple/Google's ~44px minimum recommended tap target, cramped for the button you hit
            // most often on this tab (start/pause/complete a session). Desktop keeps 28px.
            const rowIconBtn={borderRadius:"50%",border:"1px solid var(--b1)",cursor:"pointer",
              display:"flex",alignItems:"center",justifyContent:"center",padding:0,flexShrink:0,background:"var(--card2)"};
            const cellBorder=i<arr.length-1?"1px solid var(--b1)":"none";
            const cellOpacity=b.completed?0.55:1;
            // Each task now occupies TWO explicit grid rows in the one shared list-wide grid —
            // line 1 (course name + play button/duration + time range) and line 2 (the assignment
            // text, full-width). Explicit gridRowStart per task (rather than relying on grid
            // auto-flow) is required once cells span a variable number of rows depending on
            // breakpoint (see .ft-actions/.ft-time/.ft-assignment in globals.css).
            const rowStart=i*2+1;
            return(
              // Course/stripe/assignment columns are elastic (minmax(0,1fr) on the grid above —
              // genuinely can reach 0, unlike a flex item with an implicit content-based floor);
              // text truncates with an ellipsis instead of wrapping or forcing the row wider. The
              // button+duration group and the time range are both "auto" — sized to their own
              // content, synced across every row since they're all columns of the one shared grid
              // above — so the time stays genuinely locked to the right edge, and the play button
              // lands at the same x on every row, regardless of that row's own duration/time text.
              <Fragment key={i}>
                {/* Colored course stripe — spans both of this task's rows (course name + assignment) */}
                <div style={{gridColumn:1,gridRow:`${rowStart} / span 2`,paddingTop:12,paddingBottom:12,
                  opacity:cellOpacity,borderBottom:cellBorder,borderRadius:2,background:col,alignSelf:"stretch",minHeight:40}}/>

                {/* Course name — line 1 only. alignSelf:"stretch" + its own internal flex centering
                    (rather than a fixed paddingTop) keeps its vertical center matched with the
                    actions/time cells beside it regardless of what line 1's actual computed height
                    ends up being — real reported bug otherwise ("the text is not aligned"). */}
                {b.course&&(
                  <div style={{gridColumn:2,gridRowStart:rowStart,opacity:cellOpacity,alignSelf:"stretch",
                    display:"flex",alignItems:"center",minWidth:0}}>
                    {/* Now the ONLY place this row names the course (the task label's own copy was
                        deduped away below) — plain bright text, no pill/background, per explicit
                        correction. */}
                    <span style={{fontSize:12.5,fontWeight:700,color:"var(--t1)",overflow:"hidden",
                      textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{b.course}</span>
                  </div>
                )}

                {/* Play/Pause+Complete button(s) + Duration. Spans both lines on desktop (centered
                    across the full row, unchanged) but only line 1 below 640px — centered on the
                    course-name line, per explicit request — via grid-row-end + alignItems in the
                    .ft-actions class (globals.css), not inline, so it can vary by breakpoint. */}
                <div className="ft-actions" style={{gridColumn:3,gridRowStart:rowStart,opacity:cellOpacity,
                  alignSelf:"stretch",display:"flex",gap:8,"--cell-border":cellBorder}}>
                  {isRunning?(
                    <>
                      <button className="tt icon-btn-28" data-tt={paused?"Resume":"Pause"} onClick={()=>setPaused(p=>!p)}
                        style={{...rowIconBtn,color:"var(--amber)"}}>
                        <i className={`ti ${paused?"ti-player-play":"ti-player-pause"}`} style={{fontSize:13}}/>
                      </button>
                      <button id={`complete-btn-${b.id}`} className="tt icon-btn-28" data-tt="Mark complete" onClick={()=>completeSession(b.id,false)}
                        style={{...rowIconBtn,color:"var(--green)"}}>
                        <i className="ti ti-check" style={{fontSize:14}}/>
                      </button>
                    </>
                  ):(
                    <>
                      {b.completed?(
                        <i className="ti ti-circle-check" style={{fontSize:20,color:"var(--green)"}}/>
                      ):(
                        <button className="tt icon-btn-28" data-tt="Start" onClick={()=>startSession(b)}
                          style={{...rowIconBtn,background:"var(--amber-bg)",color:"var(--amber)"}}>
                          <i className="ti ti-player-play" style={{fontSize:13}}/>
                        </button>
                      )}
                      <span style={{fontSize:13,color:"var(--t3)",minWidth:30,display:"inline-block"}}>
                        {fmtDur(b.duration||25)}
                      </span>
                    </>
                  )}
                </div>

                {/* Time range — locked to the right edge. Same span/centering treatment as the
                    actions column (.ft-time), so the two line up with each other and with the
                    course-name line at every width. */}
                <div className="ft-time" style={{gridColumn:4,gridRowStart:rowStart,opacity:cellOpacity,
                  alignSelf:"stretch",display:"flex","--cell-border":cellBorder}}>
                  {isRunning?(
                    <span style={{display:"flex",flexDirection:"column",alignItems:"flex-end",lineHeight:1.1}}>
                      {phase==="break"&&<span style={{fontSize:10,color:"var(--teal)",textTransform:"uppercase",letterSpacing:"0.06em",fontWeight:700}}>Break</span>}
                      <span style={{fontSize:18,fontFamily:"'Syne',sans-serif",fontWeight:700,color:phase==="break"?"var(--teal)":"var(--amber)",whiteSpace:"nowrap",textAlign:"right"}}>
                        {mm}:{ss}
                      </span>
                    </span>
                  ):(
                    <span style={{fontSize:14,color:"var(--amber)",fontWeight:500,whiteSpace:"nowrap",textAlign:"right"}}>
                      {f12(b.time)} – {f12(endTime)}
                    </span>
                  )}
                </div>

                {/* Assignment text — line 2. On mobile it spans columns 2-4 (the width the
                    line-1-only actions/time cells free up there) so the full title gets room to
                    display left to right instead of truncating early — real reported request.
                    On desktop it stays confined to the course-name column only, unchanged/verified
                    (columns 3-4 there are still occupied by the actions/time cells' own 2-row
                    span). Span comes from .ft-assignment (globals.css), conditional by breakpoint. */}
                {/* gridColumnStart (longhand), not the gridColumn shorthand — the shorthand also
                    resets grid-column-end to "auto" inline, which (inline styles always beating
                    stylesheet rules for the same longhand) would silently block .ft-assignment's
                    conditional grid-column-end span below from ever applying. */}
                <div className="ft-assignment" style={{gridColumnStart:2,gridRowStart:rowStart+1,marginTop:2,
                  paddingBottom:12,opacity:cellOpacity,borderBottom:cellBorder,minWidth:0}}>
                  <span style={{fontSize:15,color:col,lineHeight:1.5,overflow:"hidden",
                    textOverflow:"ellipsis",whiteSpace:"nowrap",display:"block"}}>
                    {b.completed&&"✓ "}{displayTask}
                  </span>
                </div>
              </Fragment>
            );
          })}
          </div>
          )}
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
                <div style={{flex:1,minWidth:0}}>
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
                <div style={{flex:1,minWidth:0}}>
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
                <div style={{flex:1,minWidth:0}}>
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
            {/* DayAgenda (components/shared) — the same colored-list rendering the Calendar tab's
                day view uses, so "today" looks identical whether you're looking at it here or
                there. It shows its own "not planned yet" banner and still lists the day's real
                fixed schedule (classes, meals, gym) regardless; the Plan-now action below is the
                one thing specific to this modal. */}
            <DayAgenda data={data} dateStr={td}/>
            {!weekHasBeenPlanned(data,td)&&(
              <div style={{textAlign:"center",marginTop:12}}>
                <button className="btn btn-sm" style={{background:"var(--red)",color:"#fff"}} onClick={refreshQuarterPlan} disabled={planning}>
                  {planning?<><Sp sz={12}/> Planning...</>:<><i className="ti ti-sparkles"/> Plan now</>}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {showDailyMsg&&(
        <div style={{position:"fixed",inset:0,zIndex:9000,background:"rgba(0,0,0,0.55)",
          display:"flex",alignItems:"center",justifyContent:"center",padding:20}}
          onClick={()=>setShowDailyMsg(false)}>
          <div style={{background:"var(--card)",borderRadius:14,padding:"20px 24px",
            maxWidth:400,width:"100%",maxHeight:"85vh",overflowY:"auto",
            boxShadow:"0 24px 60px rgba(0,0,0,0.5)"}}
            onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <div style={{fontSize:16,fontWeight:600,color:"var(--t1)"}}>
                <i className="ti ti-message-circle" style={{marginRight:8,color:"var(--blue)"}}/>Morning Message
              </div>
              <button className="btn btn-ghost btn-sm" onClick={()=>setShowDailyMsg(false)}><i className="ti ti-x"/></button>
            </div>
            <div className="daily-msg" style={{display:"flex",flexDirection:"column",gap:9}}>
              {brief?.dailyGreeting&&<div style={{fontSize:14,fontWeight:600,color:"var(--t1)"}}>{brief.dailyGreeting}</div>}
              {brief?.dailyLines?.map((line,i)=>(
                <div key={i} style={{fontSize:13.5,color:"var(--t2)",lineHeight:1.4}}>{line}</div>
              ))}
              {brief?.dailyClosing&&<div style={{fontSize:14,fontWeight:600,color:"var(--t1)",marginTop:2}}>{brief.dailyClosing}</div>}
            </div>
            <div style={{fontSize:12,color:"var(--t3)",marginTop:12,textAlign:"center"}}>
              Sends automatically via SMS at <span style={{color:"var(--amber)"}}>{p.wakeTime}</span> once deployed
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
