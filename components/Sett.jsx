import { useState } from "react";
import { t2m, m2t, f12, iso } from "@/lib/time";
import { DS, DF, FOCUS_MIN_OPTIONS, BREAK_MIN_OPTIONS, GYM_DUR_OPTIONS } from "@/lib/constants";
import { GYM0, CHORE_PRESETS, uid } from "@/lib/data";
import { supabase } from "@/lib/supabase";
import { SecHead, DelBtn, DayPick, Sp } from "@/components/shared";

// ── SETTINGS ─────────────────────────────────────────────────────────────────
// "Reset all data" moved to the Account modal (password + are-you-sure gated) — see AccountModal.
export function Sett({data,upd,updP,toast2,refreshQuarterPlan,planMsg,busy,planning}){
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
    "commuteMins","focusMins","breakMins","energyPeakTime","gymDays","gymStretch","gymDrive","chores"];
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
    if(perm==="granted"){toast2("Notifications enabled! 🔔");}
    else{toast2("Permission denied — enable it in your browser's site settings",true);}
  }
  // Master pause/resume — same idea as disableSms below, its own flag rather than the three
  // per-type toggles so each keeps its own remembered choice while paused (turning the master back
  // on shouldn't silently re-enable a type the student had deliberately turned off separately).
  function disableBrowserNotifs(){updP({browserNotifsEnabled:false});toast2("Browser notifications off");}
  function enableBrowserNotifs(){updP({browserNotifsEnabled:true});toast2("Browser notifications on");}

  // SMS reminders (B-11) — this "send now" call proves the pipe works end-to-end; the scheduled
  // 8:30am/8:00pm sends are separate server-side cron routes (app/api/cron/*, lib/sms/cronSend.js),
  // not this one — those use the service-role key to reach every opted-in user, not just whoever's
  // currently signed in here.
  const [smsBusy,setSmsBusy]=useState(false);
  const [smsConsent,setSmsConsent]=useState(false); // the opt-in checkbox — always starts unchecked, never persisted
  // Blur is the explicit "Confirm Number" moment — nothing shown (no error, no confirmation)
  // until the user actually leaves the field, so an error doesn't flash while they're still
  // mid-typing the first few digits.
  const [phoneTouched,setPhoneTouched]=useState(false);
  // Real reported bug: a 9-digit number was silently accepted and only failed at Twilio, deep
  // into a confusing error. Client-side length check first, so a typo never even reaches the API.
  // p.phone is always stored as a literal "+1" prefix + whatever raw digits the user typed (see
  // the phone <input>'s onChange below) — strip exactly that prefix, not just any leading "1",
  // before counting. Counting digits on the *whole* string instead (the original version of this
  // function) had a live bug: a 9-digit entry plus the "1" from "+1" totals 10 digits too, so a
  // number missing its last digit was misread as a valid 10-digit number and silently accepted.
  function isValidUsPhone(v){
    const raw=String(v||"").replace(/^\+1/,"").replace(/\D/g,"");
    return raw.length===10;
  }
  // Raw send — no toasts of its own, just ok/error, so both the pre-enable verify flow and the
  // always-available "Send me a test text" button (once already on) can each react their own way.
  async function sendTestRaw(to){
    const {data:{session}}=await supabase.auth.getSession();
    const res=await fetch("/api/sms/send",{
      method:"POST",
      headers:{"Content-Type":"application/json",Authorization:`Bearer ${session?.access_token||""}`},
      body:JSON.stringify({to,message:"StudyOS test message — SMS reminders are working! 🎓"}),
    });
    const j=await res.json();
    if(!res.ok||j.error)throw new Error(j.error||"Couldn't send the test text");
  }
  // A phone number only counts as trustworthy once a real test text has actually reached it —
  // real reported gap: a typo'd number could sit "enabled" indefinitely with nothing ever
  // actually arriving. smsVerifiedPhone tracks exactly which number that confirmation covers, so
  // entering a NEW or CHANGED number always needs its own fresh verify before relying on it.
  const [awaitingConfirm,setAwaitingConfirm]=useState(false); // "test just sent, waiting on Yes/No"
  const phoneVerified=p.phone&&p.phone===p.smsVerifiedPhone;
  async function startVerify(){
    if(!p.phone||(!p.smsEnabled&&!smsConsent))return;
    if(!isValidUsPhone(p.phone)){toast2("Enter a full 10-digit phone number, e.g. +1 555 123 4567",true);return;}
    setSmsBusy(true);
    try{
      await sendTestRaw(p.phone);
      setAwaitingConfirm(true);
    }catch(err){toast2(err.message,true);}
    setSmsBusy(false);
  }
  function confirmVerified(){
    updP({smsEnabled:true,smsConsentAt:p.smsConsentAt||new Date().toISOString(),smsVerifiedPhone:p.phone});
    setSmsConsent(false);
    setAwaitingConfirm(false);
    toast2("SMS reminders on");
  }
  function denyVerified(){
    setAwaitingConfirm(false);
    toast2("No text? Double-check the number and try again.",true);
  }
  function disableSms(){updP({smsEnabled:false});toast2("SMS reminders off");}
  async function sendTestSms(){
    if(!p.phone){toast2("Add a phone number first",true);return;}
    setSmsBusy(true);
    try{ await sendTestRaw(p.phone); toast2("Test text sent — check your phone!"); }
    catch(err){toast2(err.message,true);}
    setSmsBusy(false);
  }

  const [ncReminder,setNcReminder]=useState({text:"",date:"",time:"09:00"});
  function addCustomReminder(){
    if(!ncReminder.text||!ncReminder.date)return;
    updP({customReminders:[...(p.customReminders||[]),{...ncReminder,id:uid(),sent:false}]});
    setNcReminder({text:"",date:"",time:"09:00"});
    toast2("Reminder added");
  }

  return(
    <div className="fade">
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <h2>Preferences</h2>
        <div className="row">
          {dirty&&<span className="badge badge-amber">● plan not yet refreshed</span>}
          {/* tt-below tt-right: this button sits at the very top of the page, so the tooltip's
              default above-trigger placement rendered clipped above the visible viewport (real
              reported bug) — open it downward instead, anchored to the button's right edge since
              it's also the rightmost element in its row. */}
          <button className={`btn btn-sm tt tt-below tt-right ${dirty?"btn-action":"btn-ghost"}`} data-tt="Re-plans every day from today through the end of your term — but only if something that actually affects scheduling changed (term dates, wake/sleep/meal times, focus length, energy peak, gym days). Other changes just save." onClick={saveReplan} disabled={planning||!dirty} title={dirty?"Refresh your plan with these new settings":"No changes to refresh"}>
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
        <div className="aligned-fields">
          <div className="card">
            <SecHead icon="ti-clock" title="Sleep & Wake"/>
            <div className="field-grid">
              <label className="align-col-label">Wake time</label>
              <input type="time" className="input-time" value={p.wakeTime} onChange={e=>mk(()=>updP({wakeTime:e.target.value}))}/>
              <label className="align-col-label">Sleep time</label>
              <input type="time" className="input-time" value={p.sleepTime} onChange={e=>mk(()=>updP({sleepTime:e.target.value}))}/>
              <label className="align-col-label">Commute (min)</label>
              <input type="number" className="input-num-sm" min="5" max="120" value={p.commuteMins} onChange={e=>mk(()=>updP({commuteMins:+e.target.value}))}/>
            </div>
          </div>
          <div className="card">
            <SecHead icon="ti-brain" title="Study preferences"/>
            {/* One session-length preference, not two — "Study session length" used to duplicate
                Focus block length with its own separate 3-choice picker (30/45/60, each a fixed
                study+break split); the planner now derives its own scheduling chunk from
                THIS SAME focus+break pair (see presetLenFor, lib/planner/schedule.js), so setting
                it once here is enough. Dropdowns instead of button rows for real resolution
                (FOCUS_MIN_OPTIONS/BREAK_MIN_OPTIONS, lib/constants.js) — a button row of every
                5-minute increment from 15–90 would be an unreadable wall of buttons. */}
            {/* Label + field centered as a pair, all three rows sharing one label column with
                Sleep & Wake and Meal times below (see scheduleRef/labelColPx above, and
                .field-grid in globals.css). Energy peak used to sit in its own separate row below
                Focus/Break, the odd one out; now all three are equal rows in the same grid. */}
            <div className="field-grid">
              <label className="align-col-label">Focus length <span style={{color:"var(--t3)",fontWeight:400}}>(study time before a break)</span></label>
              <select className="select-compact" value={p.focusMins} onChange={e=>mk(()=>updP({focusMins:+e.target.value}))}>
                {FOCUS_MIN_OPTIONS.map(n=><option key={n} value={n}>{n} min</option>)}
              </select>
              <label className="align-col-label">Break length</label>
              <select className="select-compact" value={p.breakMins} onChange={e=>mk(()=>updP({breakMins:+e.target.value}))}>
                {BREAK_MIN_OPTIONS.map(n=><option key={n} value={n}>{n} min</option>)}
              </select>
              {/* A specific time, not a morning/afternoon/evening bucket — classified into the
                  same three broad windows internally (see windowOrderFor, schedule.js), but this
                  is real precision instead of a coarse guess at which third of the day "counts". */}
              <label className="align-col-label">Energy peak <span style={{color:"var(--t3)",fontWeight:400}}>(when you think clearest)</span></label>
              <input type="time" className="input-time" value={p.energyPeakTime} onChange={e=>mk(()=>updP({energyPeakTime:e.target.value}))}/>
            </div>
          </div>

          {/* Meal times with conflict detection */}
          <div className="card">
            <SecHead icon="ti-bowl-spoon" title="Meal times"/>
            {/* Body text is white, not blue-on-blue — same fix as the meal/gym conflict banners
                below: a matching accent color directly on its own tinted background reads poorly
                as a full sentence (real reported bug, "red text over brown background"), even
                though a short badge/pill in the same combo is fine. Icon stays blue as the cue. */}
            <div style={{background:"var(--blue-bg)",borderRadius:8,padding:"9px 12px",marginBottom:14,fontSize:13,color:"#fff",display:"flex",gap:8}}>
              <i className="ti ti-info-circle" style={{fontSize:14,flexShrink:0,marginTop:1,color:"var(--blue)"}}/>
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
                  {/* Same field-grid as Sleep & Wake / Study preferences above (shares their
                      measured label column via scheduleRef/labelColPx) — icon+name together stand
                      in for the label here, right-aligned as a pair via justifyContent:"flex-end"
                      so the icon still reads immediately before its meal name rather than pinned
                      to the column's far edge on its own. */}
                  <div className="field-grid" style={{marginBottom:hasConflict?10:0}}>
                    <div className="align-col-label align-col-flex">
                      <span style={{fontSize:18}}>{l==="Breakfast"?"🍳":l==="Lunch"?"🥗":"🍽"}</span>
                      {/* Real reported inconsistency: this rendered var(--t1) (white, 15px) while
                          every other field's label in this same aligned group — Wake time, Sleep
                          time, Focus length, etc. — uses the global label{} styling (var(--t3),
                          12px, uppercase, letter-spaced). Matched exactly rather than just the
                          color alone, so this genuinely reads as the same label style, not merely
                          the same hue. */}
                      <span style={{fontSize:12,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.07em",fontWeight:400}}>{l}</span>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <input type="time" className="input-time" value={p[tk]} onChange={e=>mk(()=>updP({[tk]:e.target.value}))}/>
                      <select className="select-compact" value={p[dk]} onChange={e=>mk(()=>updP({[dk]:+e.target.value}))}>
                        {[15,20,30,45,60].map(n=><option key={n} value={n}>{n} min</option>)}
                      </select>
                    </div>
                  </div>
                  {hasConflict&&(
                    <div style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px",background:"var(--amber-bg)",borderRadius:8,fontSize:13,color:"#fff"}}>
                      <i className="ti ti-arrows-shuffle" style={{fontSize:14,flexShrink:0,color:"var(--amber)"}}/>
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
        <div className="aligned-fields">
          <div className="card">
            <SecHead icon="ti-barbell" title="Gym schedule"/>
            <div style={{background:"var(--amber-bg)",borderRadius:8,padding:"9px 12px",marginBottom:12,fontSize:13,color:"#fff",display:"flex",gap:8}}>
              <i className="ti ti-alert-triangle" style={{fontSize:14,flexShrink:0,marginTop:1,color:"var(--amber)"}}/>
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
              // Start time + duration (a select, same idiom as meal duration), not start+end —
              // real requested UX fix: two separate time pickers made the student subtract them
              // just to know a session's length. gd.e is still what conflict-checking above and
              // the planner read, so it's always DERIVED (start + duration) rather than removed
              // from the data shape — no schema change, no migration needed. If a legacy/custom
              // duration doesn't match one of the presets, it's added to this row's own option
              // list rather than silently snapping to a different value the moment the page loads.
              const curDur=Math.max(0,Math.round(gymEnd-gymStart));
              const durOpts=GYM_DUR_OPTIONS.includes(curDur)?GYM_DUR_OPTIONS:[...GYM_DUR_OPTIONS,curDur].sort((a,b)=>a-b);
              return(
                <div key={gd.day} style={{padding:"10px 0",borderBottom:i<6?"1px solid var(--b1)":"none"}}>
                  {/* flexWrap:"wrap" (not the old fontSize:12/width:85 squeeze) is what actually
                      makes this row mobile-friendly — real reported bug: the tiny font shrank
                      below the app-wide 16px baseline, which triggers iOS Safari's
                      auto-zoom-on-focus (see the note above input,select,textarea in globals.css),
                      and even then the row didn't reliably fit a phone width. Full-size,
                      full-width-but-capped .input-time fields now wrap onto their own line under
                      the day checkbox on narrow screens instead of shrinking to fit. */}
                  <div className="list-item" style={{padding:0,gap:10,borderBottom:"none",flexWrap:"wrap"}}>
                    <div style={{display:"flex",alignItems:"center",gap:7,width:78,flexShrink:0}}>
                      <input type="checkbox" checked={gd.on} onChange={e=>{const d=[...(p.gymDays||GYM0)];d[i]={...d[i],on:e.target.checked};mk(()=>updP({gymDays:d}));}} style={{width:14,height:14}}/>
                      <span style={{fontSize:13,color:gd.on?"var(--t1)":"var(--t3)"}}>{DF[gd.day].slice(0,3)}</span>
                    </div>
                    {gd.on?(
                      <div className="row" style={{gap:6}}>
                        <input type="time" className="input-time" value={gd.s} onChange={e=>{
                          const d=[...(p.gymDays||GYM0)];
                          d[i]={...d[i],s:e.target.value,e:m2t(t2m(e.target.value)+curDur)};
                          mk(()=>updP({gymDays:d}));
                        }}/>
                        <select className="select-compact" value={curDur} onChange={e=>{
                          const d=[...(p.gymDays||GYM0)];
                          d[i]={...d[i],e:m2t(t2m(gd.s)+ +e.target.value)};
                          mk(()=>updP({gymDays:d}));
                        }}>
                          {durOpts.map(n=><option key={n} value={n}>{n} min</option>)}
                        </select>
                      </div>
                    ):<span style={{fontSize:12,color:"var(--t3)"}}>rest day</span>}
                  </div>
                  {conflict&&(
                    <div style={{display:"flex",alignItems:"center",gap:7,padding:"6px 10px",background:"var(--red-bg)",borderRadius:7,marginTop:6,fontSize:12,color:"#fff"}}>
                      <i className="ti ti-alert-circle" style={{fontSize:13,color:"var(--red)"}}/>
                      Overlaps class or commute on {DF[gd.day]} — adjust time
                    </div>
                  )}
                </div>
              );
            })}
            <div className="field-grid" style={{marginTop:12}}>
              <label>Stretch prep (min)</label>
              <input type="number" className="input-num-sm" min="10" max="60" value={p.gymStretch||30} onChange={e=>mk(()=>updP({gymStretch:+e.target.value}))}/>
              <label>Drive to gym (min)</label>
              <input type="number" className="input-num-sm" min="5" max="30" value={p.gymDrive||10} onChange={e=>mk(()=>updP({gymDrive:+e.target.value}))}/>
            </div>
          </div>
          <div className="card">
            <SecHead icon="ti-mood-smile" title="Fun time targets"/>
            <div className="field-grid">
              <label>Weekday (hrs/day)</label>
              <div>
                <input type="number" className="input-num-sm" min="0" max="8" step="0.5" value={p.funWD} onChange={e=>mk(()=>updP({funWD:+e.target.value}))}/>
                <div className="field-hint">Mon–Fri · {(p.funWD*5).toFixed(1)}h total</div>
              </div>
              <label>Weekend (hrs/day)</label>
              <div>
                <input type="number" className="input-num-sm" min="0" max="12" step="0.5" value={p.funWE} onChange={e=>mk(()=>updP({funWE:+e.target.value}))}/>
                <div className="field-hint">Sat+Sun · {(p.funWE*2).toFixed(1)}h total</div>
              </div>
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
            {/* One field-grid for every row in this card — label column sized to the widest
                label here ("Or custom name"), so Quick select's button row and Which days?'s
                DayPick line up with the rest instead of only the plain text inputs matching. */}
            <div className="field-grid" style={{marginBottom:16}}>
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
              <label>Or custom name</label>
              <input value={nc.n} onChange={e=>setNc(c=>({...c,n:e.target.value}))} placeholder="e.g. Water plants"/>
              <label>Emoji</label>
              <input value={nc.e} onChange={e=>setNc(c=>({...c,e:e.target.value}))} style={{maxWidth:80}}/>
              <label>Which days?</label>
              <DayPick val={nc.days} onChange={days=>setNc(c=>({...c,days}))} col="var(--teal)"/>
              <label>Time (optional)</label>
              <input type="time" className="input-time" value={nc.time} onChange={e=>setNc(c=>({...c,time:e.target.value}))}/>
              <label>Duration (min)</label>
              <input type="number" className="input-num-sm" min="10" max="180" value={nc.dur} onChange={e=>setNc(c=>({...c,dur:+e.target.value}))}/>
            </div>
            <button className="btn btn-action" onClick={()=>{if(!nc.n||!nc.days.length)return;mk(()=>updP({chores:[...(p.chores||[]),{...nc,id:Date.now()}]}));setNc({n:"",e:"📋",days:[],time:"",dur:30});toast2("Chore added");}} disabled={!nc.n||!nc.days.length}>
              <i className="ti ti-plus"/> Add Chore
            </button>
          </div>
          <div style={{padding:"8px 12px",background:"var(--card2)",borderRadius:8,fontSize:12,color:"var(--t3)"}}>
            Changes saved as draft — use "Save &amp; Replan" to update your schedule.
          </div>
        </div>
      )}

      {sec==="notifs"&&(
        <div className="aligned-fields">
          <div className="card" style={{marginBottom:12}}>
            <SecHead icon="ti-bell" title="Browser Notifications"/>
            <p style={{fontSize:14,marginBottom:14,lineHeight:1.6}}>
              Get a browser notification for anything due today or in the next 2 days, and when it's time to start exam prep. Sent at most once per day, only while StudyOS is open in a tab.
            </p>
            {/* The master switch — same tinted-banner treatment as SMS Reminders' "SMS reminders
                are on / Turn off" row below, deliberately NOT the same plain field-grid style as
                the per-type toggle list underneath it: this is the gate that makes every one of
                those toggles meaningless if it's off, so it needs to read as a level above them,
                not just one more row in the list. Two independent things can make this "off":
                browser PERMISSION not granted (can't be toggled by us at all — only Notification
                .requestPermission()/the browser's own site settings can change it) or the app-level
                browserNotifsEnabled pause (a real Turn off/Turn on, exactly like SMS's smsEnabled,
                for a student who's already granted permission but wants one quick pause instead of
                hunting down three switches). Once granted, color+button track the pause state, not
                permission (which is now fixed); before that, they track permission itself. */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 14px",
              background:notifPerm==="denied"?"var(--red-bg)":notifPerm==="granted"&&p.browserNotifsEnabled!==false?"var(--green-bg)":"var(--card2)",
              borderRadius:9,marginBottom:16}}>
              <div style={{display:"flex",alignItems:"center",gap:8,fontSize:14,color:notifPerm==="denied"||(notifPerm==="granted"&&p.browserNotifsEnabled!==false)?"#fff":"var(--t1)"}}>
                <i className={`ti ${notifPerm==="denied"?"ti-circle-x":notifPerm==="granted"&&p.browserNotifsEnabled!==false?"ti-circle-check":"ti-bell"}`}
                  style={{color:notifPerm==="denied"?"var(--red)":notifPerm==="granted"&&p.browserNotifsEnabled!==false?"var(--green)":"var(--t3)"}}/>
                {notifPerm==="denied"?"Blocked — check your browser's site settings"
                  :notifPerm==="unsupported"?"Not supported in this browser"
                  :notifPerm!=="granted"?"Turn on browser notifications to get the reminders below"
                  :p.browserNotifsEnabled!==false?"Browser notifications are on"
                  :"Browser notifications are off"}
              </div>
              {notifPerm!=="granted"&&notifPerm!=="unsupported"&&notifPerm!=="denied"&&(
                <button className="btn btn-action btn-sm" onClick={enableNotifs}>
                  <i className="ti ti-bell"/> Enable
                </button>
              )}
              {notifPerm==="granted"&&(p.browserNotifsEnabled!==false?(
                <button className="btn btn-ghost btn-sm" onClick={disableBrowserNotifs}>Turn off</button>
              ):(
                <button className="btn btn-action btn-sm" onClick={enableBrowserNotifs}>Turn on</button>
              ))}
            </div>
            {notifPerm==="granted"&&p.browserNotifsEnabled!==false&&(
              // Same per-type toggle-row pattern as SMS Reminders below (title+sub-caption as one
              // right-aligned .align-col-stacked "label", a toggle-group as the field) — replaces
              // the single "Due-date reminders" switch, which actually gated 3 different behaviors
              // at once (daily priorities, session-start nudges, and break reminders — the last of
              // those from two separate code paths, one of which used to ignore it entirely). Real
              // requested split: each gets its own toggle now, same as SMS's Daily summary/Evening
              // check-in/Exam countdown rows.
              <div style={{marginBottom:14}}>
                {[
                  ["notifyBrowserPriorities","Daily priorities","Once a day — due dates & exam prep"],
                  ["notifyBrowserSessions","Session start reminders","When it's time to start a planned session"],
                  ["notifyBrowserBreaks","Break reminders","At break start & end, incl. the Focus Timer"],
                ].map(([key,label,sub],i,arr)=>(
                  <div key={key} className="field-grid" style={{padding:"9px 0",borderBottom:i<arr.length-1?"1px solid var(--b1)":"none"}}>
                    <div className="align-col-label align-col-flex align-col-stacked">
                      <div style={{fontSize:13,color:"var(--t1)"}}>{label}</div>
                      <div style={{fontSize:11,color:"var(--t3)"}}>{sub}</div>
                    </div>
                    <div className="toggle-group">
                      <button className={`toggle-opt${p[key]!==false?" on":""}`} onClick={()=>mk(()=>updP({[key]:true}))}>On</button>
                      <button className={`toggle-opt${p[key]===false?" on":""}`} onClick={()=>mk(()=>updP({[key]:false}))}>Off</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card" style={{marginBottom:12}}>
            <SecHead icon="ti-message-2" title="SMS Reminders"/>
            <p style={{fontSize:14,marginBottom:14,lineHeight:1.6}}>
              Text reminders to your phone: a daily summary (with any exam or project deadlines coming up built right in), an evening nudge for anything overdue, and any custom reminders you add below.
            </p>
            {/* Label + field on one line, same .aligned-fields treatment as every other
                Preferences tab now — this one field was the last holdout on the old
                label-above-field layout. The field cell holds the +1/input row AND the
                validation message together (a field-hint-style line), same pattern already used
                for Fun time targets' "Xh total" caption. */}
            <div className="field-grid" style={{marginBottom:14}}>
              <label className="align-col-label">Phone number</label>
              <div>
                {/* US-only, so +1 is fixed/shown outside the field rather than something the user
                    has to type themselves — the input only ever holds the 10 digits. Blur is the
                    explicit "Confirm Number" moment: nothing is flagged while still mid-typing,
                    but leaving the field with anything other than a complete 10-digit number
                    shows a real error rather than silently accepting it. */}
                <div style={{display:"flex",maxWidth:220}}>
                  <div style={{display:"flex",alignItems:"center",padding:"0 10px",background:"var(--card2)",
                    border:"1.5px solid var(--b1)",borderRight:"none",borderRadius:"8px 0 0 8px",
                    color:"var(--t2)",fontSize:16,flexShrink:0}}>+1</div>
                  <div style={{position:"relative",flex:1,minWidth:0}}>
                    <input type="tel" inputMode="numeric" value={p.phone?p.phone.replace(/^\+1/,""):""} maxLength={10}
                      onChange={e=>{
                        const digits=e.target.value.replace(/\D/g,"").slice(0,10);
                        setPhoneTouched(false);
                        mk(()=>{setAwaitingConfirm(false);updP({phone:digits?`+1${digits}`:""});});
                      }}
                      onBlur={()=>setPhoneTouched(true)}
                      placeholder="5551234567" style={{borderRadius:"0 8px 8px 0",paddingRight:30}}/>
                    {isValidUsPhone(p.phone)&&(
                      <i className="ti ti-circle-check-filled" style={{position:"absolute",right:11,top:"50%",transform:"translateY(-50%)",color:"var(--green)",fontSize:17,pointerEvents:"none"}}/>
                    )}
                  </div>
                </div>
                {phoneTouched&&p.phone&&!isValidUsPhone(p.phone)&&(
                  <div className="field-hint" style={{color:"var(--red)"}}>
                    <i className="ti ti-alert-circle" style={{marginRight:4}}/>Enter a full 10-digit number.
                  </div>
                )}
                {phoneTouched&&isValidUsPhone(p.phone)&&(
                  <div className="field-hint" style={{color:"var(--green)"}}>
                    <i className="ti ti-check" style={{marginRight:4}}/>Number confirmed.
                  </div>
                )}
              </div>
            </div>

            {/* A test text just went out — nothing is actually saved as "on" until the user
                confirms it arrived. Shared by both the first-time opt-in flow below and
                re-verifying a number changed after SMS was already on. */}
            {awaitingConfirm?(
              <div style={{background:"var(--amber-bg)",borderRadius:9,padding:"13px 15px",marginBottom:14}}>
                <div style={{fontSize:13,color:"var(--t1)",marginBottom:10,lineHeight:1.5}}>
                  <i className="ti ti-send" style={{marginRight:6,color:"var(--amber)"}}/>
                  Test text sent to {p.phone}. Did it arrive?
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button className="btn btn-action btn-sm" onClick={confirmVerified}>Yes, it arrived</button>
                  <button className="btn btn-ghost btn-sm" onClick={denyVerified}>No, let me fix it</button>
                </div>
              </div>
            ):!p.smsEnabled?(
              <>
                <div style={{fontSize:12,color:"var(--t3)",lineHeight:1.7,background:"var(--card2)",borderRadius:9,padding:"11px 13px",marginBottom:14}}>
                  Message frequency varies — typically up to a few texts a day. Message and data rates may apply. Reply <strong>STOP</strong> to any text to cancel, <strong>HELP</strong> for help. See our{" "}
                  <a href="/terms" target="_blank" rel="noopener noreferrer" style={{color:"var(--blue)"}}>Terms of Service</a>{" "}
                  and <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{color:"var(--blue)"}}>Privacy Policy</a>.
                  {" "}Opting in is entirely optional — StudyOS works the same either way.
                </div>
                <label style={{display:"flex",alignItems:"flex-start",gap:9,marginBottom:14,cursor:"pointer"}}>
                  <input type="checkbox" checked={smsConsent} onChange={e=>setSmsConsent(e.target.checked)}
                    style={{width:16,height:16,marginTop:2,flexShrink:0}}/>
                  <span style={{fontSize:13,color:"var(--t2)",lineHeight:1.5}}>I agree to receive SMS text messages from StudyOS at the number above.</span>
                </label>
                <button className="btn btn-action" onClick={startVerify} disabled={!p.phone||!smsConsent||smsBusy}>
                  {smsBusy?<><Sp sz={13}/> Sending...</>:<><i className="ti ti-message-2"/> Yes, text me reminders</>}
                </button>
              </>
            ):!phoneVerified?(
              // Number was changed since the last confirmed text — real reported gap: a typo'd
              // update used to just sit "enabled" with nothing to prove it actually works.
              <div style={{background:"var(--amber-bg)",borderRadius:9,padding:"13px 15px"}}>
                <div style={{fontSize:13,color:"var(--t1)",marginBottom:10,lineHeight:1.5}}>
                  <i className="ti ti-alert-triangle" style={{marginRight:6,color:"var(--amber)"}}/>
                  This number hasn't been verified yet — send a test text to confirm it works.
                </div>
                <button className="btn btn-action btn-sm" onClick={startVerify} disabled={smsBusy}>
                  {smsBusy?<><Sp sz={13}/> Sending...</>:<><i className="ti ti-send"/> Verify this number</>}
                </button>
              </div>
            ):(
              <>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 14px",background:"var(--green-bg)",borderRadius:9,marginBottom:12}}>
                  {/* Text white, icon green — same tinted-bg fix as the banners above, applied
                      consistently here too rather than leaving this one status row as the odd
                      one out. */}
                  <div style={{display:"flex",alignItems:"center",gap:8,fontSize:14,color:"#fff"}}>
                    <i className="ti ti-circle-check" style={{color:"var(--green)"}}/> SMS reminders are on
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={disableSms}>Turn off</button>
                </div>
                <div style={{marginBottom:14}}>
                  {/* Both real, automatic scheduled sends (app/api/cron/daily-summary,
                      app/api/cron/evening-checkin — see .github/workflows/scheduled-reminders.yml).
                      There used to be a third row here, Exam / project countdown, for a standalone
                      send that never got built — removed once the decision was made to fold that
                      content into Daily summary's own message instead (lib/sms/dailySummary.js),
                      rather than leave a "coming soon" toggle around indefinitely for a feature not
                      actually being built as its own send. */}
                  {/* Real reported gap: these rows used to use a full-width flush-left/flush-right
                      layout, completely ignoring the aligned-fields column every other field on
                      this tab (Phone number included) lands on — measured live: titles at the
                      card's left edge, toggles at the right edge, neither anywhere near the ~40%
                      line. .align-col-label + .align-col-flex is the same pattern Meal times uses
                      for a non-<label> "label" (title stacked over its sub-caption, right-aligned
                      as one block); the toggle-group is the field. */}
                  {[
                    ["notifyDailySummary","Daily summary","8:30am — today's plan"],
                    ["notifyPastDueNudge","Evening check-in","8:00pm — reminder to report completion"],
                  ].map(([key,label,sub],i,arr)=>(
                    <div key={key} className="field-grid" style={{padding:"9px 0",borderBottom:i<arr.length-1?"1px solid var(--b1)":"none"}}>
                      <div className="align-col-label align-col-flex align-col-stacked">
                        <div style={{fontSize:13,color:"var(--t1)"}}>{label}</div>
                        <div style={{fontSize:11,color:"var(--t3)"}}>{sub}</div>
                      </div>
                      <div className="toggle-group">
                        <button className={`toggle-opt${p[key]!==false?" on":""}`} onClick={()=>mk(()=>updP({[key]:true}))}>On</button>
                        <button className={`toggle-opt${p[key]===false?" on":""}`} onClick={()=>mk(()=>updP({[key]:false}))}>Off</button>
                      </div>
                    </div>
                  ))}
                </div>
                <button className="btn btn-ghost" onClick={sendTestSms} disabled={smsBusy}>
                  {smsBusy?<><Sp sz={13}/> Sending...</>:<><i className="ti ti-send"/> Send me a test text</>}
                </button>
                <div style={{fontSize:11,color:"var(--t3)",marginTop:10,lineHeight:1.5}}>
                  The 8:30am and 8:00pm sends are scheduled server-side and go out automatically — this button just proves the connection works right now. Reply STOP to any text, or turn off above, any time.
                </div>
              </>
            )}
          </div>

          <div className="card">
            <SecHead icon="ti-alarm" title="Custom reminders"/>
            <p style={{fontSize:13,color:"var(--t3)",marginBottom:12,lineHeight:1.6}}>
              One-off texts for anything specific — fires once at the date/time you set, then stays here marked "sent." Needs SMS reminders on and a phone number above.
            </p>
            {(p.customReminders||[]).length>0&&(
              <div style={{marginBottom:14}}>
                {(p.customReminders||[]).slice().sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)).map(r=>(
                  <div key={r.id} className="list-item">
                    <div style={{flex:1}}>
                      <div className="list-item-title" style={{textDecoration:r.sent?"line-through":"none",color:r.sent?"var(--t3)":"var(--t1)"}}>{r.text}</div>
                      <div className="list-item-sub">{r.date} · {f12(r.time)}{r.sent?" · sent":""}</div>
                    </div>
                    <DelBtn onClick={()=>updP({customReminders:p.customReminders.filter(x=>x.id!==r.id)})}/>
                  </div>
                ))}
              </div>
            )}
            <div className="field-grid" style={{marginBottom:16}}>
              <label>Remind me about...</label>
              <input value={ncReminder.text} onChange={e=>setNcReminder(r=>({...r,text:e.target.value}))} placeholder="e.g. Bring lab notebook to discussion section"/>
              <label>Date</label>
              <input type="date" className="input-date" min={iso()} value={ncReminder.date} onChange={e=>setNcReminder(r=>({...r,date:e.target.value}))}/>
              <label>Time</label>
              <input type="time" className="input-time" value={ncReminder.time} onChange={e=>setNcReminder(r=>({...r,time:e.target.value}))}/>
            </div>
            <button className="btn btn-action" onClick={addCustomReminder} disabled={!ncReminder.text||!ncReminder.date}>
              <i className="ti ti-plus"/> Add reminder
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
