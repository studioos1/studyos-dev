import React, { useState } from "react";
import { iso, t2m, m2t } from "@/lib/time";
import { checkSyllabusExtraction } from "@/lib/syllabus";
import { supabase } from "@/lib/supabase";
import { Sp, ExtractionIssues } from "./ui";

// Shown right after the AI parses a syllabus/schedule PDF, BEFORE anything is saved to
// data.assignments/data.exams. Gives the student one place to catch and fix any misclassified
// item (e.g. a quiz the AI called an exam) or wrong date/weight, rather than discovering it
// later in a cluttered calendar. A single "Looks good, save all" button confirms everything as-is
// for the common case; per-row editing is only needed when something's actually wrong.
export function ExtractionVerifyModal({parsed,courses,termStart,termEnd,onConfirm,onCancel}){
  const [saving,setSaving]=useState(false);
  // Deterministic sanity check on the raw AI output — surfaces misreads (a heading taken for a
  // course, a wrong-year date) up front so the student can re-upload instead of hand-fixing rows.
  const {issues}=checkSyllabusExtraction(parsed,{courses,termStart,termEnd});
  // Flatten into one editable list, tagging each row with its course + a stable local key.
  const [rows,setRows]=useState(()=>{
    const out=[];
    (parsed.courses||[]).forEach((c,ci)=>{
      (c.assignments||[]).forEach((a,ai)=>{
        out.push({key:`a_${ci}_${ai}`,courseName:c.courseName,type:"homework",title:a.title,date:a.dueDate,weight:a.weight??null,estimatedHours:a.estimatedHours,topics:null,prepDays:null});
      });
      (c.exams||[]).forEach((e,ei)=>{
        out.push({key:`e_${ci}_${ei}`,courseName:c.courseName,type:"exam",title:e.title,date:e.date,weight:e.weight??null,estimatedHours:null,topics:e.topics||"",prepDays:e.prepDays||7});
      });
    });
    return out;
  });

  function updateRow(key,field,value){
    setRows(rs=>rs.map(r=>r.key===key?{...r,[field]:value}:r));
  }
  function removeRow(key){
    setRows(rs=>rs.filter(r=>r.key!==key));
  }
  function addRow(){
    // New row defaults to the first course found and homework type — student fills in the rest.
    // A stable, collision-safe local key since this doesn't come from the parsed AI response.
    const defaultCourse=rows[0]?.courseName||courses[0]?.name||"";
    setRows(rs=>[...rs,{key:`new_${Date.now()}_${Math.floor(Math.random()*1000)}`,courseName:defaultCourse,type:"homework",title:"",date:"",weight:null,estimatedHours:2,topics:null,prepDays:null}]);
  }

  const totalCourses=new Set(rows.map(r=>r.courseName)).size;

  async function handleConfirm(){
    setSaving(true);
    // Rebuild into the courses[].assignments/exams shape syncSyl expects, from the (possibly
    // edited) flat row list — type changes, date/weight edits, and removed rows all take effect.
    const byCourse={};
    rows.forEach(r=>{
      if(!byCourse[r.courseName])byCourse[r.courseName]={courseName:r.courseName,assignments:[],exams:[]};
      if(r.type==="homework"){
        byCourse[r.courseName].assignments.push({title:r.title,dueDate:r.date,weight:r.weight,estimatedHours:r.estimatedHours||2});
      }else{
        byCourse[r.courseName].exams.push({title:r.title,date:r.date,weight:r.weight,topics:r.topics||"",prepDays:r.prepDays||7});
      }
    });
    // Preserve meetingTimes from the original parse untouched — this screen only verifies duties.
    const origByCourse={};
    (parsed.courses||[]).forEach(c=>{origByCourse[c.courseName]=c.meetingTimes;});
    const rebuilt=Object.values(byCourse).map(c=>({...c,meetingTimes:origByCourse[c.courseName]||[]}));
    // finalizeSync does real work here — a course-difficulty lookup (network call) per NEW course
    // — awaiting it keeps the spinner visible for the actual duration, not just an instant flash.
    await onConfirm({...parsed,courses:rebuilt});
  }

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{background:"var(--card)",borderRadius:14,maxWidth:820,width:"100%",maxHeight:"85vh",display:"flex",flexDirection:"column",boxShadow:"0 20px 60px rgba(0,0,0,0.5)"}}>
        <div style={{padding:"20px 24px",borderBottom:"1px solid var(--b1)",flexShrink:0}}>
          <div style={{fontSize:18,fontWeight:600}}>Verify What We Found</div>
          <div style={{fontSize:13,color:"var(--t3)",marginTop:3}}>
            {rows.length} item{rows.length!==1?"s":""} across {totalCourses} course{totalCourses!==1?"s":""}. Check the Type column especially — fix anything that's not right, then confirm.
          </div>
        </div>
        <div style={{padding:"0 24px",overflowY:"auto",flex:1}}>
          {issues.length>0&&(
            <div style={{marginTop:16}}>
              <ExtractionIssues issues={issues} onReupload={onCancel}/>
            </div>
          )}
          {rows.length===0?(
            <div style={{color:"var(--t3)",padding:"20px 0"}}>Nothing was found to import.</div>
          ):(
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead style={{position:"sticky",top:0,background:"var(--card)",zIndex:1}}>
                <tr style={{borderBottom:"1px solid var(--b1)"}}>
                  <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"left",padding:"16px 8px 8px",fontWeight:600}}>Class</th>
                  <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"left",padding:"16px 8px 8px",fontWeight:600}}>Type</th>
                  <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"left",padding:"16px 8px 8px",fontWeight:600}}>Title</th>
                  <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"left",padding:"16px 8px 8px",fontWeight:600}}>Date</th>
                  <th style={{fontSize:11,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",textAlign:"left",padding:"16px 8px 8px",fontWeight:600}}>Weight</th>
                  <th style={{width:36}}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r=>(
                  <tr key={r.key}>
                    <td style={{padding:"7px 8px"}}>
                      <select value={r.courseName} onChange={e=>updateRow(r.key,"courseName",e.target.value)} style={{fontSize:12,padding:"4px 6px",maxWidth:130}}>
                        {!courses.find(c=>c.name===r.courseName)&&r.courseName&&<option value={r.courseName}>{r.courseName}</option>}
                        {courses.map(c=><option key={c.id} value={c.name}>{c.name}</option>)}
                      </select>
                    </td>
                    <td style={{padding:"7px 8px"}}>
                      <select value={r.type} onChange={e=>updateRow(r.key,"type",e.target.value)}
                        style={{fontSize:12,padding:"4px 6px",width:100,
                          borderColor:r.type==="exam"?"var(--red)":"var(--blue)",
                          color:r.type==="exam"?"var(--red)":"var(--blue)"}}>
                        <option value="homework">Homework</option>
                        <option value="exam">Exam</option>
                      </select>
                    </td>
                    <td style={{padding:"7px 8px"}}>
                      <input value={r.title||""} onChange={e=>updateRow(r.key,"title",e.target.value)} style={{fontSize:13,padding:"4px 6px",width:"100%"}}/>
                    </td>
                    <td style={{padding:"7px 8px"}}>
                      <input type="date" value={r.date||""} onChange={e=>updateRow(r.key,"date",e.target.value)} style={{fontSize:12,padding:"4px 6px"}}/>
                    </td>
                    <td style={{padding:"7px 8px"}}>
                      <input type="number" min="0" max="100" step="0.5" value={r.weight??""} onChange={e=>updateRow(r.key,"weight",e.target.value===""?null:+e.target.value)}
                        placeholder="—" style={{fontSize:12,padding:"4px 6px",width:60}}/>
                    </td>
                    <td style={{padding:"7px 8px"}}>
                      <button className="tt" data-tt="Remove this item" onClick={()=>removeRow(r.key)}
                        style={{padding:"4px 6px",borderRadius:6,border:"none",cursor:"pointer",background:"transparent",color:"var(--red)"}}>
                        <i className="ti ti-x" style={{fontSize:14}}/>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <button className="btn btn-ghost btn-sm" style={{marginTop:10,marginBottom:16}} onClick={addRow}>
            <i className="ti ti-plus" style={{marginRight:5}}/>Add missing item
          </button>
        </div>
        <div style={{padding:"14px 24px",borderTop:"1px solid var(--b1)",display:"flex",justifyContent:"flex-end",gap:8,flexShrink:0}}>
          <button className="btn btn-ghost" onClick={onCancel} disabled={saving}>Cancel — don't save anything</button>
          <button className="btn btn-action" onClick={handleConfirm} disabled={saving}>
            {saving?<><Sp/> Saving...</>:<><i className="ti ti-check" style={{marginRight:6}}/>Looks good, save all</>}
          </button>
        </div>
      </div>
    </div>
  );
}


// Add/Edit modal for a single study-plan block. block=null means "adding new"; block set means
// "editing this existing block" (opened via double-click). Type determines courseId linkage;
// Description is always free-text and purely cosmetic — never changes what the block structurally is.
export function BlockEditModal({dateStr,block,courses,weekDates,onSave,onDelete,onClose,onComplete}){
  const isNew=!block;
  const [type,setType]=useState(block?(block.courseId?"homework":block.kind==="chore"?"chore":"personal"):"personal");
  const [courseId,setCourseId]=useState(block?.courseId||(courses[0]?.id||""));
  const [description,setDescription]=useState(block?.description||block?.label||"");
  const [startTime,setStartTime]=useState(block?m2t(block.s):"18:00");
  const [endTime,setEndTime]=useState(block?m2t(block.e):"19:00");
  const [confirmingDelete,setConfirmingDelete]=useState(false);
  const [completed,setCompleted]=useState(block?.completed||false);
  // Which day to add this new activity to — only relevant when adding (isNew), since an existing
  // block always stays on the day it's actually placed. Defaults to whatever day the modal was
  // opened from (today, when opened via the Weekly header's + button), but can be moved to any
  // other day in the currently-viewed week, filtered to today-forward per the explicit ask —
  // you can't backdate a new activity into a day that's already passed.
  const today=iso();
  const selectableDates=isNew?(weekDates||[]).filter(d=>d>=today):[];
  const [selectedDate,setSelectedDate]=useState(dateStr);
  const effectiveDate=isNew?selectedDate:dateStr;

  function handleSave(){
    const s=t2m(startTime),e=t2m(endTime);
    if(!Number.isFinite(s)||!Number.isFinite(e)||e<=s)return;
    const now=new Date().toISOString();
    const kind=type==="homework"?"homework":type==="chore"?"chore":"personal";
    const finalCourseId=type==="homework"?(courseId||null):null;
    const wasCompleted=block?.completed||false;
    const nowCompleted=completed;
    // Only genuine content changes (what/when/which course) count as the student authoring or
    // customizing this block — toggling "Mark Complete" by itself does not. Without this check,
    // simply checking off a plain AI-planned block would permanently flag it as userEdited, which
    // then made it immune to "Clear study plan" — a block that's just been completed should still
    // be treated as planner-generated and safe to clear/regenerate, not as a manual creation.
    const contentChanged=isNew
      ||description!==(block?.description||"")
      ||s!==block?.s||e!==block?.e
      ||finalCourseId!==(block?.courseId??null);
    const newUserEdited=contentChanged?true:(block?.userEdited||false);
    const newBlock={
      id:block?.id||`blk_${effectiveDate}_${Date.now()}_${Math.floor(Math.random()*1000)}`,
      courseId:finalCourseId,
      source:block?.source||null,
      kind,
      label:description||(type==="homework"?"Study":type==="chore"?"Chore":"Personal"),
      description,
      s,e,
      userEdited:newUserEdited,
      completed:nowCompleted,
      createdAt:block?.createdAt||now,
      editedAt:isNew?null:now,
      completedAt:nowCompleted?(block?.completedAt||now):null,
    };
    onSave(effectiveDate,newBlock);
    // Only log a completion event on the actual false→true transition — toggling it back off,
    // or saving with no change to completed status, isn't a "did the session happen" signal.
    if(!wasCompleted&&nowCompleted&&onComplete){
      const plannedStart=block?m2t(block.s):startTime;
      const plannedEnd=block?m2t(block.e):endTime;
      onComplete({
        blockId:newBlock.id,source:newBlock.source,courseId:newBlock.courseId,
        plannedStart,plannedEnd,actualCompletedAt:now,
        onTime:dateStr>=iso(), // completed on or after the day it was scheduled for — a rough same-day proxy
      });
    }
    onClose();
  }

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{background:"var(--card)",borderRadius:14,maxWidth:460,width:"100%",boxShadow:"0 20px 60px rgba(0,0,0,0.5)"}}>
        <div style={{padding:"18px 22px",borderBottom:"1px solid var(--b1)"}}>
          <span style={{fontSize:17,fontWeight:600}}>{isNew?"Add Activity":"Edit Activity"}</span>
          {!(isNew&&selectableDates.length>1)&&(
            <div style={{fontSize:12,color:"var(--t3)",marginTop:3}}>{new Date(effectiveDate+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"short",day:"numeric"})}</div>
          )}
        </div>
        <div style={{padding:"18px 22px"}}>
          {isNew&&selectableDates.length>1&&(
            <div style={{marginBottom:12}}>
              <label style={{fontSize:12,color:"var(--t3)",display:"block",marginBottom:5}}>Date</label>
              <select value={selectedDate} onChange={e=>setSelectedDate(e.target.value)} style={{width:"100%"}}>
                {selectableDates.map(d=>(
                  <option key={d} value={d}>{new Date(d+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"short",day:"numeric"})}{d===today?" (today)":""}</option>
                ))}
              </select>
            </div>
          )}
          <div style={{marginBottom:12}}>
            <label style={{fontSize:12,color:"var(--t3)",display:"block",marginBottom:5}}>Type</label>
            <select value={type} onChange={e=>setType(e.target.value)} style={{width:"100%"}}>
              <option value="homework">Study / Homework</option>
              <option value="personal">Personal / Social</option>
              <option value="chore">Chore</option>
            </select>
          </div>
          {type==="homework"&&(
            <div style={{marginBottom:12}}>
              <label style={{fontSize:12,color:"var(--t3)",display:"block",marginBottom:5}}>Course</label>
              <select value={courseId} onChange={e=>setCourseId(+e.target.value)} style={{width:"100%"}}>
                {courses.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          <div style={{marginBottom:12}}>
            <label style={{fontSize:12,color:"var(--t3)",display:"block",marginBottom:5}}>Description</label>
            <input value={description} onChange={e=>setDescription(e.target.value)} placeholder="e.g. Study with Sarah for MATH midterm" style={{width:"100%"}}/>
          </div>
          <div className="g2" style={{marginBottom:4}}>
            <div><label style={{fontSize:12,color:"var(--t3)",display:"block",marginBottom:5}}>Start</label><input type="time" value={startTime} onChange={e=>setStartTime(e.target.value)}/></div>
            <div><label style={{fontSize:12,color:"var(--t3)",display:"block",marginBottom:5}}>End</label><input type="time" value={endTime} onChange={e=>setEndTime(e.target.value)}/></div>
          </div>
          {!isNew&&(
            <div style={{marginTop:12,display:"flex",alignItems:"center",gap:8,padding:"9px 11px",background:completed?"var(--green-bg)":"var(--card2)",borderRadius:8,cursor:"pointer"}}
              onClick={()=>setCompleted(c=>!c)}>
              <div style={{width:20,height:20,borderRadius:5,border:`2px solid ${completed?"var(--green)":"var(--t3)"}`,background:completed?"var(--green)":"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                {completed&&<i className="ti ti-check" style={{fontSize:13,color:"#0a2410"}}/>}
              </div>
              <span style={{fontSize:14,color:completed?"var(--green)":"var(--t2)"}}>Mark as completed</span>
            </div>
          )}
        </div>
        <div style={{padding:"14px 22px",borderTop:"1px solid var(--b1)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          {!isNew&&onDelete?(
            confirmingDelete?(
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <span style={{fontSize:13,color:"var(--red)"}}>Delete this activity?</span>
                <button className="btn btn-sm" style={{background:"var(--red)",color:"#fff"}} onClick={()=>{onDelete(dateStr,block.id);onClose();}}>Yes, delete</button>
                <button className="btn btn-ghost btn-sm" onClick={()=>setConfirmingDelete(false)}>Cancel</button>
              </div>
            ):(
              <button className="btn btn-ghost btn-sm" style={{color:"var(--red)"}} onClick={()=>setConfirmingDelete(true)}>
                <i className="ti ti-trash" style={{marginRight:4}}/>Delete
              </button>
            )
          ):<div/>}
          <div style={{display:"flex",gap:8}}>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-action" onClick={handleSave}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SyncResultModal({result,onClose,onPlanNow,planning}){
  if(!result)return null;
  const {added,skippedDuplicate,coursesFound,coursesCreated,itemsByCourse,fileNames,error}=result;
  const hasNewItems=added>0&&!error;
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{background:"var(--card)",borderRadius:14,maxWidth:560,width:"100%",maxHeight:"85vh",overflow:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.5)"}}>
        <div style={{padding:"20px 24px",borderBottom:"1px solid var(--b1)"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <i className={`ti ${error?"ti-alert-triangle":"ti-circle-check"}`} style={{fontSize:22,color:error?"var(--red)":"var(--green)"}}/>
            <span style={{fontSize:18,fontWeight:600}}>{error?"Sync failed":"Sync complete"}</span>
          </div>
          <div style={{fontSize:13,color:"var(--t3)",marginTop:6}}>{fileNames?.join(", ")}</div>
        </div>
        <div style={{padding:"20px 24px"}}>
          {error?(
            <div style={{color:"var(--red)",fontSize:14}}>{error}</div>
          ):(<>
            <div style={{display:"flex",gap:16,marginBottom:18,flexWrap:"wrap"}}>
              <div style={{background:"var(--green-bg)",borderRadius:10,padding:"10px 16px",flex:1,minWidth:120}}>
                <div style={{fontSize:24,fontWeight:700,color:"var(--green)"}}>{added}</div>
                <div style={{fontSize:12,color:"var(--t2)"}}>items added</div>
              </div>
              {coursesCreated>0&&(
                <div style={{background:"var(--blue-bg)",borderRadius:10,padding:"10px 16px",flex:1,minWidth:120}}>
                  <div style={{fontSize:24,fontWeight:700,color:"var(--blue)"}}>{coursesCreated}</div>
                  <div style={{fontSize:12,color:"var(--t2)"}}>courses created</div>
                </div>
              )}
              {skippedDuplicate>0&&(
                <div style={{background:"var(--amber-bg)",borderRadius:10,padding:"10px 16px",flex:1,minWidth:120}}>
                  <div style={{fontSize:24,fontWeight:700,color:"var(--amber)"}}>{skippedDuplicate}</div>
                  <div style={{fontSize:12,color:"var(--t2)"}}>already existed, skipped</div>
                </div>
              )}
            </div>
            {coursesFound?.length>0&&(
              <div style={{marginBottom:14}}>
                <div style={{fontSize:12,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:8}}>Courses found in this document</div>
                {coursesFound.map((c,i)=>(
                  <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:i<coursesFound.length-1?"1px solid var(--b1)":"none"}}>
                    <span style={{fontSize:14}}>{c}</span>
                    <span style={{fontSize:13,color:"var(--t3)"}}>{itemsByCourse?.[c]?.assignments||0} assignments, {itemsByCourse?.[c]?.exams||0} exams</span>
                  </div>
                ))}
              </div>
            )}
          </>)}
        </div>
        <div style={{padding:"16px 24px",borderTop:"1px solid var(--b1)",display:"flex",justifyContent:"flex-end",gap:10}}>
          <button className="btn btn-ghost" onClick={onClose} style={{padding:"8px 20px"}}>
            {hasNewItems?"Not now":"OK"}
          </button>
          {hasNewItems&&onPlanNow&&(
            <button className="btn btn-action" onClick={onPlanNow} disabled={planning} style={{padding:"8px 20px"}}>
              {planning?<><Sp sz={13}/> Planning...</>:<><i className="ti ti-sparkles"/> Create study plan</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Reusable "help" banner — unlike ConfirmModal, deliberately has NO backdrop-click-dismiss.
// The student must explicitly close it (closeLabel button), so it can't be accidentally skipped
// past without at least seeing it once.
export function InfoModal({title,sections,closeLabel="Got it",onClose}){
  return(
    <div style={{
      position:"fixed",inset:0,zIndex:9000,
      background:"rgba(0,0,0,0.55)",
      display:"flex",alignItems:"center",justifyContent:"center",
      padding:20,
    }}>
      <div style={{
        background:"var(--card)",borderRadius:14,
        padding:"28px 32px",maxWidth:460,width:"100%",maxHeight:"85vh",overflowY:"auto",
        boxShadow:"0 24px 60px rgba(0,0,0,0.5)"
      }}>
        <div style={{fontSize:17,color:"var(--t1)",fontWeight:600,marginBottom:18}}>{title}</div>
        {sections.map((sec,i)=>(
          <div key={i} style={{marginBottom:i<sections.length-1?16:24}}>
            {sec.heading&&<div style={{fontSize:14,fontWeight:600,color:"var(--t1)",marginBottom:4}}>{sec.heading}</div>}
            <div style={{fontSize:13,color:"var(--t2)",lineHeight:1.6}}>{sec.body}</div>
          </div>
        ))}
        <button onClick={onClose} style={{width:"100%",padding:"10px 0",borderRadius:9,border:"none",cursor:"pointer",
          background:"var(--amber)",color:"#1a1206",fontSize:14,fontWeight:600,fontFamily:"inherit"}}>
          {closeLabel}
        </button>
      </div>
    </div>
  );
}


export function ConfirmModal({message,confirmLabel="Yes",confirmIcon,onConfirm,onCancel}){
  return(
    <div style={{
      position:"fixed",inset:0,zIndex:9000,
      background:"rgba(0,0,0,0.55)",
      display:"flex",alignItems:"center",justifyContent:"center"
    }}
    onClick={onCancel}>
      <div
        onClick={e=>e.stopPropagation()}
        style={{
          background:"var(--card)",borderRadius:14,
          padding:"28px 32px",maxWidth:380,width:"90%",
          boxShadow:"0 24px 60px rgba(0,0,0,0.5)"
        }}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
          <i className="ti ti-alert-triangle" style={{fontSize:22,color:"var(--red)",flexShrink:0}}/>
          <span style={{fontSize:17,color:"var(--t1)"}}>Are you sure?</span>
        </div>
        <div style={{fontSize:14,color:"var(--t2)",lineHeight:1.6,marginBottom:24}}>
          {message}
        </div>
        <div style={{display:"flex",gap:10}}>
          <button
            onClick={onConfirm}
            style={{flex:1,padding:"10px 0",borderRadius:9,border:"none",cursor:"pointer",
              background:"var(--red)",color:"#fff",fontSize:14,fontFamily:"inherit",
              display:"flex",alignItems:"center",justifyContent:"center",gap:7}}>
            {confirmIcon&&<i className={`ti ${confirmIcon}`} style={{fontSize:15}}/>}{confirmLabel}
          </button>
          <button
            onClick={onCancel}
            style={{flex:1,padding:"10px 0",borderRadius:9,border:"none",cursor:"pointer",
              background:"var(--card2)",color:"var(--t2)",fontSize:14,fontFamily:"inherit"}}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// Hook for confirm dialog — use anywhere
export function useConfirm(){
  const [state,setState]=React.useState(null);
  function confirm(message,opts){
    return new Promise(resolve=>{
      setState({message,resolve,confirmLabel:opts?.confirmLabel,confirmIcon:opts?.confirmIcon});
    });
  }
  function handleConfirm(){state?.resolve(true);setState(null);}
  function handleCancel(){state?.resolve(false);setState(null);}
  const modal=state?<ConfirmModal message={state.message} confirmLabel={state.confirmLabel} confirmIcon={state.confirmIcon} onConfirm={handleConfirm} onCancel={handleCancel}/>:null;
  return {confirm,modal};
}

// ── APP SHELL ────────────────────────────────────────────────────────────────
// Separate component (not inline in App) specifically so its draft state resets fresh every time
// it mounts — i.e. every time the modal opens — rather than persisting stale edits across opens.
// Unlike every other field in the app, this one deliberately does NOT auto-save on change: this
// is sensitive personal data (now including username/password placeholders), and per explicit
// instruction, updates here need a real, intentional Save action.
export function AccountModal({data,updP,toast2,onClose,onSignOut,onReset,userEmail}){
  const p=data.profile;
  const {confirm,modal}=useConfirm();
  const [draft,setDraft]=useState(()=>({
    name:p.name,lastName:p.lastName||"",phone:p.phone,email:p.email||"",
    homeAddress:p.homeAddress,username:p.username||"",password:p.password||"",
  }));
  const baseline=JSON.stringify({
    name:p.name,lastName:p.lastName||"",phone:p.phone,email:p.email||"",
    homeAddress:p.homeAddress,username:p.username||"",password:p.password||"",
  });
  const dirty=JSON.stringify(draft)!==baseline;
  const set=field=>e=>setDraft(d=>({...d,[field]:e.target.value}));

  function save(){
    updP(draft);
    toast2("Account details saved");
    onClose();
  }
  async function handleClose(){
    if(dirty){
      const ok=await confirm("Discard unsaved changes to your account details?",{confirmLabel:"Discard",confirmIcon:"ti-trash"});
      if(!ok)return;
    }
    onClose();
  }

  // "Reset all data" — moved here from Preferences and hardened with two real gates: the account
  // password (re-verified via signInWithPassword — Supabase has no separate "check password"
  // call, so re-authenticating IS the check) before the destructive action is even offered, then
  // the usual are-you-sure with an explicit description of what's erased. Resets data only — the
  // Supabase account/login itself is untouched, so a wrong click can't lock anyone out.
  const [resetOpen,setResetOpen]=useState(false);
  const [resetPw,setResetPw]=useState("");
  const [resetErr,setResetErr]=useState("");
  const [resetBusy,setResetBusy]=useState(false);
  async function verifyAndReset(){
    if(!resetPw){setResetErr("Enter your password");return;}
    setResetBusy(true);setResetErr("");
    const{error}=await supabase.auth.signInWithPassword({email:userEmail,password:resetPw});
    setResetBusy(false);
    if(error){setResetErr("Incorrect password");return;}
    setResetPw("");setResetOpen(false);
    const ok=await confirm(
      "This permanently erases ALL your data — courses, assignments, exams, grades, study plan, preferences, and history — and sends you back through onboarding. Your login stays active; only your data is erased. This cannot be undone.",
      {confirmLabel:"Erase everything",confirmIcon:"ti-trash"}
    );
    if(ok){onReset?.();toast2("All data erased");onClose();}
  }

  return(
    <div style={{position:"fixed",inset:0,zIndex:9000,background:"rgba(0,0,0,0.55)",
      display:"flex",alignItems:"center",justifyContent:"center",padding:20}}
      onClick={handleClose}>
      <div style={{background:"var(--card)",borderRadius:14,padding:"20px 24px",
        maxWidth:420,width:"100%",maxHeight:"85vh",overflowY:"auto",
        boxShadow:"0 24px 60px rgba(0,0,0,0.5)"}}
        onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div style={{fontSize:16,fontWeight:600,color:"var(--t1)"}}>
            <i className="ti ti-user-circle" style={{marginRight:8,color:"var(--blue)"}}/>Account
          </div>
          <button className="btn btn-ghost btn-sm" onClick={handleClose}><i className="ti ti-x"/></button>
        </div>
        <div className="g2" style={{marginBottom:12}}>
          <div><label>First name</label><input value={draft.name} onChange={set("name")}/></div>
          <div><label>Last name</label><input value={draft.lastName} onChange={set("lastName")}/></div>
        </div>
        <div className="g2" style={{marginBottom:12}}>
          <div><label>WhatsApp</label><input value={draft.phone} onChange={set("phone")}/></div>
          <div><label>Email</label><input type="email" value={draft.email} onChange={set("email")}/></div>
        </div>
        <div style={{marginBottom:12}}><label>Home address</label><input value={draft.homeAddress} onChange={set("homeAddress")}/></div>
        <div style={{fontSize:12,color:"var(--t3)",marginBottom:14,paddingTop:6,borderTop:"1px solid var(--b1)"}}>
          For future login/authentication — not active yet.
        </div>
        <div className="g2" style={{marginBottom:18}}>
          <div><label>Username</label><input value={draft.username} onChange={set("username")}/></div>
          <div><label>Password</label><input type="password" value={draft.password} onChange={set("password")}/></div>
        </div>
        <button className={dirty?"btn btn-action":"btn btn-ghost"} style={{width:"100%"}} onClick={save} disabled={!dirty}>
          <i className="ti ti-device-floppy" style={{marginRight:6}}/>{dirty?"Save":"No changes to save"}
        </button>
        {onSignOut&&(
          <div style={{marginTop:16,paddingTop:14,borderTop:"1px solid var(--b1)"}}>
            {userEmail&&<div style={{fontSize:12,color:"var(--t3)",marginBottom:8}}>Signed in as {userEmail}</div>}
            <button className="btn btn-del" style={{width:"100%"}} onClick={onSignOut}>
              <i className="ti ti-logout" style={{marginRight:6}}/>Sign out
            </button>
          </div>
        )}
        {onReset&&(
          <div style={{marginTop:16,paddingTop:14,borderTop:"1px solid var(--b1)"}}>
            <div style={{fontSize:11,color:"var(--red)",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:9,fontWeight:600}}>
              Danger zone
            </div>
            {!resetOpen?(
              <button className="btn btn-del" style={{width:"100%"}} onClick={()=>{setResetOpen(true);setResetErr("");}}>
                <i className="ti ti-trash" style={{marginRight:6}}/>Reset all data
              </button>
            ):(
              <div>
                <p style={{fontSize:12,color:"var(--t3)",marginBottom:8,lineHeight:1.5}}>
                  Confirm your password to continue — this erases all your data, courses, and plan.
                </p>
                <input type="password" value={resetPw} autoFocus
                  onChange={e=>{setResetPw(e.target.value);setResetErr("");}}
                  onKeyDown={e=>{if(e.key==="Enter")verifyAndReset();}}
                  placeholder="Your password" style={{marginBottom:6}}/>
                {resetErr&&<div style={{fontSize:12,color:"var(--red)",marginBottom:8}}>{resetErr}</div>}
                <div style={{display:"flex",gap:8}}>
                  <button className="btn btn-ghost btn-sm" style={{flex:1}}
                    onClick={()=>{setResetOpen(false);setResetPw("");setResetErr("");}}>Cancel</button>
                  <button className="btn btn-del btn-sm" style={{flex:1}} onClick={verifyAndReset} disabled={resetBusy||!resetPw}>
                    {resetBusy?"Verifying...":"Continue"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {modal}
    </div>
  );
}
