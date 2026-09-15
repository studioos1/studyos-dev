import { realDayBlocks, buildBlocks, weekHasBeenPlanned, tc } from "@/lib/calendar";
import { f12, m2t } from "@/lib/time";

// Shared day-schedule list — colored left-border rows, chronological, sleep filtered out (it's
// not a schedulable "activity" the way the rest of the list is, just the wake↔sleep boundary).
// Extracted from the Calendar tab's month-view day-detail pane so Today's "View day calendar"
// modal renders a day's schedule the exact same way — previously Today used a different
// component entirely (Timeline, an hourly grid), which CLAUDE.md's backlog explicitly flagged as
// an unfinished, parked design. Always shows the day's real fixed schedule (classes, meals, gym —
// buildBlocks includes these regardless of AI planning status), never hidden behind a "not
// planned yet" wall; the banner below is a status note, not a gate on the list itself.
export function DayAgenda({data,dateStr}){
  const dayBlocks=buildBlocks(dateStr,data,realDayBlocks(data,dateStr)).filter(b=>b.type!=="sleep");
  return(
    <>
      {!weekHasBeenPlanned(data,dateStr)&&(
        <div style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",marginBottom:10,
          background:"var(--amber-bg)",color:"var(--amber)",borderRadius:10,fontSize:12.5}}>
          <i className="ti ti-sparkles" style={{fontSize:14,flexShrink:0}}/>
          <span>Study time isn't planned for this week yet.</span>
        </div>
      )}
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {dayBlocks.map((b,i)=>{
          const c=tc(b.type);
          const isDeadline=b.type==="deadline";
          return(
            <div key={i} className="card" style={{
              display:"flex",alignItems:"center",gap:10,padding:"9px 11px",margin:0,
              borderLeft:`4px solid ${c.line}`,borderRadius:6,
              opacity:b.type==="commute"?0.6:b.completed?0.55:1}}>
              <div style={{flexShrink:0,minWidth:isDeadline?68:112,fontSize:12,color:c.text,fontWeight:600,whiteSpace:"nowrap"}}>
                {isDeadline?f12(m2t(b.s)):`${f12(m2t(b.s))} – ${f12(m2t(b.e))}`}
              </div>
              <div style={{flex:1,minWidth:0,fontSize:14,color:"var(--t1)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                {b.completed&&"✓ "}{b.autoMoved&&"↻ "}{b.label}
              </div>
            </div>
          );
        })}
        {dayBlocks.length===0&&(
          <div style={{textAlign:"center",padding:"20px 0",color:"var(--t3)",fontSize:13}}>Nothing scheduled.</div>
        )}
      </div>
    </>
  );
}
