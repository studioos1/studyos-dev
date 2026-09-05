import { useState, useRef } from "react";
import { generateAcronym, searchColleges } from "@/lib/colleges";

// Free-typing text input with a live-filtering dropdown of US colleges — replaces the plain
// "School name" text field. Selecting a suggestion sets the canonical name; typing without
// selecting still works exactly like the old plain field (some schools genuinely aren't in the
// dataset, or the student may just not want to pick from the list). The ~140KB dataset is fetched
// lazily on first focus, not on every app load, since most sessions never touch this screen again
// after initial setup.
export function CollegeAutocomplete({value,onChange,onSelect,placeholder}){
  const[indexed,setIndexed]=useState(null); // null = not yet loaded
  const[loading,setLoading]=useState(false);
  const[open,setOpen]=useState(false);
  const[results,setResults]=useState([]);
  const blurTimer=useRef(null);

  async function ensureLoaded(){
    if(indexed||loading)return;
    setLoading(true);
    try{
      const res=await fetch("/data/us_colleges.json");
      const list=await res.json();
      setIndexed(list.map(c=>({...c,acronym:generateAcronym(c.name)})));
    }catch(err){
      console.error("StudyOS: college list fetch failed —",err);
      setIndexed([]); // fail quietly — field still works as plain free-text input
    }finally{
      setLoading(false);
    }
  }

  function handleChange(v){
    onChange(v);
    if(indexed)setResults(searchColleges(indexed,v));
    setOpen(true);
  }

  return(
    <div style={{position:"relative"}}>
      <input value={value} placeholder={placeholder}
        onFocus={ensureLoaded}
        onChange={e=>handleChange(e.target.value)}
        onBlur={()=>{blurTimer.current=setTimeout(()=>setOpen(false),150);}} // delay so a click on a suggestion registers before the list unmounts
      />
      {open&&value&&results.length>0&&(
        <div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:20,marginTop:4,
          background:"var(--card3)",border:"1px solid var(--b1)",borderRadius:8,
          maxHeight:220,overflowY:"auto",boxShadow:"0 4px 12px rgba(0,0,0,0.3)"}}>
          {results.map(c=>(
            <div key={c.name} tabIndex={-1}
              onMouseDown={e=>{
                e.preventDefault(); // fires before the input's blur, so this beats the blur-close timer
                clearTimeout(blurTimer.current);
                onChange(c.name);
                onSelect?.(c.name);
                setOpen(false);
              }}
              style={{padding:"8px 12px",fontSize:13,cursor:"pointer",color:"var(--t1)"}}
              onMouseEnter={e=>e.currentTarget.style.background="var(--card2)"}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              {c.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
