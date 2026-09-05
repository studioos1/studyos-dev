import { useState } from "react";
import { iso, t2m, sundayOf, fmtWeekRange } from "@/lib/time";
import { GYM0, getTermRange } from "@/lib/data";
import { weekHasBeenPlanned, realDayBlocks, weekStartOf } from "@/lib/calendar";
import { Sp, SecHead, useConfirm, Timeline, WeekGrid } from "@/components/shared";

// ── WEEK ─────────────────────────────────────────────────────────────────────
export function Week({data,upd,ai,busy,planning,toast2,refreshQuarterPlan,refreshWeekPlan,planMsg}){
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
