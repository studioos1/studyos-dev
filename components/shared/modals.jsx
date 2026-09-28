import React, { useState, useEffect } from "react";
import { iso, t2m, m2t } from "@/lib/time";
import { checkSyllabusExtraction, findProbableDuplicate } from "@/lib/syllabus";
import { findMatchingCourse } from "@/lib/courses";
import { supabase } from "@/lib/supabase";
import { getMyInviteInfo } from "@/lib/invites";
import { sparkleBurst } from "@/lib/sparkle";
import { Sp, ExtractionIssues, PasswordInput } from "./ui";
import { SideDrawer, DrawerHeader } from "./SideDrawer";

// Shown right after the AI parses a syllabus/schedule PDF, BEFORE anything is saved to
// data.assignments/data.exams. Gives the student one place to catch and fix any misclassified
// item (e.g. a quiz the AI called an exam) or wrong date/weight, rather than discovering it
// later in a cluttered calendar. A single "Looks good, save all" button confirms everything as-is
// for the common case; per-row editing is only needed when something's actually wrong.
export function ExtractionVerifyModal({parsed,courses,termStart,termEnd,existingAssignments=[],existingExams=[],sourceText,onConfirm,onCancel,onPlanNow,planning}){
  const [saving,setSaving]=useState(false);
  // Deterministic sanity check on the raw AI output — surfaces misreads (a heading taken for a
  // course, a wrong-year date) up front so the student can re-upload instead of hand-fixing rows.
  // sourceText (the raw PDF text actually sent to the AI) enables the completeness cross-check —
  // optional so this still works from any caller that hasn't wired it through.
  const {issues}=checkSyllabusExtraction(parsed,{courses,termStart,termEnd,sourceText});
  // The AI's own completeness self-report (extraction prompt rule 10) — categories it recognized
  // but couldn't find real per-item dates for. Shown separately from `issues` above: this isn't a
  // problem with the extraction, it's the AI being transparent about a real gap in the source
  // document, so it gets its own neutral info block rather than looking like an error/warning.
  const extractionNotes=(parsed.courses||[]).flatMap(c=>(c.extractionNotes||[]).map(n=>({course:c.courseName,note:n})));
  // Flatten into one editable list, tagging each row with its course + a stable local key. Each
  // row is also checked against what's already saved (findProbableDuplicate, lib/syllabus.js) —
  // re-uploading the same or a revised syllabus is common, and a real duplicate was slipping
  // through silently whenever the AI's wording drifted even slightly between two parses of the
  // same PDF. A flagged row gets a checkbox pair instead of a single choice: `existingChecked`
  // (default true — keep what's already saved) and `newChecked` (default false — don't also add
  // the fresh parse) so the default is "do nothing", the safest option, and the student opts INTO
  // replacing/duplicating rather than opting out of it.
  const [rows,setRows]=useState(()=>{
    const out=[];
    (parsed.courses||[]).forEach((c,ci)=>{
      // findMatchingCourse (not a raw name .find) — same course-code-normalizing match finalizeSync
      // itself uses, so which course a duplicate check runs against never diverges from which
      // course the item actually gets saved under. `courses` MUST already be scoped to the viewed
      // term by the caller — a same-named course in another term (a real, confirmed case: an
      // archived "TEST" term alongside a real one) previously resolved to the WRONG course's item
      // list here, silently defeating duplicate detection entirely for that course.
      const course=findMatchingCourse(courses,c.courseName);
      (c.assignments||[]).forEach((a,ai)=>{
        const dup=course?findProbableDuplicate(existingAssignments,course.id,a.title,a.dueDate,"dueDate",existingExams,"date"):null;
        // dupDateField/dupExistingType are fixed at match time (not re-derived from the row's live
        // `type`) — the student can toggle Homework/Exam afterward, which must not change which
        // field/list `dup` itself actually lives on. A cross-type hit (this looks like an exam
        // already saved) can't be safely replaced in place — an assignment's fields
        // (weight/estimatedHours) don't line up with an exam's (topics/prepDays).
        out.push({key:`a_${ci}_${ai}`,courseName:c.courseName,type:"homework",title:a.title,date:a.dueDate,weight:a.weight??null,estimatedHours:a.estimatedHours,topics:null,prepDays:null,dup,dupDateField:dup?(dup._crossType?dup._crossDateField:"dueDate"):null,dupExistingType:dup?(dup._crossType?"exam":"homework"):null,existingChecked:!!dup,newChecked:!dup});
      });
      (c.exams||[]).forEach((e,ei)=>{
        const dup=course?findProbableDuplicate(existingExams,course.id,e.title,e.date,"date",existingAssignments,"dueDate"):null;
        out.push({key:`e_${ci}_${ei}`,courseName:c.courseName,type:"exam",title:e.title,date:e.date,weight:e.weight??null,estimatedHours:null,topics:e.topics||"",prepDays:e.prepDays||7,dup,dupDateField:dup?(dup._crossType?dup._crossDateField:"date"):null,dupExistingType:dup?(dup._crossType?"homework":"exam"):null,existingChecked:!!dup,newChecked:!dup});
      });
    });
    return out;
  });
  const dupCount=rows.filter(r=>r.dup).length;

  function updateRow(key,field,value){
    setRows(rs=>rs.map(r=>r.key===key?{...r,[field]:value}:r));
  }
  function addRow(){
    // New row defaults to the first course found and homework type, checked (nothing to compare
    // against, so there's no reason to default it off). A stable, collision-safe local key since
    // this doesn't come from the parsed AI response.
    const defaultCourse=rows[0]?.courseName||courses[0]?.name||"";
    setRows(rs=>[...rs,{key:`new_${Date.now()}_${Math.floor(Math.random()*1000)}`,courseName:defaultCourse,type:"homework",title:"",date:"",weight:null,estimatedHours:2,topics:null,prepDays:null,dup:null,newChecked:true}]);
  }

  const totalCourses=new Set(rows.map(r=>r.courseName)).size;

  // Two-step flow: review the possible duplicates → see a plain-language summary of what will
  // actually happen → confirm (or go back and change something). Real request: "'Looks good, save
  // all' > we shall have 'Looks good, Next step' > summary of the new items to upload... then
  // Confirm or Back." Built once when moving to the summary (rows don't change on that screen) and
  // reused for the actual save, so the count shown is exactly what gets saved — never recomputed
  // out of sync with what the student already reviewed.
  const [step,setStep]=useState("review");
  const [plan,setPlan]=useState(null);
  const [result,setResult]=useState(null);

  function buildPlan(){
    // Rebuild into the courses[].assignments/exams shape syncSyl expects, from the (possibly
    // edited) flat row list. Four real outcomes per flagged row, read off its two checkboxes:
    //   existing✓ new✗ → keep what's saved, don't add the new parse (the default — do nothing)
    //   existing✓ new✓ → keep both — new parse added as a genuinely separate item
    //   existing✗ new✓ → replace — _replaceId updates the existing item in place, preserving its
    //                     id/status/completedAt, rather than deleting + re-adding
    //   existing✗ new✗ → the existing item is unwanted and nothing is replacing it — delete it
    // A plain row (AI-found with no dup, or manually added) only has `newChecked`: true unless the
    // student unchecked a manually-added one (plain AI-found rows are never shown to uncheck).
    const byCourse={};
    const deleteAssignmentIds=[],deleteExamIds=[];
    // Itemized, not just counted — real follow-up: "when are we showing the complete readout of
    // the items?" The summary step lists every title, not just a number.
    const addedItems=[],replacedItems=[],removedItems=[];
    rows.forEach(r=>{
      if(r.dup){
        if(!r.existingChecked&&!r.newChecked){
          (r.dupExistingType==="exam"?deleteExamIds:deleteAssignmentIds).push(r.dup.id);
          removedItems.push({courseName:r.courseName,title:r.dup.title,date:r.dup[r.dupDateField]});
          return;
        }
        if(!r.newChecked)return; // existing✓ new✗ — nothing to add, existing stays as-is
        const dupMeta=r.existingChecked?{}:{_replaceId:r.dup.id};
        (r.existingChecked?addedItems:replacedItems).push({courseName:r.courseName,title:r.title,date:r.date});
        if(!byCourse[r.courseName])byCourse[r.courseName]={courseName:r.courseName,assignments:[],exams:[]};
        if(r.type==="homework"){
          byCourse[r.courseName].assignments.push({title:r.title,dueDate:r.date,weight:r.weight,estimatedHours:r.estimatedHours||2,...dupMeta});
        }else{
          byCourse[r.courseName].exams.push({title:r.title,date:r.date,weight:r.weight,topics:r.topics||"",prepDays:r.prepDays||7,...dupMeta});
        }
        return;
      }
      if(!r.newChecked)return;
      addedItems.push({courseName:r.courseName,title:r.title,date:r.date});
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
    return{rebuilt,deleteAssignmentIds,deleteExamIds,addedItems,replacedItems,removedItems};
  }

  function goToSummary(){
    setPlan(buildPlan());
    setStep("summary");
  }

  async function handleConfirm(){
    setSaving(true);
    // finalizeSync (Acad.jsx) does real work here — a course-difficulty lookup (network call) per
    // NEW course — awaiting it keeps the spinner visible for the actual duration, not just an
    // instant flash. It RETURNS the result instead of closing anything itself — real request:
    // "keep the rest of the flow over the same side-page rather than jumping to popup." The
    // confirmation ("final confirmation message") is the "done" step below, in this same drawer.
    const res=await onConfirm({...parsed,courses:plan.rebuilt,_deleteExisting:{assignmentIds:plan.deleteAssignmentIds,examIds:plan.deleteExamIds}});
    setSaving(false);
    setResult(res);
    setStep("done");
  }

  return(
    <SideDrawer open width={860}
      header={<>
        <DrawerHeader icon="ti-list-check" title="Verify What We Found" onClose={onCancel}/>
        <div style={{fontSize:12.5,color:"var(--t3)",marginTop:5}}>
          {step==="review"
            ?`${rows.length} item${rows.length!==1?"s":""} across ${totalCourses} course${totalCourses!==1?"s":""} — check the type on each, then continue.`
            :step==="summary"?"Review what will actually be saved, then confirm."
            :result?.error?"Something went wrong saving.":"Saved."}
        </div>
      </>}>
      {step==="review"&&issues.length>0&&(
        <div style={{marginTop:14}}>
          <ExtractionIssues issues={issues} onReupload={onCancel}/>
        </div>
      )}
      {step==="review"&&extractionNotes.length>0&&(
        <div style={{marginTop:14,background:"var(--card2)",borderRadius:9,padding:"11px 13px"}}>
          <div style={{display:"flex",alignItems:"center",gap:7,fontSize:13,fontWeight:600,color:"var(--t2)",marginBottom:6}}>
            <i className="ti ti-info-circle" style={{fontSize:15}}/>
            What the AI couldn't find individual dates for
          </div>
          <ul style={{margin:0,paddingLeft:18,fontSize:12,color:"var(--t3)",lineHeight:1.6}}>
            {extractionNotes.map((n,i)=><li key={i}>{totalCourses>1?`${n.course}: `:""}{n.note}</li>)}
          </ul>
        </div>
      )}
      {step==="review"&&dupCount>0&&(
        <div style={{marginTop:14,padding:"9px 13px",background:"var(--card2)",borderRadius:9,
          display:"flex",alignItems:"center",gap:9,fontSize:13,color:"var(--t2)"}}>
          <i className="ti ti-copy" style={{fontSize:16,flexShrink:0,color:"var(--amber)"}}/>
          {dupCount} item{dupCount!==1?"s look":" looks"} like {dupCount!==1?"duplicates":"a duplicate"} of something already saved — shown paired below (Existing vs. New) so you can compare, each with its own checkboxes.
        </div>
      )}
      {step==="done"?(
        // The final confirmation, in this same drawer — real request: "keep the rest of the flow
        // over the same side-page rather than jumping to popup." Same tiles SyncResultModal used
        // to show as a separate centered popup, now embedded here instead.
        <div style={{marginTop:14}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
            <i className={`ti ${result?.error?"ti-alert-triangle":"ti-circle-check"}`} style={{fontSize:22,color:result?.error?"var(--red)":"var(--green)"}}/>
            <span style={{fontSize:16,fontWeight:600,color:"var(--t1)"}}>{result?.error?"Sync failed":"Sync complete"}</span>
          </div>
          {result?.error?(
            <div style={{color:"var(--red)",fontSize:14}}>{result.error}</div>
          ):(<>
            <div style={{display:"flex",gap:12,marginBottom:18,flexWrap:"wrap"}}>
              <div style={{background:"var(--green-bg)",borderRadius:10,padding:"10px 16px",flex:1,minWidth:120}}>
                <div style={{fontSize:24,fontWeight:700,color:"var(--green)"}}>{result?.added||0}</div>
                <div style={{fontSize:12,color:"var(--t2)"}}>items added</div>
              </div>
              {result?.coursesCreated>0&&(
                <div style={{background:"var(--blue-bg)",borderRadius:10,padding:"10px 16px",flex:1,minWidth:120}}>
                  <div style={{fontSize:24,fontWeight:700,color:"var(--blue)"}}>{result.coursesCreated}</div>
                  <div style={{fontSize:12,color:"var(--t2)"}}>courses created</div>
                </div>
              )}
              {result?.replaced>0&&(
                <div style={{background:"var(--teal-bg)",borderRadius:10,padding:"10px 16px",flex:1,minWidth:120}}>
                  <div style={{fontSize:24,fontWeight:700,color:"var(--teal)"}}>{result.replaced}</div>
                  <div style={{fontSize:12,color:"var(--t2)"}}>updated</div>
                </div>
              )}
              {result?.removed>0&&(
                <div style={{background:"var(--red-bg)",borderRadius:10,padding:"10px 16px",flex:1,minWidth:120}}>
                  <div style={{fontSize:24,fontWeight:700,color:"var(--red)"}}>{result.removed}</div>
                  <div style={{fontSize:12,color:"var(--t2)"}}>removed</div>
                </div>
              )}
            </div>
            {result?.coursesFound?.length>0&&(
              <div>
                <div style={{fontSize:12,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:8}}>Courses found in this document</div>
                {result.coursesFound.map((c,i)=>(
                  <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:i<result.coursesFound.length-1?"1px solid var(--b1)":"none"}}>
                    <span style={{fontSize:14}}>{c}</span>
                    <span style={{fontSize:13,color:"var(--t3)"}}>{result.itemsByCourse?.[c]?.assignments||0} assignments, {result.itemsByCourse?.[c]?.exams||0} exams</span>
                  </div>
                ))}
              </div>
            )}
          </>)}
        </div>
      ):step==="summary"?(
        // The complete readout, itemized — not just a count — before anything is actually
        // written. Real follow-up: "when are we showing the complete readout of the items?"
        <div style={{marginTop:14}}>
          <div style={{fontSize:15,fontWeight:600,color:"var(--t1)",marginBottom:14}}>
            {plan.addedItems.length} new item{plan.addedItems.length!==1?"s":""} will be uploaded
            {plan.replacedItems.length>0?`, ${plan.replacedItems.length} existing item${plan.replacedItems.length!==1?"s":""} updated`:""}
            {plan.removedItems.length>0?`, ${plan.removedItems.length} removed`:""}.
          </div>
          {[
            {label:"New",items:plan.addedItems,color:"var(--green)"},
            {label:"Updated",items:plan.replacedItems,color:"var(--teal)"},
            {label:"Removed",items:plan.removedItems,color:"var(--red)"},
          ].filter(g=>g.items.length>0).map(g=>(
            <div key={g.label} style={{marginBottom:16}}>
              <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.04em",color:g.color,marginBottom:6}}>{g.label} ({g.items.length})</div>
              {g.items.map((it,i)=>(
                <div key={i} style={{display:"flex",justifyContent:"space-between",gap:10,padding:"6px 0",borderBottom:i<g.items.length-1?"1px solid var(--b1)":"none",fontSize:13}}>
                  <span style={{color:"var(--t1)"}}>{it.title||"(untitled)"}</span>
                  <span style={{color:"var(--t3)",flexShrink:0}}>{it.courseName}{it.date?` · ${it.date}`:""}</span>
                </div>
              ))}
            </div>
          ))}
          {plan.addedItems.length===0&&plan.replacedItems.length===0&&plan.removedItems.length===0&&(
            <div style={{color:"var(--t3)",fontSize:13}}>Nothing will change — every duplicate was left as-is.</div>
          )}
        </div>
      ):rows.length===0?(
        <div style={{color:"var(--t3)",padding:"20px 0"}}>Nothing was found to import.</div>
      ):(
        <div style={{marginTop:14}}>
          {/* Fixed-width column header, real .ev-* grid (globals.css) — the SAME columns every
              row lines up against, table-style, whether it's a plain single-line item or one half
              of an Existing/New comparison pair. Hidden on mobile, where the grid swaps to a
              3-line layout instead. */}
          <div className="ev-header">
            <div/><div>Class</div><div>Type</div><div>Title</div><div>Date</div><div>Wt %</div><div>Keep</div>
          </div>
          {rows.map(r=>(
            // Small breathing room + a clear divider between every couple — real feedback: "add
            // small space between each couple for better readability."
            <div key={r.key} className="ev-item">
              {r.dup?(<>
                {/* A possible duplicate is two READ-ONLY rows — Existing directly above New, in
                    the exact same columns, nothing editable here — real feedback: "display two
                    lines... in a way to see exactly how they compare... EXACTLY under the
                    existing, without shift right or left." The checkbox is the only control;
                    correcting a value (if the New one needs it) happens after saving, in Courses. */}
                <div className="ev-row ev-row-saved">
                  <div className="ev-f-tag">Existing</div>
                  <div className="ev-f-course ev-plain">{r.courseName}</div>
                  <div className="ev-f-type"><span>{r.dupExistingType==="exam"?"Exam":"HW"}</span></div>
                  <div className="ev-f-title ev-plain" title={r.dup.title}>{r.dup.title}</div>
                  <div className="ev-f-date ev-plain">{r.dup[r.dupDateField]||"—"}</div>
                  <div className="ev-f-weight ev-plain">{r.dup.weight??"—"}</div>
                  <div className={`chk ev-f-check tt${r.existingChecked?" on":""}`} data-tt="Check to save, uncheck to remove/skip" onClick={()=>updateRow(r.key,"existingChecked",!r.existingChecked)}>
                    {r.existingChecked&&<i className="ti ti-check" style={{fontSize:10,color:"var(--green)"}}/>}
                  </div>
                </div>
                <div className="ev-row ev-row-new">
                  <div className="ev-f-tag">New</div>
                  <div className="ev-f-course ev-plain">{r.courseName}</div>
                  <div className="ev-f-type"><span>{r.type==="exam"?"Exam":"HW"}</span></div>
                  <div className="ev-f-title ev-plain" title={r.title}>{r.title}</div>
                  <div className="ev-f-date ev-plain">{r.date||"—"}</div>
                  <div className="ev-f-weight ev-plain">{r.weight??"—"}</div>
                  <div className={`chk ev-f-check tt${r.newChecked?" on":""}`} data-tt="Check to save, uncheck to remove/skip" onClick={()=>updateRow(r.key,"newChecked",!r.newChecked)}>
                    {r.newChecked&&<i className="ti ti-check" style={{fontSize:10,color:"var(--green)"}}/>}
                  </div>
                </div>
              </>):(
                // No existing match — one fully editable row, same as before.
                <div className="ev-row ev-row-new">
                  <div className="ev-f-tag">New</div>
                  <select className="ev-f-course" value={r.courseName} onChange={e=>updateRow(r.key,"courseName",e.target.value)}>
                    {!courses.find(c=>c.name===r.courseName)&&r.courseName&&<option value={r.courseName}>{r.courseName}</option>}
                    {courses.map(c=><option key={c.id} value={c.name}>{c.name}</option>)}
                  </select>
                  {/* Single-click buttons, not a <select> — a neutral "selected" highlight, not
                      amber (real feedback, twice: an amber fill on every row's type button read as
                      loud/alarming — amber now stays reserved for the Existing/New pairing itself). */}
                  <div className="ev-f-type">
                    <button type="button" className={r.type==="homework"?"on":""} onClick={()=>updateRow(r.key,"type","homework")}>HW</button>
                    <button type="button" className={r.type==="exam"?"on":""} onClick={()=>updateRow(r.key,"type","exam")}>Exam</button>
                  </div>
                  <div className="ev-f-title">
                    <input value={r.title||""} onChange={e=>updateRow(r.key,"title",e.target.value)}/>
                  </div>
                  {/* min-width:0 (in .ev-row/.ev-f-date, globals.css) is load-bearing — without it
                      a native date input's intrinsic content width won't shrink to its grid track,
                      which is what caused a previously reported horizontal scrollbar. */}
                  <input className="ev-f-date" type="date" value={r.date||""} onChange={e=>updateRow(r.key,"date",e.target.value)}/>
                  <input className="ev-f-weight" type="number" min="0" max="100" step="0.5" value={r.weight??""} onChange={e=>updateRow(r.key,"weight",e.target.value===""?null:+e.target.value)} placeholder="—"/>
                  {/* The checkbox is now the ONLY way to exclude a row — the old per-row remove
                      (✕) button is gone; leaving this unchecked has the same effect. */}
                  <div className={`chk ev-f-check tt${r.newChecked?" on":""}`} data-tt="Check to save, uncheck to remove/skip" onClick={()=>updateRow(r.key,"newChecked",!r.newChecked)}>
                    {r.newChecked&&<i className="ti ti-check" style={{fontSize:10,color:"var(--green)"}}/>}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {step==="review"&&(
        <button className="btn btn-ghost btn-sm" style={{marginTop:2,marginBottom:16}} onClick={addRow}>
          <i className="ti ti-plus" style={{marginRight:5}}/>Add missing item
        </button>
      )}
      {/* Sticky footer, pinned to the drawer's own edges (negative margins cancel SideDrawer's
          body padding) so the buttons stay reachable without scrolling through every row. Three
          steps, three button sets — real request: "'Looks good, save all' > we shall have 'Looks
          good, Next step' > summary... then Confirm or Back," plus "keep the rest of the flow over
          the same side-page rather than jumping to popup" (the done step below, replacing what
          used to be a separate SyncResultModal popup once finalizeSync finished). */}
      <div style={{position:"sticky",bottom:-24,margin:"0 -24px -24px",padding:"14px 24px",
        background:"var(--card)",borderTop:"1px solid var(--b1)",display:"flex",justifyContent:"flex-end",gap:10}}>
        {step==="review"?(<>
          <button className="btn btn-ghost" style={{padding:"8px 20px"}} onClick={onCancel}>Cancel</button>
          <button className="btn btn-action" style={{padding:"8px 20px"}} onClick={goToSummary}>
            <i className="ti ti-check" style={{marginRight:6}}/>Looks good, next step
          </button>
        </>):step==="summary"?(<>
          <button className="btn btn-ghost" style={{padding:"8px 20px"}} onClick={()=>setStep("review")} disabled={saving}>Back</button>
          <button className="btn btn-action" style={{padding:"8px 20px"}} onClick={handleConfirm} disabled={saving}>
          {saving?<><Sp/> Saving...</>:<><i className="ti ti-check" style={{marginRight:6}}/>Confirm</>}
          </button>
        </>):(<>
          <button className="btn btn-ghost" style={{padding:"8px 20px"}} onClick={onCancel}>
            {result?.added>0&&!result?.error?"Not now":"Close"}
          </button>
          {result?.added>0&&!result?.error&&onPlanNow&&(
            <button className="btn btn-action" style={{padding:"8px 20px"}} onClick={onPlanNow} disabled={planning}>
              {planning?<><Sp sz={13}/> Planning...</>:<><i className="ti ti-sparkles" style={{marginRight:6}}/>Create study plan</>}
            </button>
          )}
        </>)}
      </div>
    </SideDrawer>
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

  // Same "can't act on a time slot that hasn't happened yet" rule as Progress's
  // todayPassedBlocks, applied here in the two places editing a block can violate it: you
  // shouldn't be able to (re)schedule a today block to start in the past relative to right now,
  // and you shouldn't be able to mark one complete before its (possibly just-edited) end time has
  // actually passed. Only meaningful for today — a future day's whole timeline is ahead of now by
  // definition, and a past day is already fully behind it.
  const nowHM=(()=>{const d=new Date();return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;})();
  const nowMin=t2m(nowHM);
  const editingToday=effectiveDate===today;
  const startTooEarly=editingToday&&t2m(startTime)<nowMin;
  const blockTimePassed=dateStr<today||(dateStr===today&&t2m(endTime)<=nowMin);

  function handleSave(){
    const s=t2m(startTime),e=t2m(endTime);
    if(!Number.isFinite(s)||!Number.isFinite(e)||e<=s)return;
    if(editingToday&&s<nowMin)return; // can't schedule a today block to start in the past
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
            <div><label style={{fontSize:12,color:"var(--t3)",display:"block",marginBottom:5}}>Start</label><input type="time" value={startTime} min={editingToday?nowHM:undefined} onChange={e=>setStartTime(e.target.value)}/></div>
            <div><label style={{fontSize:12,color:"var(--t3)",display:"block",marginBottom:5}}>End</label><input type="time" value={endTime} min={editingToday?startTime:undefined} onChange={e=>setEndTime(e.target.value)}/></div>
          </div>
          {startTooEarly&&(
            <div style={{fontSize:12,color:"var(--red)",marginBottom:4}}>Can't schedule a start time in the past.</div>
          )}
          {!isNew&&(()=>{
            // Locked shut only while UNCHECKED and the block's own time hasn't passed — an
            // already-completed block can still be unchecked any time, to fix a mistake.
            const disabledComplete=!completed&&!blockTimePassed;
            return(
              <div className="tt" data-tt={disabledComplete?"Available once this session's scheduled time has passed":undefined}
                style={{marginTop:12,display:"flex",alignItems:"center",gap:8,padding:"9px 11px",
                  background:completed?"var(--green-bg)":"var(--card2)",borderRadius:8,
                  cursor:disabledComplete?"not-allowed":"pointer",opacity:disabledComplete?0.55:1}}
                onClick={disabledComplete?undefined:e=>{setCompleted(c=>!c);if(!completed)sparkleBurst(e.currentTarget,"task");}}>
                <div style={{width:20,height:20,borderRadius:5,border:`2px solid ${completed?"var(--green)":"var(--t3)"}`,background:completed?"var(--green)":"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  {completed&&<i className="ti ti-check" style={{fontSize:13,color:"#0a2410"}}/>}
                </div>
                <span style={{fontSize:14,color:completed?"var(--green)":"var(--t2)"}}>Mark as completed</span>
              </div>
            );
          })()}
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
            <button className="btn btn-action" onClick={handleSave} disabled={startTooEarly}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SyncResultModal({result,onClose,onPlanNow,planning}){
  if(!result)return null;
  const {added,skippedDuplicate,replaced,removed,coursesFound,coursesCreated,itemsByCourse,fileNames,error}=result;
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
              {replaced>0&&(
                <div style={{background:"var(--teal-bg)",borderRadius:10,padding:"10px 16px",flex:1,minWidth:120}}>
                  <div style={{fontSize:24,fontWeight:700,color:"var(--teal)"}}>{replaced}</div>
                  <div style={{fontSize:12,color:"var(--t2)"}}>updated (kept the recent version)</div>
                </div>
              )}
              {skippedDuplicate>0&&(
                <div style={{background:"var(--amber-bg)",borderRadius:10,padding:"10px 16px",flex:1,minWidth:120}}>
                  <div style={{fontSize:24,fontWeight:700,color:"var(--amber)"}}>{skippedDuplicate}</div>
                  <div style={{fontSize:12,color:"var(--t2)"}}>already existed, skipped</div>
                </div>
              )}
              {removed>0&&(
                <div style={{background:"var(--red-bg)",borderRadius:10,padding:"10px 16px",flex:1,minWidth:120}}>
                  <div style={{fontSize:24,fontWeight:700,color:"var(--red)"}}>{removed}</div>
                  <div style={{fontSize:12,color:"var(--t2)"}}>removed (unchecked in review)</div>
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

// Opened from the bug icon in App.jsx's top bar — page/appVersion are captured automatically by
// the caller (current tab, APP_VERSION) so the student only ever has to describe what happened.
export function BugReportModal({onSubmit,onCancel}){
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  async function submit(){
    if(!message.trim()){setError("Describe what happened first.");return;}
    setBusy(true);setError("");
    try{ await onSubmit(message.trim()); }
    catch(err){ setError(err?.message||"Couldn't send that — try again."); setBusy(false); }
  }
  return(
    <div style={{position:"fixed",inset:0,zIndex:9000,background:"rgba(0,0,0,0.55)",
      display:"flex",alignItems:"center",justifyContent:"center",padding:20}}
      onClick={onCancel}>
      <div onClick={e=>e.stopPropagation()} style={{background:"var(--card)",borderRadius:14,
        padding:"24px 26px",maxWidth:420,width:"100%",boxShadow:"0 24px 60px rgba(0,0,0,0.5)"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
          <i className="ti ti-bug" style={{fontSize:20,color:"var(--amber)"}}/>
          <span style={{fontSize:16,fontWeight:600,color:"var(--t1)"}}>Report a bug</span>
        </div>
        <p style={{fontSize:13,color:"var(--t3)",marginBottom:12,lineHeight:1.5}}>
          What happened, and what were you doing right before it? We'll see which page you're on automatically.
        </p>
        {/* fontSize intentionally NOT overridden below 16px here — this field autoFocuses, so on
            iOS a smaller size would trigger Safari's auto-zoom on every single open (see the
            input/select/textarea comment in globals.css) — this was the actual reported bug. */}
        <textarea value={message} onChange={e=>setMessage(e.target.value)} autoFocus
          placeholder="e.g. The Save button on Study Preferences didn't do anything when I clicked it"
          style={{width:"100%",minHeight:100,fontFamily:"inherit",resize:"vertical",marginBottom:10}}/>
        {error&&<div style={{fontSize:13,color:"var(--red)",marginBottom:10}}>{error}</div>}
        <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn btn-action" onClick={submit} disabled={busy}>
            {busy?<><Sp sz={13}/> Sending...</>:<><i className="ti ti-send"/> Send report</>}
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
// `open` controls the SideDrawer's slide animation (components/shared/SideDrawer.jsx) — this
// component now stays MOUNTED the whole time the user is onboarded (App.jsx renders it
// unconditionally, same as HelpDrawer), rather than being created fresh and destroyed each time
// like the old centered-modal version was. That's what makes the open/close motion actually
// animate instead of snapping instantly into place — but it also means every piece of state below
// that used to reset for free on unmount now needs an explicit reset, keyed on `open` flipping
// true: the draft re-syncs from the latest profile (so a previous session's saved/discarded edits
// never leak into the next), and both subforms (change password, reset all data) snap back closed
// so reopening never shows a stale half-filled form from before.
export function AccountModal({open,data,updP,toast2,onClose,onSignOut,onReset,userEmail}){
  const p=data.profile;
  const {confirm,modal}=useConfirm();
  const freshDraft=()=>({
    name:p.name,lastName:p.lastName||"",phone:p.phone,email:p.email||"",
    homeAddress:p.homeAddress,username:p.username||"",password:p.password||"",
  });
  const [draft,setDraft]=useState(freshDraft);
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

  // Change password — verifies the CURRENT password (same signInWithPassword trick as the reset
  // flow below) before calling updateUser, so someone at an already-open session can't change the
  // password without knowing it.
  const [pwOpen,setPwOpen]=useState(false);
  const [curPw,setCurPw]=useState("");
  const [newPw,setNewPw]=useState("");
  const [newPw2,setNewPw2]=useState("");
  const [pwErr,setPwErr]=useState("");
  const [pwBusy,setPwBusy]=useState(false);
  function closePwForm(){setPwOpen(false);setCurPw("");setNewPw("");setNewPw2("");setPwErr("");}
  async function changePassword(){
    if(newPw.length<8){setPwErr("New password must be at least 8 characters");return;}
    if(newPw!==newPw2){setPwErr("The two new passwords don't match");return;}
    setPwBusy(true);setPwErr("");
    const{error:verifyErr}=await supabase.auth.signInWithPassword({email:userEmail,password:curPw});
    if(verifyErr){setPwBusy(false);setPwErr("Current password is incorrect");return;}
    const{error}=await supabase.auth.updateUser({password:newPw});
    setPwBusy(false);
    if(error){setPwErr(error.message);return;}
    closePwForm();
    toast2("Password updated");
  }

  // Invite a friend — fetched each time the drawer opens (create-on-first-view, via
  // lib/invites.js's getMyInviteInfo), not once on mount — this component stays mounted the whole
  // session now (see the note above the function), so "on mount" would mean "the moment
  // onboarding finishes," long before anyone's actually looked at Account. Keying on `open`
  // instead means the fetch only happens when it's actually needed, same as before. Sharing the
  // link is the whole feature; use_count/max_uses is just a light "did this actually reach
  // anyone" signal, not a hard cap the user manages here.
  const [inviteInfo,setInviteInfo]=useState(null);
  const [inviteLoading,setInviteLoading]=useState(true);
  useEffect(()=>{
    if(!open)return;
    setInviteLoading(true);
    getMyInviteInfo().then(info=>{setInviteInfo(info);setInviteLoading(false);});
  },[open]);
  const inviteLink=inviteInfo&&typeof window!=="undefined"?`${window.location.origin}/?invite=${inviteInfo.code}`:"";
  async function copyInviteLink(){
    try{ await navigator.clipboard.writeText(inviteLink); toast2("Invite link copied!"); }
    catch{ toast2("Couldn't copy — select and copy the link manually",true); }
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

  // Everything unmounting used to reset for free now needs doing by hand, keyed on `open` flipping
  // true: re-sync the draft from the latest profile (a previous session's saved/discarded edits
  // never leak into the next), and snap both subforms closed so reopening never shows a stale
  // half-filled password-change or reset-data form from before.
  useEffect(()=>{
    if(!open)return;
    setDraft(freshDraft());
    closePwForm();
    setResetOpen(false);setResetPw("");setResetErr("");setResetBusy(false);
  },[open]); // eslint-disable-line

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
    <>
    <SideDrawer open={open} onClose={handleClose} width={420}
      header={<DrawerHeader icon="ti-user-circle" title="Account" onClose={handleClose}/>}>
        <div className="g2" style={{marginTop:4,marginBottom:12}}>
          <div><label>First name</label><input value={draft.name} onChange={set("name")}/></div>
          <div><label>Last name</label><input value={draft.lastName} onChange={set("lastName")}/></div>
        </div>
        <div className="g2" style={{marginBottom:12}}>
          <div><label>Mobile phone</label><input value={draft.phone} onChange={set("phone")}/></div>
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
        {userEmail&&(
          <div style={{marginTop:16,paddingTop:14,borderTop:"1px solid var(--b1)"}}>
            {!pwOpen?(
              <button className="btn btn-ghost" style={{width:"100%"}} onClick={()=>{setPwOpen(true);setPwErr("");}}>
                <i className="ti ti-lock" style={{marginRight:6}}/>Change password
              </button>
            ):(
              <div>
                <div style={{fontSize:13,color:"var(--t1)",fontWeight:600,marginBottom:10}}>Change password</div>
                <div style={{marginBottom:8}}>
                  <label>Current password</label>
                  <PasswordInput value={curPw} autoFocus autoComplete="current-password"
                    onChange={e=>{setCurPw(e.target.value);setPwErr("");}}/>
                </div>
                <div style={{marginBottom:8}}>
                  <label>New password</label>
                  <PasswordInput value={newPw} autoComplete="new-password" placeholder="At least 8 characters"
                    onChange={e=>{setNewPw(e.target.value);setPwErr("");}}/>
                </div>
                <div style={{marginBottom:8}}>
                  <label>Confirm new password</label>
                  <PasswordInput value={newPw2} autoComplete="new-password"
                    onChange={e=>{setNewPw2(e.target.value);setPwErr("");}}
                    onKeyDown={e=>{if(e.key==="Enter")changePassword();}}/>
                </div>
                {pwErr&&<div style={{fontSize:12,color:"var(--red)",marginBottom:8}}>{pwErr}</div>}
                <div style={{display:"flex",gap:8}}>
                  <button className="btn btn-ghost btn-sm" style={{flex:1}} onClick={closePwForm}>Cancel</button>
                  <button className="btn btn-action btn-sm" style={{flex:1}} onClick={changePassword}
                    disabled={pwBusy||!curPw||!newPw||!newPw2}>
                    {pwBusy?"Updating...":"Update password"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {userEmail&&(
          <div style={{marginTop:16,paddingTop:14,borderTop:"1px solid var(--b1)"}}>
            <div style={{fontSize:13,color:"var(--t1)",fontWeight:600,marginBottom:8}}>
              <i className="ti ti-heart-handshake" style={{marginRight:6,color:"var(--amber)"}}/>Invite a friend
            </div>
            {inviteLoading?(
              <div style={{fontSize:12,color:"var(--t3)"}}>Loading your invite link...</div>
            ):inviteInfo?(
              <>
                <p style={{fontSize:12,color:"var(--t3)",marginBottom:8,lineHeight:1.5}}>
                  Signing up needs an invite — share this link so a friend's account is ready to go.
                </p>
                <div style={{display:"flex",gap:8,marginBottom:6}}>
                  <input readOnly value={inviteLink} onFocus={e=>e.target.select()} style={{fontSize:12}}/>
                  <button className="btn btn-ghost btn-sm" onClick={copyInviteLink} style={{flexShrink:0}}>
                    <i className="ti ti-copy"/> Copy
                  </button>
                </div>
                <div style={{fontSize:12,color:"var(--t3)"}}>{inviteInfo.use_count} of {inviteInfo.max_uses} used</div>
              </>
            ):(
              <div style={{fontSize:12,color:"var(--red)"}}>Couldn't load your invite link — try reopening this.</div>
            )}
          </div>
        )}
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
            {!resetOpen?(
              <button className="btn btn-del" style={{width:"100%"}} onClick={()=>{setResetOpen(true);setResetErr("");}}>
                <i className="ti ti-trash" style={{marginRight:6}}/>Reset all data
              </button>
            ):(
              <div>
                <p style={{fontSize:12,color:"var(--t3)",marginBottom:8,lineHeight:1.5}}>
                  This erases all your data, courses, and plan. Confirm your password to continue.
                </p>
                <div style={{marginBottom:8}}>
                  <label>Password</label>
                  <PasswordInput value={resetPw} autoFocus autoComplete="current-password"
                    onChange={e=>{setResetPw(e.target.value);setResetErr("");}}
                    onKeyDown={e=>{if(e.key==="Enter")verifyAndReset();}}/>
                </div>
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
      </SideDrawer>
      {modal}
    </>
  );
}
