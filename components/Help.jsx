import { useState } from "react";
import { gettingStartedStatus } from "@/lib/help";

// ── HELP ─────────────────────────────────────────────────────────────────────
// A real nav tab now, not the side drawer it started as (components/shared/HelpDrawer.jsx,
// deleted) — moved here so it's discoverable from the main menu like every other section instead
// of behind a small "?" icon a new user has no reason to notice. Same BOX/TITLE_ROW/etc. card
// pattern every other tab component defines locally (CLAUDE.md's own documented convention),
// rather than the drawer's own narrow-panel styling, since this is now a normal full-width page.
// Account and the daily Calendar popup still use the SideDrawer shell this component originally
// introduced — only Help itself moved out of it.
//
// Two sections, stacked as separate cards rather than a tab-switcher (no longer confined to a
// 400px-wide panel, so there's no real reason to hide one behind the other): a self-paced Getting
// Started checklist (jump to any item in any order — no forced sequence) and a searchable Q&A
// reference that stays useful long after first login. See lib/help.js for how "done" is actually
// derived from real data — most items are. Two items are manual instead (`manual:true`, each with
// its own `field`): "Review your daily schedule" and "Review estimated difficulties" both lack an
// honest auto-detect signal — every schedule field already has a sane default whether touched or
// not, and leaving an AI difficulty estimate unchanged is just as legitimate an outcome as
// adjusting it (so "has userValue been set" would false-negative on "looked at it, decided the
// estimate was already right"). Each manual item's own boolean persists on the profile
// (profile[item.field]) so it survives a reload.
const ITEMS = [
  { id:"school", title:"Add your school & term", sub:"Sets the real dates the planner works from.", tab:"school", label:"School Info" },
  { id:"syllabus", title:"Upload a syllabus", sub:"Drop in a PDF and StudyOS reads every assignment, exam, and due date automatically.", tab:"acad", sec:"sync", label:"Courses → Update Syllabus" },
  { id:"difficulty", title:"Review estimated difficulties", sub:"StudyOS estimates how hard each item is and how long it'll take — adjust any that don't look right.", tab:"acad", sec:"difficulty", label:"Courses → Difficulty", manual:true, field:"helpDifficultyReviewed" },
  { id:"schedule", title:"Review your daily schedule", sub:"Wake/sleep, meals, gym, how long a study session runs before a break.", tab:"settings", sec:"schedule", label:"Preferences → Daily Schedule", manual:true, field:"helpScheduleReviewed" },
  { id:"notifications", title:"Turn on notifications", sub:"A heads-up when it's time to study, and a daily text summary if you want one.", tab:"settings", sec:"notifs", label:"Preferences → Notifications" },
  { id:"replan", title:"Save & Replan", sub:"Turns everything above into your actual day-by-day schedule.", tab:"settings", sec:"schedule", label:"Preferences → Save & Replan" },
  { id:"focusTime", title:"Try Focus Time", sub:"Press play on a real session from Today — StudyOS tracks it as you go.", tab:"today", label:"Today → Focus Time" },
];

const QA = [
  { group:"Getting set up", q:"How does StudyOS build my study plan?", a:"It takes your courses, assignment/exam due dates, and your own study-preference settings, then schedules real sessions into your actual daily schedule — placing harder or sooner-due work earlier, and never double-booking your class or gym time." },
  { group:"Getting set up", q:"What if I don't have a syllabus PDF?", a:"You can add courses, assignments, and exams by hand from Courses at any time — the syllabus upload is a shortcut, not a requirement." },
  { group:"Getting set up", q:"Can I use StudyOS for more than one school or term?", a:"Yes — School Info supports multiple schools and terms, and StudyOS automatically knows which one is current based on your term dates." },
  { group:"How the planner thinks", q:"What order does the planner place things in?", a:"Exam prep comes first — each exam gets protected time right before it, extra on the day before. Then homework, labs, and projects fill in whatever's left, prioritizing whichever's due soonest and worth more of your grade. \"Regular study\" time for a class (when nothing specific is due) only fills genuinely empty gaps, last." },
  { group:"How the planner thinks", q:"Why does my calendar look full, but a task still shows as \"short\"?", a:"Different courses' deadlines can land in the same week. When that happens, exam prep claims its protected time first — which can leave little or no room for smaller tasks due around the same time. The time you see on your calendar is real, it's just reserved for something else. Open Calendar → the icon next to Replan → \"Plan status\" to see exactly which items are short and by how much." },
  { group:"How the planner thinks", q:"What makes something \"high priority\"?", a:"Two things: how soon it's due, and how much of your grade it's worth (plus how hard that course is overall). A 2%-weight quiz due in three weeks won't outrank a 25%-weight midterm due next week, even if the quiz feels more pressing day-to-day." },
  { group:"How the planner thinks", q:"A task is showing \"short\" — what should I do?", a:"A small shortfall (an hour or two, often a quick admin task) is usually fine to just knock out yourself, off-schedule — it doesn't need a dedicated block. For a bigger shortfall, check Plan Status for what's competing for the same days (often two exams close together), and consider whether a due date, weight, or estimated hours needs a correction, then Save & Replan." },
  { group:"Daily use", q:"What happens if I miss a study session?", a:"It rolls into your catch-up list on Progress rather than disappearing — you'll see it flagged until you either complete it or it gets replanned." },
  { group:"Daily use", q:"Can I move or reschedule a session?", a:"Yes, from the Calendar or Today view — drag it to a new time, or use Save & Replan to let StudyOS rebuild the rest of your schedule around the change." },
  { group:"Daily use", q:"What does 'Save & Replan' actually do?", a:"It regenerates your schedule using your latest preferences and courses — only days that haven't happened yet are touched, so nothing already completed gets rewritten." },
  { group:"Notifications", q:"Browser reminders vs. text reminders — what's the difference?", a:"Browser notifications only fire while a StudyOS tab is open. Text reminders reach your phone even when the browser is closed — a daily summary in the morning, plus an evening nudge if there's anything overdue." },
  { group:"Notifications", q:"Will I get charged for texts?", a:"Standard message rates from your carrier may apply — StudyOS itself doesn't charge for SMS reminders. You can turn them off any time from Preferences → Notifications." },
];

