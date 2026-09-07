import { iso, m2t, f12 } from "@/lib/time";
import { DS } from "@/lib/constants";
import {
  buildBlocks,
  assignLanesClustered,
  tc,
  saveBlockToDay,
  deleteBlockFromDay,
  logCompletion,
} from "@/lib/calendar";
import { BlockEditModal } from "./modals";

// ── Calendar components ──────────────────────────────────────────────────────
export function WeekGrid({data,upd,onDay,weekStart,refreshWeekPlan,busy,editState,setEditState}){
  const START=7,END=24,TOTAL=(END-START)*60;
  function pct(m){return((m-START*60)/TOTAL*100).toFixed(4)+"%";}
  function dpct(m){return(m/TOTAL*100).toFixed(4)+"%";}

  const ws=weekStart?new Date(weekStart):(()=>{const d=new Date();d.setDate(d.getDate()-d.getDay());return d;})();
  const dates=Array.from({length:7},(_,i)=>{const d=new Date(ws);d.setDate(ws.getDate()+i);return iso(d);});
  const now=new Date(),nowMins=now.getHours()*60+now.getMinutes(),todayStr=iso();
  const gridLines=[8,10,12,14,16,18,20,22,24];
  const majorHours=[8,10,12,14,16,18,20,22];
  const ROW=72;
  const weekKey=iso(ws);
  const storedWeek=data.studyPlan?.weeks?.[weekKey];

  // Thin wrappers around the standalone functions (defined above, shared with Today) — keeps
  // the existing onSave={saveBlockToDay} etc. call sites below working with their original 2-arg shape.
  const saveBlock=(dateStr,block)=>saveBlockToDay(data,upd,dateStr,block);
  const deleteBlock=(dateStr,blockId)=>deleteBlockFromDay(data,upd,dateStr,blockId);
  const logComplete=entry=>logCompletion(data,upd,entry);

  return(
    <div>
      {/* Time axis — marginLeft matches timeline start for centered labels */}
      <div style={{position:"relative",height:12,marginLeft:84,marginBottom:4}}>
        {majorHours.map(h=>(
          <div key={h} style={{
            position:"absolute",left:pct(h*60),
            transform:"translateX(-50%)",
            fontSize:12,color:"var(--t1)",fontWeight:500,whiteSpace:"nowrap",lineHeight:1,
          }}>
            {h<12?`${h}am`:h===12?"12pm":`${h-12}pm`}
          </div>
        ))}
      </div>

      {/* Extra top padding so tooltips on the first row's blocks have room to render without being clipped */}
      <div style={{paddingTop:28}}>
      {/* All day rows — no gap, continuous grid lines. No overflow:hidden here — that
          would clip tooltips that extend above/beside a block; corners are rounded per-row instead. */}
      <div>
        {dates.map((dateStr,di)=>{
          const isToday=dateStr===todayStr;
          const dt=new Date(dateStr+"T12:00:00");
          // Read from the persistent stored plan when this week has been planned; otherwise fall
          // back to a live (unpersisted) computation just so the day isn't blank — the "Plan this
          // week" button above is how the student turns that into a real, durable plan.
          const rawBlocks=storedWeek?.days?.[dateStr]||[]; // no fictional fallback — an unplanned week shows real fixed events only; "Plan this week"/"Refresh Plan" in the header is the honest next step, not a silently-guessed schedule
          const enriched=data.quarterPlan?.tasksByDate?.[dateStr];
          const dayStudyBlocks=rawBlocks.map((b,bi)=>({time:m2t(b.s),duration:b.e-b.s,task:b.description||(enriched&&enriched[bi])||b.label,courseId:b.courseId,course:b.course,kind:b.kind,id:b.id,userEdited:b.userEdited,completed:b.completed,source:b.source}));
          const allDayBlocks=buildBlocks(dateStr,data,dayStudyBlocks)
            .filter(b=>b.type!=="sleep"&&b.e>(START*60)&&b.s<(END*60))
            .map(b=>({...b,s:Math.max(b.s,START*60),e:Math.min(b.e,END*60)}));
          const deadlineBlocks=allDayBlocks.filter(b=>b.type==="deadline");
          const blocks=assignLanesClustered(allDayBlocks.filter(b=>b.type!=="deadline"&&b.e-b.s>=5));
          const nowPct=isToday&&nowMins>=(START*60)&&nowMins<=(END*60)?pct(nowMins):null;

          return(
            <div key={di} style={{
              display:"flex",alignItems:"stretch",
              background:isToday?"#505a72":"#3a4050",
              borderRadius:di===0?"8px 8px 0 0":di===6?"0 0 8px 8px":0,
            }}>
              {/* Day label */}
              <div onClick={()=>onDay(dateStr)} style={{
                width:84,flexShrink:0,cursor:"pointer",
                display:"flex",flexDirection:"column",alignItems:"flex-end",
                justifyContent:"center",paddingRight:12,height:ROW,

              }}>
                <div style={{fontSize:11,color:isToday?"var(--amber)":"var(--t3)",
                  textTransform:"uppercase",letterSpacing:"0.07em",lineHeight:1,marginBottom:3}}>
                  {DS[di]}
                </div>
                <div style={{fontSize:16,color:isToday?"var(--amber)":"var(--t1)",
                  lineHeight:1,fontWeight:500}}>
                  {dt.getDate()}
                </div>
              </div>

              {/* Timeline */}
              <div style={{flex:1,position:"relative",height:ROW}}>
                {/* Grid lines — every 2hrs */}
                {gridLines.map(h=>(
                  <div key={h} style={{
                    position:"absolute",top:0,bottom:0,left:pct(h*60),width:1,
                    background:"rgba(122,172,224,0.22)",
                  }}/>
                ))}

                {/* Baseline — thin gray line, full width */}
                <div style={{
                  position:"absolute",
                  left:0,right:0,
                  top:"50%",marginTop:7,
                  height:1,background:"rgba(160,175,190,0.28)",
                  zIndex:1,
                }}/>

                {/* Now line */}
                {nowPct&&(
                  <div style={{
                    position:"absolute",top:0,bottom:0,left:nowPct,
                    width:2,background:"var(--amber)",zIndex:10,
                  }}/>
                )}

                {/* Activity blocks — every bar's bottom edge sits exactly ON the baseline line
                    (BASELINE = 50%+7px, matching the baseline element above), with its label
                    directly above the bar. When multiple blocks overlap the same time range,
                    each additional lane stacks upward from that same baseline instead of downward,
                    so there's always one single shared reference line every bar touches. */}
                {blocks.map((b,bi)=>{
                  const dur=b.e-b.s;
                  const c=tc(b.type);
                  const numLanes=b.clusterLanes||1;
                  const showLabel=dur>=20&&(ROW/numLanes)>=18;
                  const BLOCK_H=numLanes>1?5:7;
                  const LABEL_H=showLabel?15:0;
                  const GAP=showLabel?3:0;
                  const BASELINE=ROW/2+7; // px from row top — matches the baseline element exactly
                  const LANE_STEP=BLOCK_H+LABEL_H+GAP+4; // vertical space each stacked lane needs
                  const bottom=BASELINE-(b.lane*LANE_STEP); // bar's bottom edge — lane 0 sits ON the baseline
                  const containerTop=bottom-BLOCK_H-LABEL_H-GAP;
                  const tooltip=`${f12(m2t(b.s))} – ${f12(m2t(b.e))} · ${b.label}${b.autoMoved?" — auto-shifted to avoid a class/exam conflict":""}${b.completed?" ✓ completed":""}`;
                  const posPct=(b.s-START*60)/TOTAL*100;
                  const ttClass=posPct>75?"tt tt-right":posPct<15?"tt tt-left":"tt";
                  const editable=!!b.id&&dateStr>=todayStr; // only real (id-bearing) blocks, and only on today-or-later — past days are read-only history
                  return(
                    <div key={bi} className={ttClass} data-tt={tooltip}
                      onDoubleClick={editable?()=>setEditState({dateStr,block:b}):undefined}
                      style={{
                      position:"absolute",
                      left:pct(b.s),width:dpct(dur),
                      top:Math.max(0,containerTop),
                      height:BLOCK_H+LABEL_H+GAP, // explicit, matching the containerTop math exactly —
                        // relying on natural content-flow height here left a gap between what the
                        // position math assumed and what actually rendered, most visible on
                        // no-label (short-duration) blocks where there's less content to fill it
                      zIndex:3,
                      cursor:editable?"pointer":"default",
                    }}>
                      {showLabel&&(
                        <div style={{
                          fontSize:12,color:c.text,lineHeight:1.2,
                          paddingLeft:3,marginBottom:GAP,
                          whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:"100%",
                        }}>
                          {b.autoMoved&&"↻ "}{b.completed&&"✓ "}{b.label}
                        </div>
                      )}
                      <div style={{
                        width:"100%",height:BLOCK_H,
                        background:c.line,borderRadius:2,
                        opacity:b.type==="commute"?0.45:b.completed?0.4:1,
                      }}/>
                    </div>
                  );
                })}

                {/* Assignment deadlines — red diamond milestone marker, placed 1hr before due */}
                {deadlineBlocks.map((b,bi)=>{
                  const course=data.courses.find(c=>c.id===b.courseId);
                  const courseName=course?course.name:"(unknown course)";
                  const dueLabel=f12(m2t(b.dueMin));
                  const tooltip=`${courseName} · ${b.title} · Due ${dueLabel}`;
                  const posPct=(b.s-START*60)/TOTAL*100;
                  const ttClass=posPct>75?"tt tt-right":posPct<15?"tt tt-left":"tt";
                  return(
                    <div key={`d${bi}`} className={ttClass} data-tt={tooltip} style={{
                      position:"absolute",
                      left:pct(b.s),
                      top:ROW/2+7, // matches BASELINE used by activity bars exactly
                      transform:"translate(-50%,-50%)",
                      width:10,height:10,
                      zIndex:5,
                      cursor:"default",
                    }}>
                      <div style={{
                        width:"100%",height:"100%",
                        background:"#c04020",
                        transform:"rotate(45deg)",
                        borderRadius:2,
                        boxShadow:"0 0 0 2px var(--card)",
                      }}/>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      </div>

      {/* Legend */}
      <div style={{display:"flex",gap:18,flexWrap:"wrap",marginTop:14,paddingLeft:96,paddingTop:10,borderTop:"1px solid var(--b1)"}}>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <div style={{width:9,height:9,background:"#c04020",transform:"rotate(45deg)",borderRadius:2,flexShrink:0}}/>
          <span style={{fontSize:12,color:"var(--t2)"}}>Assignment Due</span>
        </div>
        {[["exam","Exam"],["class","Class"],["homework","HW Prep"],["project","Project"],["study","Study"]].map(([type,label])=>(
          <div key={type} style={{display:"flex",alignItems:"center",gap:6}}>
            <div style={{width:22,height:5,borderRadius:2,background:tc(type).line}}/>
            <span style={{fontSize:12,color:"var(--t2)"}}>{label}</span>
          </div>
        ))}
        <div style={{width:1,alignSelf:"stretch",background:"var(--b1)"}}/>
        {[["breakfast","Meals"],["gym","Gym"],["chore","Chores"],["fun","Events"]].map(([type,label])=>(
          <div key={type} style={{display:"flex",alignItems:"center",gap:6}}>
            <div style={{width:22,height:5,borderRadius:2,background:tc(type).line}}/>
            <span style={{fontSize:12,color:"var(--t2)"}}>{label}</span>
          </div>
        ))}
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <div style={{width:2,height:14,background:"var(--amber)",borderRadius:1}}/>
          <span style={{fontSize:12,color:"var(--t2)"}}>Now</span>
        </div>
        <div style={{marginLeft:"auto",fontSize:11,color:"var(--t3)"}}>
          <i className="ti ti-hand-click" style={{marginRight:5}}/>Double-click an activity to edit
        </div>
      </div>
      {editState&&(
        <BlockEditModal
          dateStr={editState.dateStr}
          block={editState.block}
          courses={data.courses}
          weekDates={dates}
          onSave={saveBlock}
          onDelete={editState.block?deleteBlock:null}
          onComplete={logComplete}
          onClose={()=>setEditState(null)}
        />
      )}
    </div>
  );
}
