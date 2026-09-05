import { useState } from "react";
import { iso } from "@/lib/time";
import { courseNameFor } from "@/lib/courses";
import { calcGPA, letterFromPct } from "@/lib/grades";
import { getQ } from "@/lib/data";
import { useConfirm, SecHead } from "@/components/shared";

// ── HISTORY ──────────────────────────────────────────────────────────────────
function HistoryDetail({entry,onBack}){
  const BOX={background:"var(--card)",borderRadius:12,marginBottom:14};
  const TITLE_ROW={display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 20px 0 20px"};
  const TITLE_LEFT={display:"flex",alignItems:"center",gap:8};
  const TITLE_ICON={fontSize:17,color:"var(--blue)"};
  const TITLE_TEXT={fontSize:13,fontWeight:500,color:"var(--t2)",textTransform:"uppercase",letterSpacing:"0.08em"};
  const DIVIDER={borderTop:"1px solid var(--b1)",margin:"10px 20px 0 20px"};
  const INNER={padding:"14px 20px 18px 20px"};
  const gradedCount=(entry.courses||[]).filter(c=>c.grade!=null&&c.grade!=="").length;
  const doneCount=(entry.assignments||[]).filter(a=>a.status==="done").length;

  return(
    <div className="fade">
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
        <button className="btn btn-ghost btn-sm" onClick={onBack}><i className="ti ti-arrow-left"/> Back to History</button>
      </div>
      <div style={{marginBottom:20}}>
        <h2 style={{marginBottom:6}}>{entry.name}</h2>
        <div style={{fontSize:13,color:"var(--t3)"}}>Archived {entry.closedAt} · View only</div>
      </div>

      <div style={{...BOX,padding:"18px 20px",textAlign:"center"}}>
        <div style={{fontSize:12,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Final GPA</div>
        <div style={{fontSize:40,fontFamily:"'Syne',sans-serif",fontWeight:700,color:"var(--amber)"}}>
          {entry.gpa!==null&&entry.gpa!==undefined?entry.gpa.toFixed(2):"—"}
        </div>
        <div style={{fontSize:13,color:"var(--t3)",marginTop:4}}>
          Based on {gradedCount} graded course{gradedCount!==1?"s":""} · {doneCount}/{(entry.assignments||[]).length} assignments completed
        </div>
      </div>

      <div style={BOX}>
        <div style={TITLE_ROW}>
          <div style={TITLE_LEFT}><i className="ti ti-school" style={TITLE_ICON}/><span style={TITLE_TEXT}>Courses</span></div>
        </div>
        <div style={DIVIDER}/>
        <div style={INNER}>
          {(entry.courses||[]).length===0
            ?<div style={{fontSize:14,color:"var(--t3)"}}>No courses recorded</div>
            :entry.courses.map(c=>{
              const{letter}=letterFromPct(c.grade);
              return(
                <div key={c.id} className="list-item">
                  <div style={{width:8,height:8,borderRadius:"50%",background:c.color?.border||"var(--t3)",flexShrink:0}}/>
                  <div style={{flex:1,fontSize:14,color:"var(--t1)"}}>{c.name}</div>
                  <span className="badge badge-amber" style={{fontSize:12}}>{letter}</span>
                  <span style={{fontSize:12,color:"var(--t3)",marginLeft:8}}>{c.credits??4} cr</span>
                </div>
              );
            })
          }
        </div>
      </div>

      <div style={BOX}>
        <div style={TITLE_ROW}>
          <div style={TITLE_LEFT}><i className="ti ti-clipboard-list" style={TITLE_ICON}/><span style={TITLE_TEXT}>Assignments — {doneCount}/{(entry.assignments||[]).length} done</span></div>
        </div>
        <div style={DIVIDER}/>
        <div style={INNER}>
          {(entry.assignments||[]).length===0
            ?<div style={{fontSize:14,color:"var(--t3)"}}>No assignments recorded</div>
            :entry.assignments.map(a=>(
              <div key={a.id} className="list-item">
                <div className={`chk${a.status==="done"?" on":""}`} style={{cursor:"default"}}>
                  {a.status==="done"&&<i className="ti ti-check" style={{fontSize:10,color:"var(--green)"}}/>}
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:14,color:"var(--t1)"}}>{a.title}</div>
                  <div style={{fontSize:12,color:"var(--t3)"}}>{courseNameFor(entry.courses||[],a.courseId)}{a.dueDate&&` · due ${a.dueDate}`}</div>
                </div>
              </div>
            ))
          }
        </div>
      </div>

      <div style={BOX}>
        <div style={TITLE_ROW}>
          <div style={TITLE_LEFT}><i className="ti ti-writing" style={TITLE_ICON}/><span style={TITLE_TEXT}>Exams</span></div>
        </div>
        <div style={DIVIDER}/>
        <div style={INNER}>
          {(entry.exams||[]).length===0
            ?<div style={{fontSize:14,color:"var(--t3)"}}>No exams recorded</div>
            :entry.exams.map(e=>(
              <div key={e.id} className="list-item">
                <div style={{flex:1}}>
                  <div style={{fontSize:14,color:"var(--t1)"}}>{courseNameFor(entry.courses||[],e.courseId)}{e.topics&&<span style={{color:"var(--t3)"}}> — {e.topics}</span>}</div>
                  <div style={{fontSize:12,color:"var(--t3)"}}>{e.date}</div>
                </div>
              </div>
            ))
          }
        </div>
      </div>
    </div>
  );
}
export function History({data,upd,toast2}){
  const{confirm,modal}=useConfirm();
  const[viewing,setViewing]=useState(null);
  const[closing,setClosing]=useState(false);
  const[qName,setQName]=useState(()=>{const q=getQ(data.profile);return q?q.name:"";});
  const hist=[...(data.history||[])].sort((a,b)=>new Date(b.closedAt)-new Date(a.closedAt));

  async function closeQuarter(){
    const name=qName.trim();
    if(!name)return;
    const ok=await confirm(`Archive "${name}" with ${data.courses.length} course${data.courses.length!==1?"s":""} and ${data.assignments.length} assignment${data.assignments.length!==1?"s":""}? Your active Courses, Assignments, and Exams will move to History and be cleared so you can start the next term fresh.`);
    if(!ok)return;
    const snapshot={
      id:Date.now(),
      name,
      closedAt:iso(),
      courses:data.courses,
      assignments:data.assignments,
      exams:data.exams,
      gpa:calcGPA(data.courses),
    };
    upd({
      history:[...(data.history||[]),snapshot],
      courses:[],assignments:[],exams:[],
      briefCache:null,briefDate:null,
    });
    setClosing(false);
    setQName("");
    toast2(`"${snapshot.name}" archived to History! Ready for a new term.`);
  }

  if(viewing){
    const h=hist.find(x=>x.id===viewing);
    if(h)return <HistoryDetail entry={h} onBack={()=>setViewing(null)}/>;
    setViewing(null);
  }

  return(
    <div className="fade">
      <h2 style={{marginBottom:16}}>History</h2>

      <div className="card" style={{marginBottom:16}}>
        <SecHead icon="ti-archive" title="Current term"/>
        <p style={{fontSize:14,marginBottom:14,lineHeight:1.6}}>
          When your quarter or semester ends, close it out to archive your courses, assignments, exams, and final GPA — then your active lists reset for the next term.
        </p>
        {!closing?(
          <button className="btn btn-action" onClick={()=>setClosing(true)} disabled={!data.courses.length&&!data.assignments.length}>
            <i className="ti ti-archive"/> Close current term
          </button>
        ):(
          <div>
            <div style={{marginBottom:10}}>
              <label>Term name</label>
              <input value={qName} onChange={e=>setQName(e.target.value)} placeholder="e.g. Spring 2026"/>
            </div>
            <div className="row">
              <button className="btn btn-action" style={{flex:1}} onClick={closeQuarter} disabled={!qName.trim()}>
                <i className="ti ti-check"/> Archive &amp; start fresh
              </button>
              <button className="btn btn-ghost" onClick={()=>setClosing(false)}>Cancel</button>
            </div>
          </div>
        )}
        {!data.courses.length&&!data.assignments.length&&!closing&&(
          <div style={{fontSize:12,color:"var(--t3)",marginTop:10}}>Nothing active to archive yet — add courses in Academics first.</div>
        )}
      </div>

      <div className="card">
        <SecHead icon="ti-history" title={`Archived terms — ${hist.length}`}/>
        {hist.length===0
          ?<div style={{fontSize:14,color:"var(--t3)",textAlign:"center",padding:"20px 0"}}>No archived terms yet</div>
          :hist.map(h=>(
            <div key={h.id} className="list-item" style={{cursor:"pointer"}} onClick={()=>setViewing(h.id)}>
              <div style={{width:8,height:8,borderRadius:"50%",background:"var(--blue)",flexShrink:0}}/>
              <div style={{flex:1}}>
                <div className="list-item-title">{h.name}</div>
                <div className="list-item-sub">{(h.courses||[]).length} course{(h.courses||[]).length!==1?"s":""} · archived {h.closedAt}</div>
              </div>
              {h.gpa!==null&&h.gpa!==undefined&&<span className="badge badge-amber">{h.gpa.toFixed(2)} GPA</span>}
              <i className="ti ti-chevron-right" style={{fontSize:14,color:"var(--t3)"}}/>
            </div>
          ))
        }
      </div>
      {modal}
    </div>
  );
}
