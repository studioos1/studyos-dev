import { useState } from "react";
import { iso, m2t, f12 } from "@/lib/time";
import {
  buildBlocks,
  assignLanesClustered,
  tc,
  findRawDayBlock,
  saveBlockToDay,
  deleteBlockFromDay,
  logCompletion,
} from "@/lib/calendar";
import { BlockEditModal } from "./modals";

export function Timeline({dateStr,data,upd,studyBlocks=[]}){
  const SH=7,EH=24,SM=SH*60;
  const SPLIT_1=12,SPLIT_2=17; // noon and 5pm — three side-by-side columns (Morning/Afternoon/Evening)
  const PPM=1.7; // pixels per minute — tuned so even the shortest column (5h) stays comfortably readable
  const allBlocksRaw=buildBlocks(dateStr,data,studyBlocks).filter(b=>b.e>SM&&b.s<EH*60);
  const now=new Date(),nm=now.getHours()*60+now.getMinutes(),isToday=dateStr===iso();
  // Editing is opt-in (only when upd is provided) and only for blocks that came from the real
  // persisted plan (buildBlocks only carries an id through for those — fixed items like class,
  // meals, gym, sleep, commute never have one). BlockEditModal needs the RAW stored block shape,
  // not buildBlocks' display-shaped output, so it's looked up by id at click-time.
  const [editState,setEditState]=useState(null);
  const editable=!!upd;

  // One column's worth of the timeline — hour axis + blocks + now-line + deadline markers, all
  // scoped to [colStart,colEnd). All three columns call this with identical logic, just a
  // different hour range and pre-filtered block set.
  function renderColumn(key,label,colStartH,colEndH){
    const colStart=colStartH*60,colEnd=colEndH*60;
    const colAllBlocks=allBlocksRaw.filter(b=>b.s>=colStart&&b.s<colEnd);
    const colDeadlines=colAllBlocks.filter(b=>b.type==="deadline");
    const colBlocks=assignLanesClustered(colAllBlocks.filter(b=>b.type!=="deadline"));
    const colH=(colEndH-colStartH)*60*PPM;
    const ny=isToday&&nm>=colStart&&nm<colEnd?(nm-colStart)*PPM:-1;
    const hrs=[];
    for(let h=colStartH;h<=colEndH;h++)hrs.push(h);

    return(
      <div key={key} style={{flex:1,minWidth:0}}>
        <div style={{marginBottom:8,paddingBottom:6,borderBottom:"1px solid var(--b1)"}}>
          <div style={{fontSize:11,fontWeight:600,color:"var(--t2)",textTransform:"uppercase",letterSpacing:"0.06em"}}>{label}</div>
          <div style={{fontSize:11,color:"var(--t3)"}}>{colStartH<12?`${colStartH}am`:colStartH===12?"12pm":`${colStartH-12}pm`} – {colEndH===24?"12am":colEndH<12?`${colEndH}am`:colEndH===12?"12pm":`${colEndH-12}pm`}</div>
        </div>
      <div style={{display:"flex",gap:0}}>
        {/* Time axis */}
        <div style={{width:44,flexShrink:0,position:"relative",height:colH}}>
          {hrs.map(h=>{
            const y=(h*60-colStart)*PPM;
            return(
              <div key={h} style={{position:"absolute",top:y-7,right:0,textAlign:"right",lineHeight:1}}>
                <span style={{fontSize:12,color:"var(--t1)",fontWeight:500}}>
                  {h===24?"12am":h<12?`${h}am`:h===12?"12pm":`${h-12}pm`}
                </span>
              </div>
            );
          })}
        </div>

        {/* Main area */}
        <div style={{flex:1,position:"relative",height:colH,minWidth:0}}>
          {hrs.map(h=>{
            const y=(h*60-colStart)*PPM;
            return(
              <div key={h} style={{position:"absolute",top:y,left:0,right:0,height:1,background:"var(--b1)",opacity:0.35}}/>
            );
          })}

          {ny>0&&(
            <div style={{position:"absolute",top:ny,left:0,right:0,height:2,background:"var(--amber)",zIndex:10,borderRadius:1}}>
              <div style={{position:"absolute",left:-5,top:-4,width:10,height:10,borderRadius:"50%",background:"var(--amber)"}}/>
            </div>
          )}

          {colBlocks.map((b,i)=>{
            const top=(b.s-colStart)*PPM;
            const height=Math.max(18,(b.e-b.s)*PPM);
            const c=tc(b.type);
            const cl=b.clusterLanes||1;
            const laneStyle=cl>1
              ?{left:`calc(${(100/cl)*b.lane}% + 3px)`,width:`calc(${100/cl}% - 6px)`}
              :{left:4,right:4};
            const tooltip=`${f12(m2t(b.s))} – ${f12(m2t(b.e))} · ${b.label}${b.autoMoved?" — auto-shifted to avoid a class/exam conflict":""}${b.completed?" ✓ completed":""}`;
            const ttClass=cl>1?(b.lane===0?"tt tt-left":b.lane===cl-1?"tt tt-right":"tt"):"tt";
            const canShowLabel=height>=32;

            return(
              <div key={i} className={ttClass} data-tt={tooltip}
                onDoubleClick={editable&&b.id!=null?()=>{const raw=findRawDayBlock(data,dateStr,b.id);if(raw)setEditState({dateStr,block:raw});}:undefined}
                style={{
                  position:"absolute",top:Math.max(0,top),height,...laneStyle,zIndex:2,
                  cursor:editable&&b.id!=null?"pointer":"default",
                  background:c.line+"26",borderLeft:`3px solid ${c.line}`,borderRadius:4,
                  padding:"3px 7px",overflow:"hidden",boxSizing:"border-box",
                  opacity:b.type==="sleep"?0.4:b.type==="commute"?0.6:b.completed?0.55:1,
                }}>
                <div style={{fontSize:11,color:c.text,fontWeight:600,lineHeight:1.25,whiteSpace:"nowrap"}}>
                  {f12(m2t(b.s))}{!canShowLabel&&` · ${b.label}`}
                </div>
                {canShowLabel&&(
                  <div style={{fontSize:12,color:c.text,lineHeight:1.3,overflow:"hidden",
                    display:"-webkit-box",WebkitLineClamp:Math.max(1,Math.floor((height-16)/15)),WebkitBoxOrient:"vertical"}}>
                    {b.autoMoved&&"↻ "}{b.completed&&"✓ "}{b.label}
                  </div>
                )}
              </div>
            );
          })}

          {colDeadlines.map((b,i)=>{
            const top=(b.s-colStart)*PPM;
            const course=data.courses.find(c=>c.id===b.courseId);
            const courseName=course?course.name:"(unknown course)";
            const dueLabel=f12(m2t(b.dueMin));
            const tooltip=`${courseName} · ${b.title} · Due ${dueLabel}`;
            return(
              <div key={`d${i}`} className="tt" data-tt={tooltip} style={{
                position:"absolute",top:top-6,left:4,right:4,zIndex:5,
                display:"flex",alignItems:"center",gap:6,cursor:"default",
              }}>
                <div style={{width:12,height:12,flexShrink:0,background:"#c04020",transform:"rotate(45deg)",borderRadius:2,boxShadow:"0 0 0 2px var(--bg)"}}/>
                <span style={{fontSize:11,color:"#f08060",fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                  Due {dueLabel} — {courseName}: {b.title}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      </div>
    );
  }

  return(
    <div>
      <div style={{display:"flex",gap:20}}>
        {renderColumn("am","Morning",SH,SPLIT_1)}
        {renderColumn("mid","Afternoon",SPLIT_1,SPLIT_2)}
        {renderColumn("pm","Evening",SPLIT_2,EH)}
      </div>
      {editState&&editable&&(
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
    </div>
  );
}
