import { useState } from "react";
import { iso, t2m, sundayOf, fmtWeekRange } from "@/lib/time";
import { GYM0, getTermRange } from "@/lib/data";
import { weekHasBeenPlanned, realDayBlocks, weekStartOf } from "@/lib/calendar";
import { Sp, SecHead, useConfirm, Timeline, WeekGrid } from "@/components/shared";
import { PlanDrawer } from "@/components/PlanDrawer";

// ── WEEK ─────────────────────────────────────────────────────────────────────
export function Week({data,upd,ai,busy,planning,toast2,refreshQuarterPlan,refreshWeekPlan,planMsg,planDrawerOpen,setPlanDrawerOpen}){
  const {confirm,modal}=useConfirm();
  const [selDay,setSel]=useState(null);
  const [mode,setMode]=useState("week");
  const [editState,setEditState]=useState(null); // {dateStr, block|null} — lifted up from WeekGrid so the Add Activity button can live in this header row, next to Clear plan/Refresh Plan
  const [replanMenu,setReplanMenu]=useState(false); // the Replan split-button's ▾ menu
  const p=data.profile;

  // Clear the generated study plan from today forward — extracted from the old inline onClick so
  // the Replan menu can call it. Past days (history) are never touched.
  async function clearPlan(){
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
        toast2("Study plan fully cleared from today forward. History was kept. Hit Replan to regenerate.");
        return;
      }
    }
    toast2(`Study plan cleared from today forward${toKeep>0?` — kept ${toKeep} edited block${toKeep!==1?"s":""}.`:"."} History was kept. Hit Replan to regenerate.`);
  }

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
      {/* ── Weekly nav bar ─────────────────────────────────────────────────────
          Three groups: view mode (left) · week navigation (centre) · plan actions (right). */}
      <div className="card" style={{padding:"8px 12px",marginBottom:10}}>
        <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>

          {/* View mode — segmented control */}
          <div style={{display:"inline-flex",borderRadius:8,border:"1px solid var(--b1)",overflow:"hidden",flexShrink:0}}>
            {[["week","Schedule"],["balance","Time"]].map(([m,l])=>(
              <button key={m} onClick={()=>setMode(m)}
                style={{padding:"6px 13px",fontSize:13,border:"none",cursor:"pointer",fontFamily:"inherit",
                  background:mode===m?"var(--amber-bg)":"var(--card2)",
                  color:mode===m?"var(--amber)":"var(--t3)"}}>
                {l}
              </button>
            ))}
          </div>

          {/* Week navigation — arrows + dropdown, centred. Fixed-width dropdown and an
              always-present "jump to this week" button so nothing reflows as you page weeks. */}
          {termWeeks.length>0?(
            <div style={{display:"flex",alignItems:"center",gap:4,margin:"0 auto"}}>
              <button className="btn btn-ghost btn-sm tt" data-tt="Previous week" style={{padding:"6px 9px",fontSize:15}}
                onClick={()=>setSelWeekIdx(i=>Math.max(0,i-1))} disabled={atFirst}>
                <i className="ti ti-chevron-left"/>
              </button>
              <select value={clampedIdx} onChange={e=>setSelWeekIdx(+e.target.value)}
                style={{fontSize:13,padding:"6px 8px",width:300,textAlign:"center",fontFamily:"inherit",
                  background:isCurrentWeek?"var(--amber-bg)":"var(--card2)",
                  color:isCurrentWeek?"var(--amber)":"var(--t1)",
                  fontWeight:isCurrentWeek?600:400,
                  border:"1px solid var(--b1)",borderRadius:7,cursor:"pointer"}}>
                {termWeeks.map((w,i)=>(
                  <option key={w.index} value={i}>
                    {w.start.getTime()===todaySunday.getTime()?"This week · ":""}Week {w.index} of {termWeeks.length} · {fmtWeekRange(w.start)}
                  </option>
                ))}
              </select>
              <button className="btn btn-ghost btn-sm tt" data-tt="Next week" style={{padding:"6px 9px",fontSize:15}}
                onClick={()=>setSelWeekIdx(i=>Math.min(termWeeks.length-1,i+1))} disabled={atLast}>
                <i className="ti ti-chevron-right"/>
              </button>
              {/* "Activated" state = amber (app-wide convention for a non-action toggle/relevance
                  state — see CLAUDE.md). This is relevant only when you're viewing another week. */}
              <button className="btn btn-ghost btn-sm tt" data-tt="Jump to the current week"
                style={{padding:"6px 9px",fontSize:15,color:isCurrentWeek?"var(--t3)":"var(--amber)"}}
                onClick={()=>setSelWeekIdx(defaultIdx)} disabled={isCurrentWeek}>
                <i className="ti ti-calendar-due"/>
              </button>
            </div>
          ):(
            <div style={{fontSize:12,color:"var(--t3)",margin:"0 auto"}}>
              Set your term dates in <b>Settings → School Info</b> to browse the full term.
            </div>
          )}

          {/* Plan actions */}
          <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
            <button className="btn btn-sm btn-ghost tt tt-below" data-tt="Add a one-off activity to today" style={{padding:"6px 9px"}}
              onClick={()=>setEditState({dateStr:iso(),block:null})}>
              <i className="ti ti-plus" style={{fontSize:15}}/>
            </button>
            <button className="btn btn-sm btn-ghost tt tt-below" data-tt="Plan status & diagnostics" style={{padding:"6px 9px"}}
              onClick={()=>setPlanDrawerOpen(true)}>
              <i className="ti ti-stethoscope" style={{fontSize:15}}/>
            </button>

            {/* Replan split-button: primary = whole-term replan; ▾ = scope + clear */}
            <div style={{display:"flex",position:"relative",flexShrink:0}}>
              <button className="btn btn-sm tt tt-below tt-right"
                data-tt="Re-plan every day from this week through the end of your term"
                style={{background:"var(--red)",color:"#fff",borderRadius:"7px 0 0 7px"}}
                onClick={refreshQuarterPlan} disabled={planning}>
                {planning?<><Sp sz={12}/> Planning...</>:<><i className="ti ti-sparkles"/> Replan</>}
              </button>
              <button className="tt tt-below tt-right" data-tt="Replan options"
                onClick={()=>setReplanMenu(o=>!o)} disabled={planning}
                style={{background:"var(--red)",color:"#fff",border:"none",borderLeft:"1px solid rgba(255,255,255,0.28)",
                  borderRadius:"0 7px 7px 0",padding:"0 8px",cursor:"pointer",fontSize:12,display:"flex",alignItems:"center"}}>
                <i className="ti ti-chevron-down"/>
              </button>
              {replanMenu&&(
                <>
                  <div onClick={()=>setReplanMenu(false)} style={{position:"fixed",inset:0,zIndex:60}}/>
                  <div style={{position:"absolute",right:0,top:"calc(100% + 6px)",zIndex:61,minWidth:210,
                    background:"var(--card)",border:"1px solid var(--b1)",borderRadius:9,padding:5,
                    boxShadow:"0 12px 30px rgba(0,0,0,0.4)"}}>
                    <button className="btn btn-ghost btn-sm" style={{width:"100%",justifyContent:"flex-start"}}
                      onClick={()=>{setReplanMenu(false);refreshWeekPlan(weekKey);}} disabled={busy}>
                      <i className="ti ti-refresh"/> {isWeekPlanned?"Replan this week only":"Plan this week only"}
                    </button>
                    <button className="btn btn-ghost btn-sm" style={{width:"100%",justifyContent:"flex-start"}}
                      onClick={()=>{setReplanMenu(false);refreshQuarterPlan();}} disabled={planning}>
                      <i className="ti ti-sparkles"/> Replan whole term
                    </button>
                    <div style={{borderTop:"1px solid var(--b1)",margin:"4px 0"}}/>
                    <button className="btn btn-ghost btn-sm" style={{width:"100%",justifyContent:"flex-start",color:"var(--amber)"}}
                      onClick={()=>{setReplanMenu(false);clearPlan();}}>
                      <i className="ti ti-calendar-off"/> Clear plan (today forward)
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

        </div>
        {planning&&planMsg&&(
          <div style={{fontSize:11,color:"var(--t3)",marginTop:7,textAlign:"right"}}>{planMsg}</div>
        )}
      </div>
      {modal}
      <PlanDrawer open={planDrawerOpen} onClose={()=>setPlanDrawerOpen(false)} data={data}/>

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
