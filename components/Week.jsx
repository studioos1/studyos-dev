import { useState, useRef, useEffect } from "react";
import { iso, t2m, sundayOf, fmtWeekRange } from "@/lib/time";
import { GYM0, getTermRange } from "@/lib/data";
import { weekHasBeenPlanned, realDayBlocks, weekStartOf, buildBlocks, tc, saveBlockToDay, deleteBlockFromDay, logCompletion } from "@/lib/calendar";
import { Sp, SecHead, useConfirm, Timeline, WeekGrid, BlockEditModal, DayAgenda } from "@/components/shared";
import { PlanDrawer } from "@/components/PlanDrawer";

// ── WEEK ─────────────────────────────────────────────────────────────────────
export function Week({data,upd,ai,busy,planning,toast2,refreshQuarterPlan,refreshWeekPlan,planMsg,planDrawerOpen,setPlanDrawerOpen}){
  const {confirm,modal}=useConfirm();
  // Sub-project: Web-Mobile Enablement item #2 — the 7-column time-block grid genuinely can't fit
  // a phone screen (each day column would be well under 50px). Default straight into "agenda"
  // mode (expandable week cards — see the agenda branch below) on narrow screens instead of
  // forcing the grid; desktop is unaffected since window.innerWidth there is always above the
  // breakpoint. "day" mode is a separate thing, kept as-is: the single-day drill-down reached by
  // tapping a cell in the full grid (WeekGrid's onDay), on either desktop or mobile.
  const isNarrow=typeof window!=="undefined"&&window.innerWidth<768;
  const [selDay,setSel]=useState(iso()); // "day" mode's day, and month view's selected day
  const [mode,setMode]=useState(()=>isNarrow?"month":"week");
  const [editState,setEditState]=useState(null); // {dateStr, block|null} — lifted up from WeekGrid so the Add Activity button can live in this header row, next to Clear plan/Refresh Plan
  const [replanMenu,setReplanMenu]=useState(false); // the Replan split-button's ▾ menu
  const p=data.profile;

  // Month view's calendar pane auto-scrolls to the current month on open — a hook, so it must be
  // called unconditionally every render (not inside the "month" branch below) per rules of hooks;
  // the body itself just no-ops when mode isn't "month".
  const monthScrollRef=useRef(null);
  useEffect(()=>{
    if(mode!=="month")return;
    const key=`${new Date().getFullYear()}-${new Date().getMonth()}`;
    monthScrollRef.current?.querySelector(`[data-month="${key}"]`)?.scrollIntoView({block:"start"});
  },[mode]);

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
    upd({studyPlan:{weeks:keptWeeks},quarterPlan:null,briefCache:null,briefPeriod:null});
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

  // Sunday-start week list for the active term. Real request: "once user create new term...
  // the calendar shall be set for all the weeks of the term" — this drives calendar BROWSING
  // (which weeks/months are listed, which days are clickable at all), so it uses the term's own
  // typed start/end dates directly (getTermRange), not planningRange()'s deadline-anchored
  // horizon. Those are two different concerns that used to share one range by mistake: a
  // freshly-synced term with only its first few items entered (a real, reported bug — 4 early
  // admin-task due dates, no exams yet) had its ENTIRE calendar chopped down to just those few
  // days, with days genuinely inside the term unreachable. planningRange's deadline-anchoring is
  // still exactly right for the actual AI planning horizon (refreshQuarterPlan in App.jsx) —
  // avoiding a long empty tail after the last final when Term End was mistyped — it just never
  // belonged here.
  const termRange=getTermRange(data.profile);
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

  if(mode==="day")return(
    <div className="fade">
      <div className="row" style={{marginBottom:4,justifyContent:"space-between"}}>
        <span style={{fontSize:12,color:"var(--t3)"}}>Week of {rangeLabel}</span>
        <button className="btn btn-ghost btn-sm" onClick={()=>setMode("week")}>Full grid <i className="ti ti-layout-grid"/></button>
      </div>
      {/* Day-picker strip — without this, day mode was just a lone Timeline that read as "Today
          again", not "the Week tab". This makes the week context visible and lets you switch
          days without leaving to the 7-column grid at all. */}
      <div style={{display:"flex",gap:6,marginBottom:14,overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
        {Array.from({length:7},(_,i)=>{
          const d=new Date(weekStart);d.setDate(d.getDate()+i);
          const ds=iso(d);
          const isSel=ds===selDay,isToday=ds===iso();
          return(
            <button key={ds} onClick={()=>setSel(ds)}
              style={{flex:"1 0 0",minWidth:40,padding:"7px 4px",borderRadius:10,
                border:isToday?"1px solid var(--blue)":"1px solid transparent",
                background:isSel?"var(--amber-bg)":"var(--card2)",color:isSel?"var(--amber)":"var(--t2)",
                cursor:"pointer",fontFamily:"inherit",textAlign:"center"}}>
              <div style={{fontSize:10,textTransform:"uppercase",opacity:0.7}}>{d.toLocaleDateString("en-US",{weekday:"short"})}</div>
              <div style={{fontSize:15,fontWeight:600}}>{d.getDate()}</div>
            </button>
          );
        })}
      </div>
      <div className="row" style={{marginBottom:16}}>
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

  // ── MONTH — mobile default (<768px). A phone genuinely can't show "a week" as a useful unit —
  // replaces the earlier expandable-week-cards concept entirely, not just tunes it. Apple-
  // Calendar-style instead: a month grid, scrollable up/down through every month in the term (no
  // per-week paging, no "Full grid" escape hatch to a view with no way back — the grid simply
  // isn't offered on mobile at all now). Tapping any day selects it and shows its activities in a
  // fixed panel below — a real two-pane split, not a long page, so the day detail never needs
  // hunting for. Auto-scrolls to the current month on open (see the useEffect above). ──
  if(mode==="month"){
    const today=iso();
    const monthsList=(()=>{
      const out=[];
      let start,end;
      if(termRange){
        start=new Date(termRange.start+"T12:00:00");
        end=new Date(termRange.end+"T12:00:00");
      }else{
        const now=new Date();
        start=new Date(now.getFullYear(),now.getMonth()-1,1);
        end=new Date(now.getFullYear(),now.getMonth()+1,1);
      }
      let cur=new Date(start.getFullYear(),start.getMonth(),1);
      const last=new Date(end.getFullYear(),end.getMonth(),1);
      let guard=0;
      while(cur<=last&&guard<36){ // 36-month hard cap, safety valve — matches termWeeks' pattern above
        out.push({year:cur.getFullYear(),month:cur.getMonth()});
        cur=new Date(cur.getFullYear(),cur.getMonth()+1,1);
        guard++;
      }
      return out;
    })();
    const monthGridDays=(year,month)=>{
      const first=new Date(year,month,1);
      const last=new Date(year,month+1,0);
      const gridStart=new Date(first);gridStart.setDate(gridStart.getDate()-gridStart.getDay());
      const gridEnd=new Date(last);gridEnd.setDate(gridEnd.getDate()+(6-gridEnd.getDay()));
      const days=[];
      for(let d=new Date(gridStart);d<=gridEnd;d.setDate(d.getDate()+1))days.push(new Date(d));
      return days;
    };
    // Which activity types earn a dot marker under a day's number — routine/filler ones (sleep,
    // commute, meals) are on every in-term day regardless of anything actually being scheduled,
    // so they'd just add noise rather than signal; these are the ones worth knowing about at a
    // glance, same idea as Apple Calendar's dots representing actual events, not routine state.
    const NOTABLE_TYPES=["class","study","homework","project","gym","exam","chore","fun","deadline"];

    return(
      <div className="fade" style={{height:"calc(100vh - 90px)",display:"flex",flexDirection:"column"}}>
        {/* Calendar pane — its own scroll, independent of the day-detail pane below */}
        <div ref={monthScrollRef} style={{flex:"0 0 46%",overflowY:"auto",WebkitOverflowScrolling:"touch",
          borderBottom:"1px solid var(--b1)",paddingBottom:8}}>
          <div style={{position:"sticky",top:0,zIndex:1,display:"grid",gridTemplateColumns:"repeat(7,1fr)",
            background:"var(--bg)",padding:"2px 0 4px"}}>
            {["S","M","T","W","T","F","S"].map((l,i)=>(
              <div key={i} style={{textAlign:"center",fontSize:13,color:"var(--t3)",fontWeight:600}}>{l}</div>
            ))}
          </div>
          {monthsList.map(({year,month})=>(
            <div key={`${year}-${month}`} data-month={`${year}-${month}`} style={{marginBottom:14}}>
              <div style={{fontSize:13,fontWeight:600,color:"var(--t2)",padding:"6px 4px"}}>
                {new Date(year,month,1).toLocaleDateString("en-US",{month:"long",year:"numeric"})}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2}}>
                {monthGridDays(year,month).map(d=>{
                  const ds=iso(d);
                  const inMonth=d.getMonth()===month;
                  // Leading/trailing days from adjacent months fill out the grid to whole weeks,
                  // but each month is its own scrollable section here (unlike a single-month
                  // paged calendar) — that adjacent month gets its own full grid right above or
                  // below, so showing its dates again here would just be a dim, non-interactive
                  // preview of it. Left blank instead, keeping the grid's alignment intact.
                  if(!inMonth)return<div key={ds}/>;
                  const isToday=ds===today;
                  const isSel=ds===selDay;
                  // Outside the actual term (not just outside this calendar month) — no data
                  // exists for these days, so they're disabled rather than clickable-but-empty.
                  // A day merely from an adjacent month but still inside the term (e.g. the first
                  // few days of next month trailing off this grid) stays fully interactive.
                  const outOfTerm=!!termRange&&(ds<termRange.start||ds>termRange.end);
                  const dotTypes=outOfTerm?[]:
                    Array.from(new Set(buildBlocks(ds,data,realDayBlocks(data,ds)).map(b=>b.type)))
                      .filter(t=>NOTABLE_TYPES.includes(t)).slice(0,4);
                  return(
                    <button key={ds} onClick={()=>setSel(ds)} disabled={outOfTerm}
                      style={{aspectRatio:"1",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
                        gap:2,border:"none",cursor:outOfTerm?"default":"pointer",fontFamily:"inherit",borderRadius:8,
                        background:isSel?"var(--amber-bg)":"transparent"}}>
                      {/* Today = a solid filled circle around the date number (Apple Calendar's
                          convention); selection is a separate, lighter cue (the cell's own amber
                          tint above) so a day can be both at once without the two fighting. */}
                      <span style={{width:26,height:26,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",
                        fontSize:14,fontWeight:isToday?700:400,
                        background:isToday?"var(--amber)":"transparent",
                        color:isToday?"var(--bg)":outOfTerm?"var(--t3)":isSel?"var(--amber)":"var(--t1)",
                        opacity:outOfTerm?0.3:1}}>
                        {d.getDate()}
                      </span>
                      <div style={{display:"flex",gap:2,height:4}}>
                        {dotTypes.map(t=>(
                          <span key={t} style={{width:4,height:4,borderRadius:"50%",background:tc(t).line}}/>
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Day-detail pane — always on screen, independently scrollable if that day runs long */}
        <div style={{flex:"1 1 auto",overflowY:"auto",WebkitOverflowScrolling:"touch",paddingTop:12}}>
          <div className="row" style={{marginBottom:10,justifyContent:"space-between"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>
              <h2 style={{fontSize:17,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                {new Date(selDay+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}
              </h2>
              {selDay===today&&<span className="badge badge-blue" style={{flexShrink:0}}>Today</span>}
            </div>
            {/* Actions for the selected day/week — the desktop grid's toolbar (Add activity, plan
                diagnostics, Replan) isn't reachable from month view at all otherwise, since there's
                no path from here into that toolbar. Scoped to selDay, not "today" — matches what
                you're actually looking at. marginRight keeps the group off the pane's true edge. */}
            <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0,marginRight:6}}>
              <button className="tt tt-below tt-right icon-btn-28" data-tt="Add activity to this day"
                style={{borderRadius:"50%",border:"1px solid var(--b1)",background:"var(--card2)",color:"var(--t2)",
                  cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0}}
                onClick={()=>setEditState({dateStr:selDay,block:null})}>
                <i className="ti ti-plus" style={{fontSize:14}}/>
              </button>
              <button className="tt tt-below tt-right icon-btn-28" data-tt="Plan status & diagnostics"
                style={{borderRadius:"50%",border:"1px solid var(--b1)",background:"var(--card2)",color:"var(--t2)",
                  cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0,position:"relative"}}
                onClick={()=>setPlanDrawerOpen(true)}>
                <i className="ti ti-stethoscope" style={{fontSize:14}}/>
                {data.planStale&&<span style={{position:"absolute",top:1,right:2,width:6,height:6,borderRadius:"50%",background:"var(--amber)"}}/>}
              </button>
              <div style={{display:"flex",position:"relative"}}>
                <button className="tt tt-below tt-right" data-tt="Replan this day's week"
                  style={{background:"var(--red)",color:"#fff",border:"none",borderRadius:"14px 0 0 14px",
                    width:28,height:28,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0}}
                  onClick={()=>refreshWeekPlan(weekStartOf(selDay))} disabled={planning}>
                  {planning?<Sp sz={12}/>:<i className="ti ti-sparkles" style={{fontSize:13}}/>}
                </button>
                <button className="tt tt-below tt-right" data-tt="More replan options"
                  onClick={()=>setReplanMenu(o=>!o)} disabled={planning}
                  style={{background:"var(--red)",color:"#fff",border:"none",borderLeft:"1px solid rgba(255,255,255,0.28)",
                    borderRadius:"0 14px 14px 0",width:20,height:28,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>
                  <i className="ti ti-chevron-down" style={{fontSize:11}}/>
                </button>
                {replanMenu&&(
                  <>
                    <div onClick={()=>setReplanMenu(false)} style={{position:"fixed",inset:0,zIndex:60}}/>
                    <div style={{position:"absolute",right:0,top:"calc(100% + 6px)",zIndex:61,minWidth:200,
                      background:"var(--card)",border:"1px solid var(--b1)",borderRadius:9,padding:5,
                      boxShadow:"0 12px 30px rgba(0,0,0,0.4)"}}>
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
          {/* DayAgenda (components/shared) is the single source of truth for "what does this day's
              schedule look like" — also used by Today's "View day calendar" modal, so a day
              renders identically no matter which surface you're looking at it from. It already
              shows its own "not planned yet" banner; no action button needed here since it'd only
              duplicate the Replan icon above. */}
          <DayAgenda data={data} dateStr={selDay}/>
        </div>
        {editState&&(
          <BlockEditModal
            dateStr={editState.dateStr}
            block={editState.block}
            courses={data.courses}
            onSave={(d,b)=>saveBlockToDay(data,upd,d,b)}
            onDelete={editState.block?(d,id)=>deleteBlockFromDay(data,upd,d,id):null}
            onComplete={entry=>logCompletion(data,upd,entry)}
            onClose={()=>setEditState(null)}
          />
        )}
        <PlanDrawer open={planDrawerOpen} onClose={()=>setPlanDrawerOpen(false)} data={data} upd={upd} refreshQuarterPlan={refreshQuarterPlan}/>
      </div>
    );
  }

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
  const homeworkH=weekPlacedAll.filter(b=>b.kind==="homework"||b.kind==="project").reduce((s,b)=>s+(b.e-b.s),0)/60;
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
              {/* Real request: the native dropdown arrow sits flush against the box's right edge
                  — move it in slightly, nothing more. Plain right-padding (tried first) doesn't
                  actually move it: Chrome reserves a fixed-width native arrow gutter regardless
                  of padding, it only pushes the (centered) text further from it. A custom SVG
                  arrow via appearance:none was tried next, but split across separate
                  background/backgroundImage/backgroundRepeat/backgroundPosition style keys — that
                  produced multiple stray arrows on a real browser (React sets each as its own
                  style-object write; background's shorthand-implied reset raced the later
                  longhand writes intended to override it). This time the exact same technique is
                  expressed as ONE background shorthand string — color, image, no-repeat and
                  position all in a single value — so there's no separate shorthand/longhand pair
                  left to race at all. */}
              <select value={clampedIdx} onChange={e=>setSelWeekIdx(+e.target.value)}
                style={{fontSize:13,padding:"6px 24px 6px 8px",width:300,textAlign:"center",fontFamily:"inherit",
                  background:`${isCurrentWeek?"var(--amber-bg)":"var(--card2)"} url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6' fill='none'%3E%3Cpath d='M1 1L5 5L9 1' stroke='${encodeURIComponent(isCurrentWeek?"#cf9a48":"#6a8aaa")}' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right 10px center`,
                  color:isCurrentWeek?"var(--amber)":"var(--t1)",
                  fontWeight:isCurrentWeek?600:400,
                  border:"1px solid var(--b1)",borderRadius:7,cursor:"pointer",
                  appearance:"none",WebkitAppearance:"none",MozAppearance:"none"}}>
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
            <button className="btn btn-sm btn-ghost tt tt-below" data-tt={data.planStale?"Plan status & diagnostics — new estimates saved, not yet applied":"Plan status & diagnostics"}
              style={{padding:"6px 9px",position:"relative"}}
              onClick={()=>setPlanDrawerOpen(true)}>
              <i className="ti ti-stethoscope" style={{fontSize:15}}/>
              {data.planStale&&<span style={{position:"absolute",top:2,right:3,width:7,height:7,borderRadius:"50%",background:"var(--amber)"}}/>}
            </button>

            {/* Replan split-button: primary = whole-term replan; ▾ = scope + clear */}
            <div style={{display:"flex",position:"relative",flexShrink:0}}>
              <button className="btn btn-sm tt tt-below tt-right"
                data-tt={data.planStale?"New estimates saved (e.g. a re-researched course) — replan to apply them":"Re-plan every day from this week through the end of your term"}
                style={{background:"var(--red)",color:"#fff",borderRadius:"7px 0 0 7px",position:"relative"}}
                onClick={refreshQuarterPlan} disabled={planning}>
                {planning?<><Sp sz={12}/> Planning...</>:<><i className="ti ti-sparkles"/> Replan</>}
                {!planning&&data.planStale&&<span style={{position:"absolute",top:-3,right:-3,width:8,height:8,borderRadius:"50%",background:"var(--amber)",border:"1.5px solid var(--card)"}}/>}
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
      <PlanDrawer open={planDrawerOpen} onClose={()=>setPlanDrawerOpen(false)} data={data} upd={upd} refreshQuarterPlan={refreshQuarterPlan}/>

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
