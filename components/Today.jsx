import { useState, useEffect } from "react";
import { iso, du, m2t, t2m, f12, fmtDur } from "@/lib/time";
import { APP_VERSION } from "@/lib/version";
import { termScopedForPlanning, getQ, isFin, isHol, GYM0 } from "@/lib/data";
import {
  findRawDayBlock,
  saveBlockToDay,
  logCompletion,
  realDayBlocks,
  weekHasBeenPlanned,
} from "@/lib/calendar";
import { courseNameFor } from "@/lib/courses";
import { DF } from "@/lib/constants";
import { Sp, DiffBadge, DelBtn, Timeline } from "@/components/shared";

// ── TODAY ────────────────────────────────────────────────────────────────────
export function Today({data:rawData,upd,ai,busy,toast2,refreshQuarterPlan,planning,setTab}){
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

      {/* Daily check-in nudge — keeps overdue items from piling up unnoticed. */}
      {!(data.dailyLogs||[]).some(l=>l.date===iso())&&(
        <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",marginBottom:16,
          background:"var(--amber-bg)",color:"var(--amber)",borderRadius:10,fontSize:13.5}}>
          <i className="ti ti-checkbox" style={{fontSize:16,flexShrink:0}}/>
          Evening check-in not done yet — mark off what you finished so tomorrow's plan is accurate.
          <button className="btn btn-sm" style={{marginLeft:"auto",background:"var(--amber)",color:"#1a0e00"}}
            onClick={()=>setTab?.("prog")}>
            Open check-in
          </button>
        </div>
      )}

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
