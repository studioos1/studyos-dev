import { useState } from "react";
import { t2m, f12, iso } from "@/lib/time";
import { DS, DF } from "@/lib/constants";
import { GYM0, CHORE_PRESETS, ED, uid } from "@/lib/data";
import { supabase } from "@/lib/supabase";
import { useConfirm, SecHead, DelBtn, DayPick, Sp } from "@/components/shared";

// ── SETTINGS ─────────────────────────────────────────────────────────────────
export function Sett({data,upd,updP,toast2,refreshQuarterPlan,planMsg,busy,planning}){
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

  // SMS reminders (B-11 Phase 1) — this "send now" call proves the pipe works end-to-end; the
  // scheduled 8:30/12:00/18:00 sends are a separate server-side cron job (Phase 2), not this route.
  const [smsBusy,setSmsBusy]=useState(false);
  const [smsConsent,setSmsConsent]=useState(false); // the opt-in checkbox — always starts unchecked, never persisted
  function enableSms(){
    if(!p.phone||!smsConsent)return;
    updP({smsEnabled:true,smsConsentAt:new Date().toISOString()});
    setSmsConsent(false);
    toast2("SMS reminders on");
  }
  function disableSms(){updP({smsEnabled:false});toast2("SMS reminders off");}
  async function sendTestSms(){
    if(!p.phone){toast2("Add a phone number first",true);return;}
    setSmsBusy(true);
    try{
      const {data:{session}}=await supabase.auth.getSession();
      const res=await fetch("/api/sms/send",{
        method:"POST",
        headers:{"Content-Type":"application/json",Authorization:`Bearer ${session?.access_token||""}`},
        body:JSON.stringify({to:p.phone,message:"StudyOS test message — SMS reminders are working! 🎓"}),
      });
      const j=await res.json();
      if(!res.ok||j.error)throw new Error(j.error||"Couldn't send the test text");
      toast2("Test text sent — check your phone!");
    }catch(err){toast2(err.message,true);}
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

          <div className="card" style={{marginBottom:12}}>
            <SecHead icon="ti-message-2" title="SMS Reminders"/>
            <p style={{fontSize:14,marginBottom:14,lineHeight:1.6}}>
              Text reminders to your phone: a daily summary, a nudge for anything overdue, an exam/project countdown, and any custom reminders you add below.
            </p>
            <div style={{marginBottom:14}}>
              <label>Phone number</label>
              <input type="tel" value={p.phone} onChange={e=>mk(()=>updP({phone:e.target.value}))} placeholder="+1 555 123 4567"/>
            </div>

            {!p.smsEnabled?(
              <>
                <div style={{fontSize:12,color:"var(--t3)",lineHeight:1.7,background:"var(--card2)",borderRadius:9,padding:"11px 13px",marginBottom:14}}>
                  Message frequency varies — typically up to a few texts a day. Message and data rates may apply. Reply <strong>STOP</strong> to any text to cancel, <strong>HELP</strong> for help. See our{" "}
                  <a href="/terms" target="_blank" rel="noopener noreferrer" style={{color:"var(--blue)"}}>Terms of Service</a>{" "}
                  and <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{color:"var(--blue)"}}>Privacy Policy</a>.
                </div>
                <label style={{display:"flex",alignItems:"flex-start",gap:9,marginBottom:14,cursor:"pointer"}}>
                  <input type="checkbox" checked={smsConsent} onChange={e=>setSmsConsent(e.target.checked)}
                    style={{width:16,height:16,marginTop:2,flexShrink:0}}/>
                  <span style={{fontSize:13,color:"var(--t2)",lineHeight:1.5}}>I agree to receive SMS text messages from StudyOS at the number above.</span>
                </label>
                <button className="btn btn-action" style={{width:"100%"}} onClick={enableSms} disabled={!p.phone||!smsConsent}>
                  <i className="ti ti-message-2"/> Yes, text me reminders
                </button>
              </>
            ):(
              <>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 14px",background:"var(--green-bg)",borderRadius:9,marginBottom:12}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,fontSize:14,color:"var(--green)"}}>
                    <i className="ti ti-circle-check"/> SMS reminders are on
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={disableSms}>Turn off</button>
                </div>
                <div style={{marginBottom:14}}>
                  {[
                    ["notifyDailySummary","Daily summary","8:30am — today's plan"],
                    ["notifyPastDueNudge","Past-due nudge","6:00pm — anything overdue, not marked done"],
                    ["notifyExamCountdown","Exam / project countdown","12:00pm — starting 7 days out"],
                  ].map(([key,label,sub])=>(
                    <div key={key} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"9px 0",borderBottom:"1px solid var(--b1)"}}>
                      <div>
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
                <button className="btn btn-ghost" style={{width:"100%"}} onClick={sendTestSms} disabled={smsBusy}>
                  {smsBusy?<><Sp sz={13}/> Sending...</>:<><i className="ti ti-send"/> Send me a test text</>}
                </button>
                <div style={{fontSize:11,color:"var(--t3)",marginTop:10,lineHeight:1.5}}>
                  The 8:30/12:00/6:00 sends are scheduled server-side and go out automatically — this button just proves the connection works right now. Reply STOP to any text, or turn off above, any time.
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
            <div style={{marginBottom:10}}>
              <label>Remind me about...</label>
              <input value={ncReminder.text} onChange={e=>setNcReminder(r=>({...r,text:e.target.value}))} placeholder="e.g. Bring lab notebook to discussion section"/>
            </div>
            <div className="g2" style={{marginBottom:12}}>
              <div><label>Date</label><input type="date" min={iso()} value={ncReminder.date} onChange={e=>setNcReminder(r=>({...r,date:e.target.value}))}/></div>
              <div><label>Time</label><input type="time" value={ncReminder.time} onChange={e=>setNcReminder(r=>({...r,time:e.target.value}))}/></div>
            </div>
            <button className="btn btn-action" style={{width:"100%"}} onClick={addCustomReminder} disabled={!ncReminder.text||!ncReminder.date}>
              <i className="ti ti-plus"/> Add reminder
            </button>
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
