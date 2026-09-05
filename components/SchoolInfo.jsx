import { useState, useEffect } from "react";
import { iso } from "@/lib/time";
import { computeTermStatuses } from "@/lib/data";
import { fetchCollegeCalendar } from "@/lib/colleges";
import { Sp, CollegeAutocomplete } from "@/components/shared";

// ── SCHOOL INFO ──────────────────────────────────────────────────────────────
export function SchoolInfo({data,upd,updP,toast2}){
  const schools=data.schools||[];
  const termStatuses=computeTermStatuses(data.terms,iso());
  const currentTerm=termStatuses.find(t=>t.status==="current")||null;
  const currentSchoolId=currentTerm?.schoolId||null;
  const [expandedSchoolId,setExpandedSchoolId]=useState(currentSchoolId);
  useEffect(()=>{if(currentSchoolId&&expandedSchoolId===null)setExpandedSchoolId(currentSchoolId);},[currentSchoolId]); // eslint-disable-line

  // Same card styling used throughout Academics/Today/Preferences — for real visual consistency
  // rather than the ad-hoc custom card styling this tab started with.
  const BOX={background:"var(--card)",borderRadius:12,marginBottom:14};
  const TITLE_ROW={display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 20px 0 20px"};
  const TITLE_LEFT={display:"flex",alignItems:"center",gap:8};
  const TITLE_ICON={fontSize:17,color:"var(--blue)"};
  const TITLE_TEXT={fontSize:13,fontWeight:500,color:"var(--t2)",textTransform:"uppercase",letterSpacing:"0.08em"};
  const DIVIDER={borderTop:"1px solid var(--b1)",margin:"10px 20px 0 20px"};
  const INNER={padding:"14px 20px 18px 20px"};

  const [showAddTerm,setShowAddTerm]=useState(false);
  const [newSchool,setNewSchool]=useState("");
  const [newType,setNewType]=useState("quarter");
  const [newName,setNewName]=useState("");
  const [newStart,setNewStart]=useState("");
  const [newEnd,setNewEnd]=useState("");
  const [lookupState,setLookupState]=useState("idle"); // idle | loading | done | error

  // Editing an EXISTING term — name/type/dates only (typo correction), not which school it
  // belongs to (that's a bigger structural move, out of scope for a simple correction).
  const [editingTerm,setEditingTerm]=useState(null); // {id, name, type, start, end} while a term is being edited, else null
  function startEditTerm(t){setEditingTerm({id:t.id,name:t.name,type:t.type,start:t.start,end:t.end});}
  function saveEditedTerm(){
    if(!editingTerm.start||!editingTerm.end){toast2("Both dates are required",true);return;}
    upd({terms:data.terms.map(t=>t.id===editingTerm.id?{...t,name:editingTerm.name||"Untitled term",type:editingTerm.type,start:editingTerm.start,end:editingTerm.end}:t)});
    toast2("Term updated");
    setEditingTerm(null);
  }

  const bySchool={};
  termStatuses.forEach(t=>{(bySchool[t.schoolId]=bySchool[t.schoolId]||[]).push(t);});
  const schoolIds=Object.keys(bySchool).sort((a,b)=>a===currentSchoolId?-1:b===currentSchoolId?1:0);

  async function handleSchoolSelected(schoolName){
    setNewSchool(schoolName);
    const existing=schools.find(s=>s.name===schoolName);
    if(existing){
      // Existing school — pre-fill the type as an editable default from its most recent term,
      // but never auto-guess the NEW term's own dates just from knowing the school.
      const existingTerms=termStatuses.filter(t=>t.schoolId===existing.id);
      if(existingTerms.length)setNewType(existingTerms[existingTerms.length-1].type);
      return;
    }
    // New school — try the same auto-fill lookup already used elsewhere in the app.
    setLookupState("loading");
    try{
      const result=await fetchCollegeCalendar(schoolName);
      if(result.scheduleType==="quarter"||result.scheduleType==="semester")setNewType(result.scheduleType);
      if(result.termStart)setNewStart(result.termStart);
      if(result.termEnd)setNewEnd(result.termEnd);
      if(result.termName)setNewName(result.termName);
      setLookupState("done");
    }catch(err){
      console.error("StudyOS: school lookup failed —",err);
      setLookupState("error");
      toast2("Couldn't auto-fill that school — please fill in the term manually.",true);
    }
  }

  function saveNewTerm(){
    if(!newSchool||!newStart||!newEnd){toast2("School name and both dates are required",true);return;}
    const existing=schools.find(s=>s.name===newSchool);
    const schoolId=existing?existing.id:"sch_"+Date.now();
    const patch={};
    if(!existing)patch.schools=[...schools,{id:schoolId,name:newSchool,address:"",schoolType:newType}];
    patch.terms=[...(data.terms||[]),{id:"term_"+Date.now(),schoolId,name:newName||"New term",type:newType,start:newStart,end:newEnd,holidays:[],source:null,fetchedAt:null}];
    upd(patch);
    toast2(existing?"Term added!":"New school and term added!");
    setExpandedSchoolId(schoolId);
    setShowAddTerm(false);
    setNewSchool("");setNewName("");setNewStart("");setNewEnd("");setLookupState("idle");
  }

  const statusColor=s=>s==="current"?"var(--amber)":s==="upcoming"?"var(--blue)":"var(--t3)";

  return(
    <div className="fade">
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
        <h2>School Info</h2>
        <button className="btn btn-action btn-sm" onClick={()=>setShowAddTerm(true)}>
          <i className="ti ti-plus"/> Add term
        </button>
      </div>

      {schoolIds.length===0&&(
        <div className="card" style={{padding:20,textAlign:"center",color:"var(--t3)"}}>
          No school on record yet — click "Add term" to get started.
        </div>
      )}

      {schoolIds.map(schoolId=>{
        const school=schools.find(s=>s.id===schoolId);
        const terms=bySchool[schoolId].sort((a,b)=>a.start.localeCompare(b.start));
        const isCurrent=schoolId===currentSchoolId;
        const isExpanded=expandedSchoolId===schoolId;
        const completedCount=terms.filter(t=>t.status==="completed").length;
        if(!isExpanded){
          return(
            <button key={schoolId} onClick={()=>setExpandedSchoolId(schoolId)}
              className="card" style={{width:"100%",textAlign:"left",padding:"12px 16px",marginBottom:10,
                display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",border:"none"}}>
              <span style={{fontSize:14,color:"var(--t2)"}}>
                <i className="ti ti-chevron-right" style={{marginRight:6}}/>{school?.name||"(unknown school)"} · {terms.length} term{terms.length!==1?"s":""}
                {completedCount>0&&`, ${completedCount} completed`}
              </span>
              <i className="ti ti-history" style={{color:"var(--t3)"}}/>
            </button>
          );
        }
        return(
          <div key={schoolId} style={{marginBottom:20}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,padding:"0 2px"}}>
              <i className="ti ti-building" style={TITLE_ICON}/>
              <span style={{...TITLE_TEXT,color:"var(--t1)",fontSize:15,textTransform:"none",letterSpacing:"normal",fontWeight:600}}>{school?.name||"(unknown school)"}</span>
              {isCurrent&&<span className="badge badge-amber" style={{fontSize:13}}>Current school</span>}
              {schoolIds.length>1&&(
                <button className="btn btn-ghost btn-sm" style={{marginLeft:"auto",fontSize:12}} onClick={()=>setExpandedSchoolId(null)}>Collapse</button>
              )}
            </div>
            {school?.address&&<div style={{fontSize:12,color:"var(--t3)",marginBottom:12,paddingLeft:2}}>{school.address}</div>}
            {terms.map(t=>(
              <div key={t.id} style={BOX}>
                <div style={TITLE_ROW}>
                  <div style={TITLE_LEFT}>
                    <div style={{width:10,height:10,borderRadius:"50%",background:statusColor(t.status)}}/>
                    <span style={{...TITLE_TEXT,color:"var(--t1)",fontSize:16,textTransform:"none",letterSpacing:"normal",fontWeight:500}}>{t.name}</span>
                    <span className="badge" style={{background:"transparent",border:`1px solid ${statusColor(t.status)}`,color:statusColor(t.status),fontSize:10,textTransform:"uppercase"}}>
                      {t.status}
                    </span>
                  </div>
                  <button className="tt" data-tt="Edit name/type/dates" onClick={()=>startEditTerm(t)}
                    style={{width:26,height:26,borderRadius:"50%",flexShrink:0,
                      border:"1px solid var(--b1)",background:"var(--card2)",color:"var(--t2)",cursor:"pointer",
                      display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>
                    <i className="ti ti-pencil" style={{fontSize:13}}/>
                  </button>
                </div>
                <div style={DIVIDER}/>
                <div style={INNER}>
                  <div style={{fontSize:14,fontWeight:600,color:"var(--t1)"}}>{t.start||"?"} – {t.end||"?"}</div>
                  <div style={{fontSize:13,color:"var(--t3)",marginTop:4}}>
                    {t.type==="quarter"?"Quarter":"Semester"}
                    {t.status==="upcoming"&&" · starts once the current term ends"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        );
      })}

      {showAddTerm&&(
        <div style={{position:"fixed",inset:0,zIndex:9000,background:"rgba(0,0,0,0.55)",
          display:"flex",alignItems:"center",justifyContent:"center",padding:20}}
          onClick={()=>setShowAddTerm(false)}>
          <div style={{background:"var(--card)",borderRadius:14,padding:"20px 24px",maxWidth:420,width:"100%",
            maxHeight:"85vh",overflowY:"auto",boxShadow:"0 24px 60px rgba(0,0,0,0.5)"}}
            onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div style={{fontSize:16,fontWeight:600}}>Add term</div>
              <button className="btn btn-ghost btn-sm" onClick={()=>setShowAddTerm(false)}><i className="ti ti-x"/></button>
            </div>
            <div style={{marginBottom:12}}>
              <label>School</label>
              <CollegeAutocomplete value={newSchool} onChange={setNewSchool} onSelect={handleSchoolSelected} placeholder="Type an existing school, or a new one to transfer..."/>
              {lookupState==="loading"&&<div style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:"var(--t3)",marginTop:5}}><Sp sz={12}/> Looking up term dates...</div>}
            </div>
            <div className="g2" style={{marginBottom:12}}>
              <div><label>Term name</label><input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="e.g. Winter 2027"/></div>
              <div><label>Type</label>
                <select value={newType} onChange={e=>setNewType(e.target.value)}>
                  <option value="quarter">Quarter</option><option value="semester">Semester</option>
                </select>
              </div>
            </div>
            <div className="g2" style={{marginBottom:16}}>
              <div><label>Start</label><input type="date" value={newStart} onChange={e=>setNewStart(e.target.value)}/></div>
              <div><label>End</label><input type="date" value={newEnd} onChange={e=>setNewEnd(e.target.value)}/></div>
            </div>
            <button className="btn btn-action" style={{width:"100%"}} onClick={saveNewTerm} disabled={!newSchool||!newStart||!newEnd}>
              <i className="ti ti-plus"/> Add term
            </button>
          </div>
        </div>
      )}

      {editingTerm&&(
        <div style={{position:"fixed",inset:0,zIndex:9000,background:"rgba(0,0,0,0.55)",
          display:"flex",alignItems:"center",justifyContent:"center",padding:20}}
          onClick={()=>setEditingTerm(null)}>
          <div style={{background:"var(--card)",borderRadius:14,padding:"20px 24px",maxWidth:420,width:"100%",
            maxHeight:"85vh",overflowY:"auto",boxShadow:"0 24px 60px rgba(0,0,0,0.5)"}}
            onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div style={{fontSize:16,fontWeight:600}}>Edit term</div>
              <button className="btn btn-ghost btn-sm" onClick={()=>setEditingTerm(null)}><i className="ti ti-x"/></button>
            </div>
            <div className="g2" style={{marginBottom:12}}>
              <div><label>Term name</label><input value={editingTerm.name} onChange={e=>setEditingTerm(t=>({...t,name:e.target.value}))} placeholder="e.g. Fall 2026"/></div>
              <div><label>Type</label>
                <select value={editingTerm.type} onChange={e=>setEditingTerm(t=>({...t,type:e.target.value}))}>
                  <option value="quarter">Quarter</option><option value="semester">Semester</option>
                </select>
              </div>
            </div>
            <div className="g2" style={{marginBottom:16}}>
              <div><label>Start</label><input type="date" value={editingTerm.start} onChange={e=>setEditingTerm(t=>({...t,start:e.target.value}))}/></div>
              <div><label>End</label><input type="date" value={editingTerm.end} onChange={e=>setEditingTerm(t=>({...t,end:e.target.value}))}/></div>
            </div>
            <button className="btn btn-action" style={{width:"100%"}} onClick={saveEditedTerm} disabled={!editingTerm.start||!editingTerm.end}>
              <i className="ti ti-device-floppy"/> Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
