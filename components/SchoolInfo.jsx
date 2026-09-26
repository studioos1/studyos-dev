import { useState, useEffect } from "react";
import { computeTermStatuses, datesOverlap, TERM_DATA_DEFAULTS } from "@/lib/data";
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

  // Resets one term's own academic data back to empty — same "clear this term only" concept as
  // Courses' own "Reset academic data" (Acad.jsx), just reachable per-term here in School Info
  // instead of only for whichever term Courses happens to be viewing. Real request: "reset data
  // (with confirmation) > it will erase all academic data back to clear as newly created term."
  // Never touches any OTHER term's data, profile, or habit logs.
  //
  // Also resets this term's own isolated studyPlan/completionLog/pomodoroLogs/etc (TERM_DATA_
  // DEFAULTS, lib/data/schema.js) — real reported bug: "I deleted all terms, and still showing
  // term [schedule]... the delete function should REMOVE the isolated data model of that term."
  // Each term genuinely owns its own copy of these now (see applyTermScopedPatch, lib/data/
  // terms.js), so resetting is just setting THIS term's copy back to empty — no more date-range
  // scrubbing of a shared flat store needed, whether or not t happens to be the current term.
  async function resetTermData(t){
    const termCourseIds=new Set(data.courses.filter(c=>c.termId===t.id).map(c=>c.id));
    const courseCount=termCourseIds.size;
    const assignmentCount=data.assignments.filter(a=>termCourseIds.has(a.courseId)).length;
    const examCount=data.exams.filter(e=>termCourseIds.has(e.courseId)).length;
    if(!courseCount&&!assignmentCount&&!examCount){toast2(`"${t.name}" has no academic data to reset — it's already empty.`);return;}
    const ok=await confirm(`Reset "${t.name}" back to empty? This permanently erases ${courseCount} course${courseCount!==1?"s":""}, ${assignmentCount} assignment${assignmentCount!==1?"s":""}, and ${examCount} exam${examCount!==1?"s":""} for this term only — like it was just created. Other terms are never touched.`,{confirmLabel:"Reset",confirmIcon:"ti-eraser"});
    if(!ok)return;
    upd({
      courses:data.courses.filter(c=>!termCourseIds.has(c.id)),
      assignments:data.assignments.filter(a=>!termCourseIds.has(a.courseId)),
      exams:data.exams.filter(e=>!termCourseIds.has(e.courseId)),
      terms:data.terms.map(x=>x.id===t.id?{...x,...TERM_DATA_DEFAULTS}:x),
    });
    toast2(`"${t.name}" reset — back to a clean, newly-created term.`);
  }

  // Deletes a term entirely — real request: "delete button - allow user to delete this term
  // entirely with confirmation," confirmed as "will remove the entire data model of this term."
  // Unlike the old upcoming-only/no-attached-courses restriction this replaces, this is available
  // for any term regardless of status, and cascades: its own courses/assignments/exams go with
  // it — status changes never copy data anywhere else (see "Change Status" above), so nothing of
  // this term survives a real delete.
  async function deleteTermEntirely(t){
    // Real request: "if user wants to delete the current - we shall not allow to do so only after
    // changing to other status. We shall guide the user about this logic when trying." Deleting
    // your Current term used to be allowed (with just a warning in the confirm dialog) — now it's
    // blocked outright; the guidance fires right at the moment they try, rather than hiding/
    // disabling the delete button with no explanation. Upcoming/Archive terms are unaffected —
    // this only guards Current.
    if(t.status==="current"){
      toast2(`"${t.name}" is your Current term, so it can't be deleted directly. Change its status first (Change Status → Upcoming or Archive), then delete it.`,true);
      return;
    }
    const termCourseIds=new Set(data.courses.filter(c=>c.termId===t.id).map(c=>c.id));
    const courseCount=termCourseIds.size;
    const assignmentCount=data.assignments.filter(a=>termCourseIds.has(a.courseId)).length;
    const examCount=data.exams.filter(e=>termCourseIds.has(e.courseId)).length;
    const dataWarning=courseCount?` This also permanently deletes ${courseCount} course${courseCount!==1?"s":""}, ${assignmentCount} assignment${assignmentCount!==1?"s":""}, and ${examCount} exam${examCount!==1?"s":""} attached to it.`:"";
    const ok=await confirm(`Delete "${t.name}" (${t.start} – ${t.end})?${dataWarning} This can't be undone.`,{confirmLabel:"Delete",confirmIcon:"ti-trash"});
    if(!ok)return;
    // No separate scrub needed for studyPlan/completionLog/pomodoroLogs/etc — each term owns its
    // own isolated copy now, so removing the term object below removes its data with it.
    upd({
      terms:data.terms.filter(x=>x.id!==t.id),
      courses:data.courses.filter(c=>!termCourseIds.has(c.id)),
      assignments:data.assignments.filter(a=>!termCourseIds.has(a.courseId)),
      exams:data.exams.filter(e=>!termCourseIds.has(e.courseId)),
    });
    toast2(`"${t.name}" deleted.`);
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
      // Real request: "create a NEW FRESH ISOLATED data model" — spreading in TERM_DATA_DEFAULTS
      // gives this term its own genuinely empty studyPlan/completionLog/pomodoroLogs/etc from the
      // moment it exists (see applyTermScopedPatch, lib/data/terms.js) — a real, separate object,
      // not a date-range view of shared data, so it can't inherit anything from any other term
      // regardless of whether its dates happen to overlap one. No scrubbing needed anymore.
      const newTerm={id:"term_"+Date.now(),schoolId,name:newName||"New term",type:newType,start:newStart,end:newEnd,holidays:newHolidays,source:newSource,fetchedAt:newSource?new Date().toISOString():null,status:"upcoming",...TERM_DATA_DEFAULTS};
      patch.terms=[...(data.terms||[]),newTerm];
      // Permanently marks this account as having entered the real terms system, so
      // migrateLegacyTermIfNeeded can never resurrect a deleted term from stale profile fields
      // later — see the comment on that guard in lib/data/terms.js.
      patch.termsInitialized=true;
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
  // moment").
  //
  // Redesigned per follow-up request: "remove the popup showing the terms and states... once
  // clicking 'change states' - display on each terms' section the other two states in gray. User
  // can select, only one can be set at Current... once user started Edit State... this button
  // become an active (amber) and show 'Save States' this will stop the edit mode... and store the
  // new values." Replaces the old confirm-modal-per-click flow with inline, STAGED editing:
  // selectDraftStatus only ever touches draftStatuses (local, unsaved) — nothing reaches `data`
  // until saveStatuses runs. Picking Current on one term locally demotes whichever OTHER term
  // currently reads Current (via effStatus — draft first, falling back to the real stored status)
  // to Archive, so "only one can be Current" holds live as the student clicks around, with no
  // per-click confirmation popup — the edit session ending in Save States is the confirmation.
  const [editingStatus,setEditingStatus]=useState(false);
  const [draftStatuses,setDraftStatuses]=useState({}); // termId -> staged status, only for terms actually touched this edit session
  const effStatus=t=>draftStatuses[t.id]||t.status;
  function selectDraftStatus(term,newStatus){
    setDraftStatuses(prev=>{
      const next={...prev};
      if(newStatus==="current"){
        termStatuses.forEach(t=>{
          if(t.id!==term.id&&effStatus(t)==="current")next[t.id]="archived";
        });
      }
      next[term.id]=newStatus;
      return next;
    });
  }
  function saveStatuses(){
    if(Object.keys(draftStatuses).length){
      upd({terms:data.terms.map(t=>draftStatuses[t.id]?{...t,status:draftStatuses[t.id]}:t)});
      toast2("Term statuses saved.");
    }
    setEditingStatus(false);
    setDraftStatuses({});
  }

  const statusColor=s=>s==="current"?"var(--amber)":s==="upcoming"?"var(--blue)":"var(--t3)";
  const statusLabel=s=>s==="current"?"Current":s==="upcoming"?"Upcoming":"Archive";

  return(
    <div className="fade">
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
        <h2>School Info</h2>
        <div style={{display:"flex",gap:8}}>
          {data.terms?.length>0&&(
            <button className={`tt tt-below tt-right btn btn-sm ${editingStatus?"btn-action":"btn-ghost"}`}
              data-tt={editingStatus?"Save the status changes made below":"Set which term is Current, Upcoming, or Archive. Only one term can be Current at a time."}
              onClick={()=>editingStatus?saveStatuses():setEditingStatus(true)}>
              <i className={`ti ${editingStatus?"ti-device-floppy":"ti-adjustments"}`}/> {editingStatus?"Save States":"Change Status"}
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
        // Real request: "keep always the 'current' on top, the other order by end-term date" —
        // Current is pinned first via effStatus (reflects an in-progress status edit live, not
        // just the saved value — status is a manual, stored field now, not date-derived, so
        // Current can't just fall out of a plain date sort), then everything else runs
        // newest-end-date-first down to oldest, so the display re-sorts live as the student edits
        // statuses, not only after Save States.
        const terms=[...bySchool[schoolId]].sort((a,b)=>{
          const sa=effStatus(a),sb=effStatus(b);
          if(sa==="current")return -1;
          if(sb==="current")return 1;
          return (b.end||"").localeCompare(a.end||"");
        });
        const isCurrent=schoolId===currentSchoolId;
        const isExpanded=expandedSchoolId===schoolId;
        const archivedCount=terms.filter(t=>effStatus(t)==="archived").length;
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
                  <div style={{...TITLE_LEFT,flexWrap:"wrap",rowGap:6}}>
                    <div style={{width:10,height:10,borderRadius:"50%",background:statusColor(effStatus(t)),flexShrink:0}}/>
                    <span style={{...TITLE_TEXT,color:"var(--t1)",fontSize:16,textTransform:"none",letterSpacing:"normal",fontWeight:500}}>{t.name}</span>
                    <span className="badge" style={{background:"transparent",border:`1px solid ${statusColor(effStatus(t))}`,color:statusColor(effStatus(t)),fontSize:10,textTransform:"uppercase"}}>
                      {statusLabel(effStatus(t))}
                    </span>
                    {/* Real request: "display on each terms' section the other two states in
                        gray. User can select, only one can be set at Current." Only the two
                        statuses NOT currently in effect show, so there's never a redundant pill
                        for the one already shown above in color. */}
                    {editingStatus&&["current","upcoming","archived"].filter(s=>s!==effStatus(t)).map(s=>(
                      <button key={s} onClick={()=>selectDraftStatus(t,s)}
                        style={{fontSize:10,fontWeight:600,textTransform:"uppercase",padding:"4px 10px",
                          borderRadius:20,border:"1px solid var(--b1)",background:"var(--card2)",
                          color:"var(--t3)",cursor:"pointer"}}>
                        {statusLabel(s)}
                      </button>
                    ))}
                  </div>
                  <div style={{display:"flex",gap:8,flexShrink:0}}>
                    <button className="tt" data-tt="Reset this term's data — erase all courses, assignments, and exams back to empty" onClick={()=>resetTermData(t)}
                      style={{width:26,height:26,borderRadius:"50%",flexShrink:0,
                        border:"1px solid var(--b1)",background:"var(--card2)",color:"var(--amber)",cursor:"pointer",
                        display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>
                      <i className="ti ti-eraser" style={{fontSize:13}}/>
                    </button>
                    <button className="tt" data-tt={t.status==="current"?"Change status first — your Current term can't be deleted directly":"Delete this term entirely — its courses, assignments, and exams go with it"} onClick={()=>deleteTermEntirely(t)}
                      style={{width:26,height:26,borderRadius:"50%",flexShrink:0,
                        border:"1px solid var(--b1)",background:"var(--card2)",color:"var(--red)",cursor:"pointer",
                        display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>
                      <i className="ti ti-trash" style={{fontSize:13}}/>
                    </button>
                    <button className="tt tt-below" data-tt="Edit name/type/dates" onClick={()=>startEditTerm(t)}
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
