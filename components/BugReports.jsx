import { useState, useEffect } from "react";
import { fetchBugReports, updateBugReportStatus } from "@/lib/bugReports";
import { Sp } from "@/components/shared";

// ── BUG REPORTS (admin-only) ──────────────────────────────────────────────────
// Only reachable via the tab App.jsx adds when the signed-in user's email is in
// lib/constants.js's ADMIN_EMAILS — but the real gate is the RLS policy in supabase/schema.sql,
// which is what actually stops anyone else's client from reading every user's reports.
export function BugReports({toast2}){
  const BOX={background:"var(--card)",borderRadius:12,marginBottom:14};
  const TITLE_ROW={display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 20px 0 20px"};
  const TITLE_LEFT={display:"flex",alignItems:"center",gap:8};
  const TITLE_ICON={fontSize:17,color:"var(--blue)"};
  const TITLE_TEXT={fontSize:13,fontWeight:500,color:"var(--t2)",textTransform:"uppercase",letterSpacing:"0.08em"};
  const DIVIDER={borderTop:"1px solid var(--b1)",margin:"10px 20px 0 20px"};
  const INNER={padding:"14px 20px 18px 20px"};

  const [reports,setReports]=useState(null); // null = loading
  const [updatingId,setUpdatingId]=useState(null);

  async function load(){
    setReports(await fetchBugReports());
  }
  useEffect(()=>{load();},[]);

  async function toggleStatus(r){
    setUpdatingId(r.id);
    const next=r.status==="open"?"resolved":"open";
    await updateBugReportStatus(r.id,next);
    setReports(prev=>prev.map(x=>x.id===r.id?{...x,status:next}:x));
    setUpdatingId(null);
    toast2?.(next==="resolved"?"Marked resolved":"Reopened");
  }

  const open=(reports||[]).filter(r=>r.status==="open");
  const resolved=(reports||[]).filter(r=>r.status==="resolved");

  function Row({r}){
    return(
      <div className="list-item" style={{alignItems:"flex-start"}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:14,color:"var(--t1)",lineHeight:1.5,marginBottom:4,whiteSpace:"pre-wrap"}}>{r.message}</div>
          <div style={{fontSize:12,color:"var(--t3)"}}>
            {r.user_email||"unknown user"}
            {r.page&&<> · {r.page}</>}
            {r.app_version&&<> · v{r.app_version}</>}
            {" · "}{new Date(r.created_at).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={()=>toggleStatus(r)} disabled={updatingId===r.id} style={{flexShrink:0}}>
          {updatingId===r.id?<Sp sz={12}/>:r.status==="open"?<><i className="ti ti-check"/> Resolve</>:<><i className="ti ti-refresh"/> Reopen</>}
        </button>
      </div>
    );
  }

  return(
    <div className="fade">
      <h2 style={{marginBottom:16}}>Bug Reports</h2>
      <div style={BOX}>
        <div style={TITLE_ROW}>
          <div style={TITLE_LEFT}><i className="ti ti-bug" style={TITLE_ICON}/><span style={TITLE_TEXT}>Open ({open.length})</span></div>
        </div>
        <div style={DIVIDER}/>
        <div style={INNER}>
          {reports===null?(
            <div style={{display:"flex",alignItems:"center",gap:10,color:"var(--t2)"}}><Sp/> Loading...</div>
          ):open.length===0?(
            <div style={{fontSize:14,color:"var(--t3)"}}>No open reports 🎉</div>
          ):open.map(r=><Row key={r.id} r={r}/>)}
        </div>
      </div>
      {resolved.length>0&&(
        <div style={BOX}>
          <div style={TITLE_ROW}>
            <div style={TITLE_LEFT}><i className="ti ti-circle-check" style={TITLE_ICON}/><span style={TITLE_TEXT}>Resolved ({resolved.length})</span></div>
          </div>
          <div style={DIVIDER}/>
          <div style={INNER}>
            {resolved.map(r=><Row key={r.id} r={r}/>)}
          </div>
        </div>
      )}
    </div>
  );
}
