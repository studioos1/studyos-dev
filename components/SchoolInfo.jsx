import { useState, useEffect } from "react";
import { computeTermStatuses, datesOverlap, canDeleteTerm } from "@/lib/data";
import { fetchCollegeCalendar } from "@/lib/colleges";
import { Sp, CollegeAutocomplete, useConfirm } from "@/components/shared";

// ── SCHOOL INFO ──────────────────────────────────────────────────────────────
export function SchoolInfo({data,upd,updP,toast2}){
  const schools=data.schools||[];
  const termStatuses=computeTermStatuses(data.terms);
  const currentTerm=termStatuses.find(t=>t.status==="current")||null;
  const currentSchoolId=currentTerm?.schoolId||null;
  const {confirm,modal}=useConfirm();
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
  const [newHolidays,setNewHolidays]=useState([]); // fetched alongside the term, stored on save — never shown in this modal
  const [newSource,setNewSource]=useState(null); // the lookup's sourceUrl, stored alongside holidays
  const [lookupState,setLookupState]=useState("idle"); // idle | loading | done | error

  // Closing without saving (X, backdrop click) previously left the form's state alone — reopening
  // "Add term" right after came back with the LAST attempt's school/dates/lookup state still
  // sitting there instead of a blank form, a real reported bug. This is the one place that both
  // hides the modal and clears every field back to its default, used by every close path
  // (including a successful save) so there's exactly one way this ever happens, not two that can
  // drift apart.
  function closeAddTerm(){
    setShowAddTerm(false);
    setNewSchool("");setNewType("quarter");setNewName("");setNewStart("");setNewEnd("");setNewHolidays([]);setNewSource(null);setLookupState("idle");
  }
  // Opening defaults the School field to the CURRENT school (per explicit request — most "add
  // term" clicks are adding the NEXT term at the school you're already at) but does NOT run the
  // lookup — every API call on this screen is strictly by-demand now (real cost concern: this
  // used to fire a real, paid call on every single open, even if immediately closed without
  // saving). "Find Upcoming Term" is the one and only trigger, for any school.
  function openAddTerm(){
    setShowAddTerm(true);
    const school=currentTerm&&schools.find(s=>s.id===currentTerm.schoolId);
    if(school){
      setNewSchool(school.name);
      const{type}=anchorForSchool(school.name);
      if(type)setNewType(type);
    }
  }

  // Editing an EXISTING term — name/type/dates only (typo correction), not which school it
  // belongs to (that's a bigger structural move, out of scope for a simple correction).
  const [editingTerm,setEditingTerm]=useState(null); // {id, name, type, start, end} while a term is being edited, else null
  function startEditTerm(t){setEditingTerm({id:t.id,name:t.name,type:t.type,start:t.start,end:t.end});}
  // Warns — doesn't block — when a term's dates overlap the term currently driving the planner.
  // getActiveTermAndSchool()/termScopedForPlanning() only ever treat ONE term as "current", so an
  // overlap doesn't merge planning across both terms — it silently drops the other one's courses.
  // Same-school overlap is almost always a mistake (wrong dates, duplicate entry); cross-school
  // overlap can be a real situation (dual enrollment, study abroad) that this app just can't plan
  // across yet — either way the student should see the consequence before it happens quietly.
  async function checkOverlapAndProceed(schoolId,start,end,excludeTermId,onProceed){
    if(currentTerm&&currentTerm.id!==excludeTermId&&datesOverlap(start,end,currentTerm.start,currentTerm.end)){
      const sameSchool=currentTerm.schoolId===schoolId;
      const currentSchoolName=schools.find(s=>s.id===currentTerm.schoolId)?.name||"your current school";
      const msg=sameSchool
        ?`This overlaps with your current term at ${currentSchoolName} (${currentTerm.start} – ${currentTerm.end}). That's almost always a mistake — double check the dates. Continue anyway?`
        :`This overlaps with your current term at ${currentSchoolName} (${currentTerm.start} – ${currentTerm.end}). Only one term is used for planning at a time, so the other one's courses won't be scheduled until it becomes current. Continue anyway?`;
      const ok=await confirm(msg,{confirmLabel:"Continue anyway",confirmIcon:"ti-alert-triangle"});
      if(!ok)return;
    }
    onProceed();
  }

  function saveEditedTerm(){
    if(!editingTerm.start||!editingTerm.end){toast2("Both dates are required",true);return;}
    const term=data.terms.find(t=>t.id===editingTerm.id);
    checkOverlapAndProceed(term?.schoolId,editingTerm.start,editingTerm.end,editingTerm.id,()=>{
      upd({terms:data.terms.map(t=>t.id===editingTerm.id?{...t,name:editingTerm.name||"Untitled term",type:editingTerm.type,start:editingTerm.start,end:editingTerm.end}:t)});
      toast2("Term updated");
      setEditingTerm(null);
    });
  }

  // canDeleteTerm (lib/data/terms.js) has the actual rule (upcoming-only, blocked if courses are
  // attached) — kept there rather than inline so it's unit-testable without mocking confirm/toast.
  async function deleteTerm(t){
    const check=canDeleteTerm(t,data.courses);
    if(!check.deletable){toast2(`Can't delete "${t.name}" — ${check.reason}`,true);return;}
    const ok=await confirm(`Delete "${t.name}" (${t.start} – ${t.end})? This can't be undone.`,{confirmLabel:"Delete",confirmIcon:"ti-trash"});
    if(!ok)return;
    upd({terms:data.terms.filter(x=>x.id!==t.id)});
    toast2("Term deleted");
  }

  const bySchool={};
  termStatuses.forEach(t=>{(bySchool[t.schoolId]=bySchool[t.schoolId]||[]).push(t);});
  const schoolIds=Object.keys(bySchool).sort((a,b)=>a===currentSchoolId?-1:b===currentSchoolId?1:0);

  // Runs the lookup and fills whatever comes back — shared by both the "existing school" and "new
  // school" paths below, so there's one lookup implementation, not two that can drift apart.
  // `afterDate` anchors the search on "the term after this end date" (see fetchCollegeCalendar);
  // omitted, it falls back to "current or upcoming."
  async function runLookupAndFill(schoolName,afterDate){
    setLookupState("loading");
    try{
      const result=await fetchCollegeCalendar(schoolName,afterDate);
      if(result.scheduleType==="quarter"||result.scheduleType==="semester")setNewType(result.scheduleType);
      if(result.termName)setNewName(result.termName);
      if(result.termStart)setNewStart(result.termStart);
      if(result.termEnd)setNewEnd(result.termEnd);
      if(Array.isArray(result.holidays))setNewHolidays(result.holidays); // stored on save, never shown here
      if(result.sourceUrl)setNewSource(result.sourceUrl);
      setLookupState("done");
    }catch(err){
      console.error("StudyOS: school lookup failed —",err);
      setLookupState("error");
      toast2("Couldn't auto-fill that term — please fill it in manually.",true);
    }
  }

  // Anchors the "next term" search on an existing school's LATEST known term end date (so the
  // lookup finds what comes after it, not a repeat) — shared by picking a school from the
  // autocomplete and the manual "Find Upcoming Term" button, so there's one place this rule lives.
  function anchorForSchool(schoolName){
    const existing=schools.find(s=>s.name===schoolName);
    if(!existing)return{afterDate:null,type:null};
    const existingTerms=[...termStatuses.filter(t=>t.schoolId===existing.id)].sort((a,b)=>(a.end||"").localeCompare(b.end||""));
    const latest=existingTerms[existingTerms.length-1];
    return{afterDate:latest?.end||null,type:latest?.type||null};
  }

  // Picking a school from the autocomplete dropdown fills the field and pre-fills the type for an
  // existing school (both free, local, no API call) — it no longer searches automatically.
  // "Find Upcoming Term" below is now the ONLY trigger for a real search, for both a brand-new
  // school and one already on record — every API call from this screen is strictly by-demand,
  // per explicit instruction.
  function handleSchoolSelected(schoolName){
    setNewSchool(schoolName);
    const{type}=anchorForSchool(schoolName);
    if(type)setNewType(type);
  }

  // The explicit, click-to-search button — the ONLY way an existing school's term now gets
  // looked up (real reported cost concern: the previous auto-search-on-open fired a real, paid
  // API call every time the modal was opened, even without saving).
  function findUpcomingTerm(){
    if(!newSchool)return;
    const{afterDate,type}=anchorForSchool(newSchool);
    if(type)setNewType(type);
    runLookupAndFill(newSchool,afterDate);
  }

  function saveNewTerm(){
    if(!newSchool||!newStart||!newEnd){toast2("School name and both dates are required",true);return;}
    const existing=schools.find(s=>s.name===newSchool);
    const schoolId=existing?existing.id:"sch_"+Date.now();
    checkOverlapAndProceed(schoolId,newStart,newEnd,null,()=>{
      const patch={};
      if(!existing)patch.schools=[...schools,{id:schoolId,name:newSchool,address:"",schoolType:newType}];
      // status:"upcoming" — real request: "user set the term name, dates... and default shall be
      // 'Upcoming'." A brand-new term never starts Current on its own; that's always an explicit
      // choice made afterward via "Change Status" below.
      patch.terms=[...(data.terms||[]),{id:"term_"+Date.now(),schoolId,name:newName||"New term",type:newType,start:newStart,end:newEnd,holidays:newHolidays,source:newSource,fetchedAt:newSource?new Date().toISOString():null,status:"upcoming"}];
      upd(patch);
      toast2(existing?"Term added!":"New school and term added!");
      setExpandedSchoolId(schoolId);
      closeAddTerm();
    });
  }

  // Manual term-status control — real request: "remove the function to close current term...
  // instead we need a function to set a term to Active. That requires: add a field to manage the
  // term states: Current, Upcoming, Archive... ONLY ONE can be set to Current." Changing status
  // never touches a term's own courses/assignments/exams/etc — every consumer already scopes by
  // termId, so nothing here moves or clears any data, ever ("data model of each term is not
  // affected by changing the status... just keep a full set of its isolated data as in that
  // moment"). Promoting a different term to Current is the one transition with a real side effect
  // (only one term can hold it), so it's the only one that confirms first; Upcoming/Archive can be
  // set freely since there's no "only one" rule for those.
  const [showStatusModal,setShowStatusModal]=useState(false);
  async function setTermStatus(term,newStatus){
    if(term.status===newStatus)return;
    if(newStatus==="current"){
      const oldCurrent=termStatuses.find(t=>t.status==="current"&&t.id!==term.id);
      if(oldCurrent){
        const ok=await confirm(`Set "${term.name}" as your Current term? "${oldCurrent.name}" (currently Current) will be changed to Archive.`,{confirmLabel:"Set as Current",confirmIcon:"ti-check"});
        if(!ok)return;
        upd({terms:data.terms.map(t=>{
          if(t.id===term.id)return{...t,status:"current"};
          if(t.id===oldCurrent.id)return{...t,status:"archived"};
          return t;
        })});
        toast2(`"${term.name}" is now your Current term.`);
        return;
      }
    }
    upd({terms:data.terms.map(t=>t.id===term.id?{...t,status:newStatus}:t)});
    toast2(`"${term.name}" set to ${newStatus==="archived"?"Archive":newStatus==="current"?"Current":"Upcoming"}.`);
  }

  const statusColor=s=>s==="current"?"var(--amber)":s==="upcoming"?"var(--blue)":"var(--t3)";
  const statusLabel=s=>s==="current"?"Current":s==="upcoming"?"Upcoming":"Archive";

  return(
    <div className="fade">
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
        <h2>School Info</h2>
        <div style={{display:"flex",gap:8}}>
          {data.terms?.length>0&&(
            <button className="tt tt-below tt-right btn btn-ghost btn-sm"
              data-tt="Set which term is Current, Upcoming, or Archive. Only one term can be Current at a time."
              onClick={()=>setShowStatusModal(true)}>
              <i className="ti ti-adjustments"/> Change Status
            </button>
          )}
          <button className="btn btn-action btn-sm" onClick={openAddTerm}>
            <i className="ti ti-plus"/> Add term
          </button>
        </div>
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
        const archivedCount=terms.filter(t=>t.status==="archived").length;
        if(!isExpanded){
          return(
            <button key={schoolId} onClick={()=>setExpandedSchoolId(schoolId)}
              className="card" style={{width:"100%",textAlign:"left",padding:"12px 16px",marginBottom:10,
                display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",border:"none"}}>
              <span style={{fontSize:14,color:"var(--t2)"}}>
                <i className="ti ti-chevron-right" style={{marginRight:6}}/>{school?.name||"(unknown school)"} · {terms.length} term{terms.length!==1?"s":""}
                {archivedCount>0&&`, ${archivedCount} archived`}
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
                      {statusLabel(t.status)}
                    </span>
                  </div>
                  <div style={{display:"flex",gap:8,flexShrink:0}}>
                    {t.status==="upcoming"&&(
                      <button className="tt" data-tt="Delete this term" onClick={()=>deleteTerm(t)}
                        style={{width:26,height:26,borderRadius:"50%",flexShrink:0,
                          border:"1px solid var(--b1)",background:"var(--card2)",color:"var(--red)",cursor:"pointer",
                          display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>
                        <i className="ti ti-trash" style={{fontSize:13}}/>
                      </button>
                    )}
                    <button className="tt" data-tt="Edit name/type/dates" onClick={()=>startEditTerm(t)}
                      style={{width:26,height:26,borderRadius:"50%",flexShrink:0,
                        border:"1px solid var(--b1)",background:"var(--card2)",color:"var(--t2)",cursor:"pointer",
                        display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>
                      <i className="ti ti-pencil" style={{fontSize:13}}/>
                    </button>
                  </div>
                </div>
                <div style={DIVIDER}/>
                <div style={INNER}>
                  <div style={{fontSize:14,fontWeight:600,color:"var(--t1)"}}>{t.start||"?"} – {t.end||"?"}</div>
                  <div style={{fontSize:13,color:"var(--t3)",marginTop:4}}>
                    {t.type==="quarter"?"Quarter":"Semester"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        );
      })}

      {/* "Change Status" modal — real request: "add a button near '+Term' - 'Change Status' - this
          button allow user to edit each one of the term's status. ONLY ONE can be set to
          'Current'." Replaces the old "Close current term" card entirely; see setTermStatus above
          for the actual mechanics (auto-confirm + auto-demote only when promoting to Current). */}
      {showStatusModal&&(
        <div style={{position:"fixed",inset:0,zIndex:9000,background:"rgba(0,0,0,0.55)",
          display:"flex",alignItems:"center",justifyContent:"center",padding:20}}
          onClick={()=>setShowStatusModal(false)}>
          <div style={{background:"var(--card)",borderRadius:14,padding:"20px 24px",maxWidth:460,width:"100%",
            maxHeight:"85vh",overflowY:"auto",boxShadow:"0 24px 60px rgba(0,0,0,0.5)"}}
            onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <div style={{fontSize:16,fontWeight:600}}>Change term status</div>
              <button className="btn btn-ghost btn-sm" onClick={()=>setShowStatusModal(false)}><i className="ti ti-x"/></button>
            </div>
            <p style={{fontSize:12,color:"var(--t3)",marginBottom:16,lineHeight:1.5}}>
              Only one term can be Current. Setting a different term Current will change today's
              Current term to Archive — your courses, assignments, and data for every term stay
              exactly as they are; only the status label changes.
            </p>
            {termStatuses.map(t=>(
              <div key={t.id} style={{marginBottom:12,paddingBottom:12,borderBottom:"1px solid var(--b1)"}}>
                <div style={{fontSize:14,fontWeight:600,color:"var(--t1)",marginBottom:8}}>{t.name}</div>
                <div style={{display:"flex",gap:6}}>
                  {["current","upcoming","archived"].map(s=>(
                    <button key={s} onClick={()=>setTermStatus(t,s)}
                      style={{flex:1,padding:"7px 0",borderRadius:8,fontSize:12,fontWeight:600,cursor:"pointer",
                        border:`1px solid ${t.status===s?statusColor(s):"var(--b1)"}`,
                        background:t.status===s?statusColor(s):"var(--card2)",
                        color:t.status===s?"#0a1420":"var(--t2)"}}>
                      {statusLabel(s)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showAddTerm&&(
        <div style={{position:"fixed",inset:0,zIndex:9000,background:"rgba(0,0,0,0.55)",
          display:"flex",alignItems:"center",justifyContent:"center",padding:20}}
          onClick={closeAddTerm}>
          <div style={{background:"var(--card)",borderRadius:14,padding:"20px 24px",maxWidth:420,width:"100%",
            maxHeight:"85vh",overflowY:"auto",boxShadow:"0 24px 60px rgba(0,0,0,0.5)"}}
            onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div style={{fontSize:16,fontWeight:600}}>Add term</div>
              <button className="btn btn-ghost btn-sm" onClick={closeAddTerm}><i className="ti ti-x"/></button>
            </div>
            <div style={{marginBottom:12}}>
              <label>School</label>
              <CollegeAutocomplete value={newSchool} onChange={setNewSchool} onSelect={handleSchoolSelected} placeholder="Type an existing school, or a new one to transfer..."/>
              {/* The only trigger for a real search anywhere on this screen — not on opening the
                  modal, and not on picking a school from the dropdown above either (both just
                  fill the field). Every API call from School Info is strictly by-demand. */}
              {lookupState==="loading"?(
                <div style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:"var(--t3)",marginTop:5}}><Sp sz={12}/> Looking up term dates...</div>
              ):(
                <button className="btn btn-ghost btn-sm" style={{marginTop:8}} onClick={findUpcomingTerm} disabled={!newSchool}>
                  <i className="ti ti-search"/> Find Upcoming Term
                </button>
              )}
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
      {modal}
    </div>
  );
}
