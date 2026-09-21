import { useState } from "react";
import { gettingStartedStatus } from "@/lib/help";

// ── HELP DRAWER ──────────────────────────────────────────────────────────────
// Replaces an earlier full-screen spotlight-tour design (dimmed overlay + forced click-through
// Next/Back sequence) with a calm, non-modal side panel instead — deliberately NO backdrop and NO
// click-outside-to-close, unlike every other overlay in this app (InfoModal/ConfirmModal etc. all
// use a dimming backdrop, components/shared/modals.jsx). That's on purpose here: the whole point is
// that the real app stays fully visible and clickable while this is open, so a student can read a
// checklist item, click into Preferences right behind the drawer, and come back — closing only via
// the × or re-clicking the ? icon that opened it (App.jsx).
//
// Two tabs: a self-paced Getting Started checklist (jump to any item in any order — no forced
// sequence) and a searchable Q&A reference that stays useful long after first login, unlike a
// one-time tour. See lib/help.js for how "done" is actually derived from real data — most items
// are. Two items are manual instead (`manual:true`, each with its own `field`): "Review your daily
// schedule" and "Review estimated difficulties" both lack an honest auto-detect signal — every
// schedule field already has a sane default whether touched or not, and leaving an AI difficulty
// estimate unchanged is just as legitimate an outcome as adjusting it (so "has userValue been set"
// would false-negative on "looked at it, decided the estimate was already right"). Each manual
// item's own boolean persists on the profile (profile[item.field]) so it survives a reload.
const ITEMS = [
  { id:"school", title:"Add your school & term", sub:"Sets the real dates the planner works from.", tab:"school", label:"School Info" },
  { id:"syllabus", title:"Upload a syllabus", sub:"Drop in a PDF and StudyOS reads every assignment, exam, and due date automatically.", tab:"acad", sec:"sync", label:"Academics → Update Syllabus" },
  { id:"difficulty", title:"Review estimated difficulties", sub:"StudyOS estimates how hard each item is and how long it'll take — adjust any that don't look right.", tab:"acad", sec:"difficulty", label:"Academics → Difficulty", manual:true, field:"helpDifficultyReviewed" },
  { id:"schedule", title:"Review your daily schedule", sub:"Wake/sleep, meals, gym, how long a study session runs before a break.", tab:"settings", sec:"schedule", label:"Preferences → Daily Schedule", manual:true, field:"helpScheduleReviewed" },
  { id:"notifications", title:"Turn on notifications", sub:"A heads-up when it's time to study, and a daily text summary if you want one.", tab:"settings", sec:"notifs", label:"Preferences → Notifications" },
  { id:"replan", title:"Save & Replan", sub:"Turns everything above into your actual day-by-day schedule.", tab:"settings", sec:"schedule", label:"Preferences → Save & Replan" },
  { id:"focusTime", title:"Try Focus Time", sub:"Press play on a real session from Today — StudyOS tracks it as you go.", tab:"today", label:"Today → Focus Time" },
];

const QA = [
  { group:"Getting set up", q:"How does StudyOS build my study plan?", a:"It takes your courses, assignment/exam due dates, and your own study-preference settings, then schedules real sessions into your actual daily schedule — placing harder or sooner-due work earlier, and never double-booking your class or gym time." },
  { group:"Getting set up", q:"What if I don't have a syllabus PDF?", a:"You can add courses, assignments, and exams by hand from Academics at any time — the syllabus upload is a shortcut, not a requirement." },
  { group:"Getting set up", q:"Can I use StudyOS for more than one school or term?", a:"Yes — School Info supports multiple schools and terms, and StudyOS automatically knows which one is current based on your term dates." },
  { group:"Daily use", q:"What happens if I miss a study session?", a:"It rolls into your catch-up list on Progress rather than disappearing — you'll see it flagged until you either complete it or it gets replanned." },
  { group:"Daily use", q:"Can I move or reschedule a session?", a:"Yes, from the Calendar or Today view — drag it to a new time, or use Save & Replan to let StudyOS rebuild the rest of your schedule around the change." },
  { group:"Daily use", q:"What does 'Save & Replan' actually do?", a:"It regenerates your schedule using your latest preferences and courses — only days that haven't happened yet are touched, so nothing already completed gets rewritten." },
  { group:"Notifications", q:"Browser reminders vs. text reminders — what's the difference?", a:"Browser notifications only fire while a StudyOS tab is open. Text reminders reach your phone even when the browser is closed — a daily summary in the morning, plus an evening nudge if there's anything overdue." },
  { group:"Notifications", q:"Will I get charged for texts?", a:"Standard message rates from your carrier may apply — StudyOS itself doesn't charge for SMS reminders. You can turn them off any time from Preferences → Notifications." },
];