export function Help({data,updP,onJump}){
  const [q,setQ]=useState("");
  const [openQ,setOpenQ]=useState(null);
  const status=gettingStartedStatus(data);
  const p=data.profile||{};

  // Same card styling used throughout Today/Courses/Preferences/School Info.
  const BOX={background:"var(--card)",borderRadius:12,marginBottom:14};
  const TITLE_ROW={display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 20px 0 20px"};
  const TITLE_LEFT={display:"flex",alignItems:"center",gap:8};
  const TITLE_ICON={fontSize:17,color:"var(--blue)"};
  const TITLE_TEXT={fontSize:13,fontWeight:500,color:"var(--t2)",textTransform:"uppercase",letterSpacing:"0.08em"};
  const DIVIDER={borderTop:"1px solid var(--b1)",margin:"10px 20px 0 20px"};
  const INNER={padding:"14px 20px 18px 20px"};

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
    <div className="fade">
      <h2 style={{marginBottom:6}}>Help</h2>
      <p style={{fontSize:14,color:"var(--t3)",marginBottom:20,lineHeight:1.6}}>
        A self-paced checklist for getting set up, plus quick answers for anything that comes up later.
      </p>

      <div style={BOX}>
        <div style={TITLE_ROW}>
          <div style={TITLE_LEFT}><i className="ti ti-list-check" style={TITLE_ICON}/><span style={TITLE_TEXT}>Getting Started</span></div>
        </div>
        <div style={DIVIDER}/>
        <div style={INNER}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:18}}>
            <div style={{flex:1,height:6,background:"var(--card2)",borderRadius:4,overflow:"hidden"}}>
              <div style={{height:"100%",background:"var(--green)",borderRadius:4,width:pct+"%",transition:"width .3s"}}/>
            </div>
            <div style={{fontSize:12,color:"var(--t3)",whiteSpace:"nowrap",fontVariantNumeric:"tabular-nums"}}>{doneCount} of {ITEMS.length} done</div>
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
                  <div style={{fontSize:14,fontWeight:600,color:"var(--t1)",marginBottom:2}}>{item.title}</div>
                  <div style={{fontSize:13,color:"var(--t3)",lineHeight:1.5}}>{item.sub}</div>
                  {!done&&(
                    <button onClick={()=>onJump(item.tab,item.sec)} style={{background:"none",border:"none",padding:0,
                      fontSize:12.5,color:"var(--amber)",fontWeight:600,marginTop:6,cursor:"pointer",fontFamily:"inherit"}}>
                      {item.label} →
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Real request: explain the planner's own logic/priorities somewhere students will actually
          see it, placed prominently — right after Getting Started, before the Q&A reference — with
          a leading alert on syllabus-data accuracy (its own real request, kept short/bulleted on
          purpose: "write it in shorter sentences, e.g. bullets easy to read"). */}
      <div style={BOX}>
        <div style={TITLE_ROW}>
          <div style={TITLE_LEFT}><i className="ti ti-route" style={TITLE_ICON}/><span style={TITLE_TEXT}>How Study Plan is created</span></div>
        </div>
        <div style={DIVIDER}/>
        <div style={INNER}>
          {/* Amber = this app's established attention/warning color; white body text (not
              amber-on-amber) for readability — same convention as the syllabus-sync "last synced"
              marker and every other tinted callout in the app. */}
          <div style={{display:"flex",gap:10,padding:"12px 14px",background:"var(--amber-bg)",borderRadius:9,marginBottom:20}}>
            <i className="ti ti-alert-triangle" style={{color:"var(--amber)",fontSize:16,flexShrink:0,marginTop:1}}/>
            <div style={{fontSize:13.5,color:"#fff",lineHeight:1.7}}>
              <div style={{fontWeight:700,color:"var(--amber)",marginBottom:4}}>Your plan is only as good as your syllabus data</div>
              <ul style={{margin:0,paddingLeft:18}}>
                <li>StudyOS uses AI to read your syllabus and set up classes, assignments, exams, and due dates.</li>
                <li>AI can get things wrong — always check the results right after you upload.</li>
                <li>Syllabi change during the term — that's normal.</li>
                <li>When your teacher updates something, update it in StudyOS too.</li>
                <li>Then use Save &amp; Replan so your schedule catches up.</li>
              </ul>
            </div>
          </div>
          <ol style={{margin:0,paddingLeft:20,fontSize:14,color:"var(--t2)",lineHeight:1.7}}>
            <li style={{marginBottom:12}}>
              <strong style={{color:"var(--t1)"}}>Estimating difficulty &amp; time.</strong> Every exam and assignment gets a difficulty estimate — courses are researched (real reviews, workload discussion) for a baseline, then each item's own weight and due date shape how hard it's rated. That rating converts into an estimated number of study hours needed.
            </li>
            <li style={{marginBottom:12}}>
              <strong style={{color:"var(--t1)"}}>Planning respects your preferences.</strong> The planner works within your actual daily schedule — wake/sleep time, meals, gym, your declared best/peak energy time, and your focus-session length — and never double-books your class time or other commitments.
            </li>
            <li style={{marginBottom:12}}>
              <strong style={{color:"var(--t1)"}}>Planning allocates time by priority:</strong>
              <ol style={{margin:"6px 0 0",paddingLeft:20}}>
                <li>Exam prep — protected, dedicated time right before each exam, with extra time the day before.</li>
                <li>Homework, labs, and projects — placed by how soon they're due and how much of your grade they're worth.</li>
                <li>Regular study time — fills any genuinely free time left over, when nothing specific is due yet.</li>
              </ol>
            </li>
            <li>
              <strong style={{color:"var(--t1)"}}>If something looks short,</strong> you have two options: adjust the item (due date, weight, or estimated hours) and click Save &amp; Replan — or simply double-click any study session on the Calendar to move or edit it yourself, no replan needed.
            </li>
          </ol>
        </div>
      </div>

      <div style={BOX}>
        <div style={TITLE_ROW}>
          <div style={TITLE_LEFT}><i className="ti ti-message-circle-question" style={TITLE_ICON}/><span style={TITLE_TEXT}>Q&amp;A</span></div>
        </div>
        <div style={DIVIDER}/>
        <div style={INNER}>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search questions..."
            style={{width:"100%",maxWidth:400,background:"var(--card2)",border:"1px solid var(--b1)",borderRadius:9,
              padding:"9px 12px",color:"var(--t1)",fontSize:14,fontFamily:"inherit",marginBottom:16}}/>
          {filteredQA.length===0&&(
            <div style={{fontSize:13,color:"var(--t3)",padding:"20px 0",textAlign:"center"}}>No matching questions — try a different search.</div>
          )}
          {filteredQA.map((item,idx)=>{
            const showGroup=item.group!==lastGroup;
            lastGroup=item.group;
            const key=item.q;
            const isOpen=openQ===key;
            return(
              <div key={key}>
                {showGroup&&(
                  <div style={{fontSize:11,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",
                    letterSpacing:"0.07em",margin:idx===0?"0 0 6px":"18px 0 6px"}}>{item.group}</div>
                )}
                <div style={{borderBottom:"1px solid var(--b1)"}}>
                  <button onClick={()=>setOpenQ(isOpen?null:key)} style={{width:"100%",textAlign:"left",background:"none",
                    border:"none",padding:"12px 0",fontSize:14,color:"var(--t1)",fontWeight:500,cursor:"pointer",
                    fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
                    <span>{item.q}</span>
                    <span style={{color:isOpen?"var(--amber)":"var(--t3)",fontSize:13,flexShrink:0,
                      transform:isOpen?"rotate(90deg)":"none",transition:"transform .2s"}}>›</span>
                  </button>
                  {isOpen&&(
                    <div style={{fontSize:13.5,color:"var(--t2)",lineHeight:1.65,padding:"0 0 16px",maxWidth:640}}>{item.a}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
