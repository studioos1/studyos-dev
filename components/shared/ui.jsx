import { useState, useEffect, useRef } from "react";
import { DS } from "@/lib/constants";

export function Sp({sz=15}){return <div className="spin" style={{width:sz,height:sz}}/>;}

// Password input with a show/hide eye toggle. Used on the Login screen and in the Account modal's
// change-password flow. Module-scope-stable (a component declared inside a render body would get
// a fresh identity every render and remount its <input>, dropping focus on each keystroke) —
// exported here so every caller shares that same stable identity rather than each re-declaring it.
export function PasswordInput({value,onChange,autoComplete,placeholder}){
  const [show,setShow]=useState(false);
  return (
    <div style={{position:"relative"}}>
      <input type={show?"text":"password"} value={value} autoComplete={autoComplete}
        placeholder={placeholder} onChange={onChange}
        style={{width:"100%",paddingRight:40}}/>
      <button type="button" onClick={()=>setShow(s=>!s)}
        aria-label={show?"Hide password":"Show password"}
        className="tt" data-tt={show?"Hide password":"Show password"}
        style={{
          position:"absolute",right:4,top:"50%",transform:"translateY(-50%)",
          background:"none",border:"none",cursor:"pointer",padding:6,
          color:"var(--t3)",display:"flex",alignItems:"center",lineHeight:0,
        }}>
        <i className={`ti ${show?"ti-eye-off":"ti-eye"}`} style={{fontSize:16}}/>
      </button>
    </div>
  );
}

// Small pill badge for a Low/Mid/High difficulty rating.
export function TableHead({label,col,sortBy,setSortBy,align}){
  const isActive=sortBy===col;
  return(
    <th onClick={()=>setSortBy(col)} style={{
      fontSize:11,color:isActive?"var(--amber)":"var(--t3)",textTransform:"uppercase",letterSpacing:"0.04em",
      textAlign:align||"left",padding:"0 8px 8px",fontWeight:isActive?700:600,cursor:"pointer",userSelect:"none",whiteSpace:"nowrap",
    }}>
      {label}{isActive&&<i className="ti ti-chevron-down" style={{fontSize:11,marginLeft:3,color:"var(--amber)"}}/>}
    </th>
  );
}

// Small numeric grade-entry field, used identically in Exams and Assignments. Saves live on
// every keystroke (already correct behavior), but Enter gives an explicit "done" signal —
// blurs the field and briefly shows a checkmark — since silent auto-save with no feedback
// made it unclear whether pressing Enter had done anything.
export function GradeInput({value,onChange}){
  const [justConfirmed,setJustConfirmed]=useState(false);
  return(
    <div style={{position:"relative",display:"inline-block"}}>
      <input type="number" min="0" max="100" placeholder="Grade %" style={{fontSize:13,padding:"5px 24px 5px 7px",width:80}}
        value={value??""}
        onChange={e=>onChange(e.target.value===""?null:+e.target.value)}
        onKeyDown={e=>{
          if(e.key==="Enter"){
            e.target.blur();
            setJustConfirmed(true);
            setTimeout(()=>setJustConfirmed(false),1200);
          }
        }}/>
      {justConfirmed&&(
        <i className="ti ti-check" style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",color:"var(--green)",fontSize:14,pointerEvents:"none"}}/>
      )}
    </div>
  );
}

export function DiffPill({value,muted}){
  if(!value)return <span style={{fontSize:11,color:"var(--t3)"}}>—</span>;
  const colors={Low:{bg:"var(--green-bg)",fg:"var(--green)"},Mid:{bg:"var(--amber-bg)",fg:"var(--amber)"},High:{bg:"var(--red-bg)",fg:"var(--red)"},"Very High":{bg:"var(--red)",fg:"#fff"}};
  const c=colors[value]||colors.Mid;
  return <span style={{fontSize:12,fontWeight:600,padding:"3px 9px",borderRadius:6,background:muted?"var(--card2)":c.bg,color:muted?"var(--t3)":c.fg}}>{value}</span>;
}