export function HelpDrawer({open,onClose,data,updP,onJump}){
  const [tab,setTab]=useState("start");
  const [q,setQ]=useState("");
  const [openQ,setOpenQ]=useState(null);
  const status=gettingStartedStatus(data);
  const p=data.profile||{};

  function isDone(item){
    return item.manual ? p[item.field]===true : status[item.id];
  }
  const doneCount=ITEMS.filter(isDone).length;
  const pct=Math.round(doneCount/ITEMS.length*100);

  const filteredQA=q.trim()
    ? QA.filter(item=>item.q.toLowerCase().includes(q.trim().toLowerCase())||item.a.toLowerCase().includes(q.trim().toLowerCase()))
    : QA;
  let lastGroup=null;

  return(
    // Fixed-position panel, not a flex-reflow layout like the mockup — App.jsx's root uses a fixed
    // header over normal document flow, not a flex row, so reflowing the whole app to make room
    // for a sidebar would mean restructuring layout every tab already depends on. Floating on top
    // instead gets the same "app stays usable" result (nothing dimmed, nothing blocked) without
    // that risk — it just overlaps the right edge of the screen instead of shrinking it.
    <div style={{
      position:"fixed",top:0,right:0,bottom:0,zIndex:9000,
      width:open?"min(400px, 100vw)":0,overflow:"hidden",
      background:"var(--card)",borderLeft:open?"1px solid var(--b1)":"none",
      boxShadow:open?"-16px 0 40px rgba(0,0,0,0.35)":"none",
      transition:"width .28s cubic-bezier(.2,.8,.3,1)",display:"flex",flexDirection:"column",
    }}>
      <div style={{padding:"22px 24px 0",flexShrink:0,minWidth:352}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
          <span style={{fontSize:19,fontWeight:700,letterSpacing:"-0.01em",color:"var(--t1)"}}>Hey — need a hand?</span>
          <button onClick={onClose} style={{background:"none",border:"none",color:"var(--t3)",fontSize:18,cursor:"pointer",padding:4,lineHeight:1}}>✕</button>
        </div>
        <div style={{fontSize:12.5,color:"var(--t3)",lineHeight:1.6,marginBottom:16}}>
          A self-paced checklist for getting set up, plus quick answers for anything that comes up later.
        </div>
        <div style={{display:"flex",gap:4,background:"var(--card2)",borderRadius:9,padding:3}}>
          <button onClick={()=>setTab("start")} style={{flex:1,background:tab==="start"?"var(--amber)":"none",border:"none",
            padding:"8px 10px",fontSize:12.5,fontWeight:tab==="start"?600:500,color:tab==="start"?"#241a08":"var(--t3)",
            borderRadius:7,cursor:"pointer",fontFamily:"inherit"}}>Getting Started</button>
          <button onClick={()=>setTab("qa")} style={{flex:1,background:tab==="qa"?"var(--amber)":"none",border:"none",
            padding:"8px 10px",fontSize:12.5,fontWeight:tab==="qa"?600:500,color:tab==="qa"?"#241a08":"var(--t3)",
            borderRadius:7,cursor:"pointer",fontFamily:"inherit"}}>Q&amp;A</button>
        </div>
      </div>

      <div style={{flex:1,overflowY:"auto",padding:"18px 24px 24px",minWidth:352}}>
        {tab==="start"?(
          <>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:18}}>
              <div style={{flex:1,height:6,background:"var(--card2)",borderRadius:4,overflow:"hidden"}}>
                <div style={{height:"100%",background:"var(--green)",borderRadius:4,width:pct+"%",transition:"width .3s"}}/>
              </div>
              <div style={{fontSize:11.5,color:"var(--t3)",whiteSpace:"nowrap",fontVariantNumeric:"tabular-nums"}}>{doneCount} of {ITEMS.length} done</div>
            </div>
            {ITEMS.map((item,i)=>{
              const done=isDone(item);
              return(
                <div key={item.id} style={{display:"flex",gap:12,padding:"13px 0",borderBottom:i<ITEMS.length-1?"1px solid var(--b1)":"none"}}>
                  <button
                    onClick={item.manual?()=>updP({[item.field]:!done}):undefined}
                    disabled={!item.manual}
                    title={item.manual?(done?"Mark not reviewed":"Mark reviewed"):undefined}
                    style={{width:20,height:20,borderRadius:"50%",border:`1.5px solid ${done?"var(--green)":"var(--b2)"}`,
                      background:done?"var(--green)":"transparent",flexShrink:0,marginTop:1,display:"flex",alignItems:"center",
                      justifyContent:"center",fontSize:11,color:done?"#0a1f16":"transparent",padding:0,
                      cursor:item.manual?"pointer":"default"}}>✓</button>
                  <div style={{flex:1,minWidth:0}}>
                    {/* Title stays plain white (var(--t1)), no strikethrough — the green checkmark
                        bubble to the left is the one "done" signal now, not a second echo of the
                        same state on the text itself. */}
                    <div style={{fontSize:13.5,fontWeight:600,color:"var(--t1)",marginBottom:2}}>{item.title}</div>
                    <div style={{fontSize:12,color:"var(--t3)",lineHeight:1.5}}>{item.sub}</div>
                    {!done&&(
                      <button onClick={()=>onJump(item.tab,item.sec)} style={{background:"none",border:"none",padding:0,
                        fontSize:11.5,color:"var(--amber)",fontWeight:600,marginTop:6,cursor:"pointer",fontFamily:"inherit"}}>
                        {item.label} →
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        ):(
          <>
            <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search questions..."
              style={{width:"100%",background:"var(--card2)",border:"1px solid var(--b1)",borderRadius:9,
                padding:"9px 12px",color:"var(--t1)",fontSize:13,fontFamily:"inherit",marginBottom:16}}/>
            {filteredQA.length===0&&(
              <div style={{fontSize:12.5,color:"var(--t3)",padding:"20px 0",textAlign:"center"}}>No matching questions — try a different search.</div>
            )}
            {filteredQA.map((item,idx)=>{
              const showGroup=item.group!==lastGroup;
              lastGroup=item.group;
              const key=item.q;
              const isOpen=openQ===key;
              return(
                <div key={key}>
                  {showGroup&&(
                    <div style={{fontSize:10.5,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",
                      letterSpacing:"0.07em",margin:idx===0?"0 0 6px":"16px 0 6px"}}>{item.group}</div>
                  )}
                  <div style={{borderBottom:"1px solid var(--b1)"}}>
                    <button onClick={()=>setOpenQ(isOpen?null:key)} style={{width:"100%",textAlign:"left",background:"none",
                      border:"none",padding:"11px 0",fontSize:13,color:"var(--t1)",fontWeight:500,cursor:"pointer",
                      fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
                      <span>{item.q}</span>
                      <span style={{color:isOpen?"var(--amber)":"var(--t3)",fontSize:12,flexShrink:0,
                        transform:isOpen?"rotate(90deg)":"none",transition:"transform .2s"}}>›</span>
                    </button>
                    {isOpen&&(
                      <div style={{fontSize:12.5,color:"var(--t2)",lineHeight:1.65,padding:"0 0 14px"}}>{item.a}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