// Editable hours field for the Study Preferences table. Manages its own local text state instead
// of deriving the displayed value directly from a parsed number on every keystroke — that pattern
// (used by the previous version of this field) meant clearing the input via backspace immediately
// snapped the display back to the AI-suggested fallback value the instant it hit empty, since the
// controlled value was `userHours ?? aiHours` and userHours became null right away. That looked
// exactly like "backspace doesn't work," because the field never actually stayed blank while
// typing. Here, typing freely updates local text only; the parent's stored value (and the
// dirty-tracking baseline) is only updated on blur or Enter, so mid-typing states like "0." or a
// briefly-empty field never fight the controlled input. Enter-confirmation checkmark is the same
// justConfirmed pattern as GradeInput above — copied directly rather than re-invented, for
// consistency between the two numeric-entry fields.
export function HoursInput({value,isOverridden,onCommit}){
  const [local,setLocal]=useState(value==null?"":String(value));
  const [justConfirmed,setJustConfirmed]=useState(false);
  useEffect(()=>{setLocal(value==null?"":String(value));},[value]);
  function commit(){
    const n=+local;
    const parsed=local===""||Number.isNaN(n)?null:n;
    if(parsed===value)return; // untouched (still showing the AI suggestion) — don't manufacture an override
    onCommit(parsed);
  }
  return(
    <div style={{position:"relative",display:"inline-block"}}>
      <input type="number" min="0.5" step="0.5" value={local}
        onChange={e=>setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={e=>{
          if(e.key==="Enter"){
            commit();
            e.target.blur();
            setJustConfirmed(true);
            setTimeout(()=>setJustConfirmed(false),1200);
          }
        }}
        style={{fontSize:12,padding:"4px 22px 4px 7px",width:64,
          borderColor:isOverridden?"var(--amber)":undefined,
          fontWeight:isOverridden?600:400,
          color:isOverridden?"var(--amber)":undefined}}/>
      {justConfirmed&&(
        <i className="ti ti-check" style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",color:"var(--green)",fontSize:14,pointerEvents:"none"}}/>
      )}
    </div>
  );
}

export function SecHead({icon,title,action}){
  return(
    <div className="sec-head">
      <div className="sec-title"><i className={`ti ${icon}`}/>{title}</div>
      {action}
    </div>
  );
}

export function AddBtn({onClick,label="Add",disabled}){
  return(
    <button className="btn btn-action btn-sm" onClick={onClick} disabled={disabled}>
      <i className="ti ti-plus"/>{label}
    </button>
  );
}

export function DelBtn({onClick,title="Delete"}){
  return(
    <button className="btn btn-del btn-sm tt" data-tt={title} onClick={onClick}>
      <i className="ti ti-trash" style={{fontSize:15}}/>
    </button>
  );
}

export function DiffBadge({score,label}){
  if(!score)return null;
  const cls=score<=3?"diff1":score<=6?"diff4":score<=8?"diff7":"diff9";
  return <span className={cls}>{label||"Lvl"} {score}/10</span>;
}

export function PdfDrop({label,hint,onFiles,files=[],multi=false}){
  const ref=useRef(null);
  const [drag,setDrag]=useState(false);
  const [rejected,setRejected]=useState(0);
  function isPdf(f){
    // Some PDFs (from Preview, scanners, some cloud exports) don't set MIME type reliably —
    // fall back to checking the file extension as well.
    return f.type==="application/pdf"||/\.pdf$/i.test(f.name||"");
  }
  function handle(fs){
    const pdfs=fs.filter(isPdf);
    setRejected(fs.length-pdfs.length);
    if(pdfs.length)onFiles(multi?pdfs:[pdfs[0]]);
  }
  return(
    <div>
      <div onDragOver={e=>{e.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)}
        onDrop={e=>{e.preventDefault();setDrag(false);handle(Array.from(e.dataTransfer.files));}}
        onClick={()=>ref.current?.click()}
        style={{background:drag?"var(--blue-bg)":"var(--card2)",borderRadius:10,padding:"18px",textAlign:"center",cursor:"pointer",transition:"background 0.15s",marginBottom:10}}>
        <i className="ti ti-file-type-pdf" style={{fontSize:24,color:"var(--amber)",display:"block",marginBottom:7}}/>
        <div style={{fontSize:14,color:"var(--t1)",marginBottom:3}}>{label}</div>
        <div style={{fontSize:12,color:"var(--t2)"}}>{hint}</div>
        <div style={{fontSize:11,color:"var(--t3)",marginTop:4}}>Drag &amp; drop or click to browse</div>
        <input ref={ref} type="file" accept=".pdf,application/pdf" {...(multi?{multiple:true}:{})} style={{display:"none"}} onChange={e=>{handle(Array.from(e.target.files));e.target.value="";}}/>
      </div>
      <div style={{display:"flex",alignItems:"flex-start",gap:7,padding:"7px 11px",background:"var(--amber-bg)",borderRadius:7,marginBottom:8,fontSize:12,color:"var(--amber)",lineHeight:1.5}}>
        <i className="ti ti-robot" style={{fontSize:14,flexShrink:0,marginTop:1}}/>
        <span>We read this with AI, which can misread a PDF. Check the extracted results on the next screen — if something's off, re-upload to run it again.</span>
      </div>
      {rejected>0&&(
        <div style={{display:"flex",alignItems:"center",gap:8,padding:"7px 11px",background:"var(--red-bg)",borderRadius:7,marginBottom:5}}>
          <i className="ti ti-alert-triangle" style={{color:"var(--red)",fontSize:14}}/>
          <span style={{fontSize:13,color:"var(--red)"}}>{rejected} file{rejected>1?"s":""} skipped — not a PDF</span>
        </div>
      )}
      {files.map((f,i)=>(
        <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 11px",background:"var(--green-bg)",borderRadius:7,marginBottom:5}}>
          <i className="ti ti-file-check" style={{color:"var(--green)",fontSize:14}}/>
          <span style={{flex:1,fontSize:13,color:"var(--t1)"}}>{f.name}</span>
          <span style={{fontSize:11,color:"var(--t3)"}}>{(f.size/1024).toFixed(0)}KB</span>
        </div>
      ))}
    </div>
  );
}

export function DayPick({val=[],onChange,col="var(--blue)"}){
  return(
    <div className="row">
      {DS.map((d,i)=>(
        <button key={i} className="btn btn-sm"
          style={{minWidth:38,background:val.includes(i)?col+"22":undefined,color:val.includes(i)?col:"var(--t3)"}}
          onClick={()=>onChange(val.includes(i)?val.filter(x=>x!==i):[...val,i])}>{d}</button>
      ))}
    </div>
  );
}

export function StatCard({label,value,sub,col,icon}){
  return(
    <div style={{background:"var(--card)",borderRadius:10,padding:"14px",textAlign:"center"}}>
      {icon&&<i className={`ti ${icon}`} style={{fontSize:18,color:col,display:"block",marginBottom:5}}/>}
      <div style={{fontSize:11,color:"var(--t3)",marginBottom:5,textTransform:"uppercase",letterSpacing:"0.08em"}}>{label}</div>
      <div style={{fontSize:24,color:col,lineHeight:1}}>{value}<span style={{fontSize:12,color:"var(--t3)"}}>{sub}</span></div>
    </div>
  );
}

// Renders the output of checkScheduleExtraction / checkSyllabusExtraction — a list of
// deterministic sanity-check findings on an AI-parsed PDF, shown before import. Nothing to show
// when the list is empty (the common, clean case). `onReupload`, when given, adds a button that
// clears the picked files so the student can drop the PDF again and re-run the extraction.
export function ExtractionIssues({issues=[],onReupload}){
  if(!issues.length)return null;
  const hasError=issues.some(i=>i.level==="error");
  const col=hasError?"var(--red)":"var(--amber)";
  const bg=hasError?"var(--red-bg)":"var(--amber-bg)";
  return(
    <div style={{background:bg,borderRadius:9,padding:"11px 13px",marginBottom:10}}>
      <div style={{display:"flex",alignItems:"center",gap:7,fontSize:13,fontWeight:600,color:col,marginBottom:6}}>
        <i className={`ti ${hasError?"ti-alert-triangle":"ti-alert-circle"}`} style={{fontSize:15}}/>
        {hasError?"This extraction looks wrong":"Check these before importing"}
      </div>
      <ul style={{margin:0,paddingLeft:18,fontSize:12,color:"var(--t2)",lineHeight:1.6}}>
        {issues.map((it,i)=><li key={i}>{it.msg}</li>)}
      </ul>
      {onReupload&&(
        <button className="btn btn-sm" onClick={onReupload}
          style={{marginTop:9,background:col,color:"#1a1206",border:"none"}}>
          <i className="ti ti-upload" style={{marginRight:5}}/>Re-upload &amp; run again
        </button>
      )}
    </div>
  );
}
