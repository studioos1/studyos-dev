import { useState, useEffect, useRef } from "react";

// ── ONBOARDING TOUR ───────────────────────────────────────────────────────────
// First-time guided walkthrough of the LIVE app (not the signup wizard). Two acts: quick daily
// payoff (Today tab), then how the plan actually gets built (syllabus upload -> Save & Replan).
// Each spot step's `id` must match a `data-tour="id"` attribute on the real element it spotlights.
const STEPS=[
  {id:"welcome",type:"welcome"},
  {id:"progress",type:"spot",tab:"today",
    title:"Study Pace",body:"Your two headline numbers — how consistently you're studying, and how often work lands on time."},
  {id:"focustime",type:"spot",tab:"today",
    title:"Focus Time",body:"Today's real schedule. Press play to start a session — StudyOS tracks it automatically."},
  {id:"syllabus",type:"spot",tab:"acad",
    title:"Upload a syllabus",body:"Click here to drop one in — StudyOS reads every assignment, exam, and due date automatically, no manual entry."},
  {id:"replan",type:"spot",tab:"settings",
    title:"Save & Replan",body:"This turns everything you've told StudyOS into your actual daily schedule."},
  {id:"done",type:"done"},
];
const SPOT_COUNT=STEPS.filter(s=>s.type==="spot").length;

// `tab`/`setTab` let the tour switch tabs itself when a step's target lives elsewhere, so the
// student never has to know where to click next. `onSkip`/`onFinish` are both "close the overlay"
// — kept separate so the caller can tell whether tourCompletedAt should be set (finish only, never
// skip; see the field's own comment in lib/data/schema.js).
export function TourOverlay({active,tab,setTab,onSkip,onFinish}){
  const [i,setI]=useState(0);
  const [rect,setRect]=useState(null); // padded target rect in viewport coords, null while locating it
  const pollRef=useRef(null);

  useEffect(()=>{ if(active){setI(0);setRect(null);} },[active]);

  const step=STEPS[i];

  // The app header is position:fixed (~92px tall desktop, ~50px mobile) — real screen space that
  // scrollIntoView has no awareness of, since a fixed element isn't part of document flow. A
  // target near the top of a tab's own content (e.g. the sub-nav tab bar right below Academics'
  // page title) can end up scrolled to right under it — real reported bug (measured rect.top of
  // -33, genuinely hidden). HEADER_CLEARANCE is a safe upper bound covering both breakpoints.
  const HEADER_CLEARANCE=100;

  // Locate the current step's target: switch tabs if needed, then poll for the element to exist
  // (mount time varies with tab-switch/data-load — a fixed timeout would be a guess either way),
  // scroll it into view, nudge clear of the fixed header if scrollIntoView left it underneath,
  // and measure it.
  useEffect(()=>{
    if(!active||step.type!=="spot")return;
    let cancelled=false;
    setRect(null);
    if(tab!==step.tab)setTab(step.tab);
    clearInterval(pollRef.current);
    pollRef.current=setInterval(()=>{
      const el=document.querySelector(`[data-tour="${step.id}"]`);
      if(el){
        clearInterval(pollRef.current);
        el.scrollIntoView({behavior:"smooth",block:"center"});
        setTimeout(()=>{
          if(cancelled)return;
          const r=el.getBoundingClientRect();
          if(r.top<HEADER_CLEARANCE)window.scrollBy({top:r.top-HEADER_CLEARANCE,behavior:"instant"});
          measure(el);
        },220); // let the smooth scroll settle before measuring
      }
    },80);
    return ()=>{cancelled=true;clearInterval(pollRef.current);};
  },[active,i]); // eslint-disable-line

  function measure(el){
    const r=el.getBoundingClientRect(),pad=8;
    setRect({top:r.top-pad,left:r.left-pad,width:r.width+pad*2,height:r.height+pad*2});
  }

  // Keep the spotlight locked to the real element if the page scrolls/resizes under it.
  useEffect(()=>{
    if(!active||step.type!=="spot")return;
    let raf=null;
    function onScrollResize(){
      cancelAnimationFrame(raf);
      raf=requestAnimationFrame(()=>{
        const el=document.querySelector(`[data-tour="${step.id}"]`);
        if(el)measure(el);
      });
    }
    window.addEventListener("scroll",onScrollResize,true);
    window.addEventListener("resize",onScrollResize);
    return ()=>{window.removeEventListener("scroll",onScrollResize,true);window.removeEventListener("resize",onScrollResize);cancelAnimationFrame(raf);};
  },[active,i]); // eslint-disable-line

  if(!active)return null;

  function next(){setI(x=>Math.min(x+1,STEPS.length-1));}
  function back(){setI(x=>Math.max(x-1,0));}

  if(step.type==="welcome"||step.type==="done"){
    // Full-dim centered card, no cutout — same modal pattern already used for Add/Edit term.
    return(
      <div style={{position:"fixed",inset:0,zIndex:9500,background:"rgba(8,10,16,0.72)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
        <div style={{width:300,maxWidth:"100%",background:"var(--card)",borderRadius:14,padding:"26px 24px",
          textAlign:"center",boxShadow:"0 24px 60px rgba(0,0,0,0.55)",border:"1px solid var(--b2)"}}>
          <div style={{fontSize:30,marginBottom:10}}>{step.type==="welcome"?"👋":"🎉"}</div>
          <div style={{fontSize:17,fontWeight:700,marginBottom:8,color:"var(--t1)"}}>
            {step.type==="welcome"?"Welcome to StudyOS":"You're all set"}
          </div>
          <div style={{fontSize:13,color:"var(--t2)",lineHeight:1.6,marginBottom:18}}>
            {step.type==="welcome"
              ?"Here's a 60-second look around — how the plan gets built, and what you'll see every day."
              :<>Replay this anytime from the <b style={{color:"var(--amber)"}}>?</b> icon in the top bar.</>}
          </div>
          <button className="btn btn-action" style={{width:"100%",padding:10,fontSize:13,marginBottom:step.type==="welcome"?8:0}}
            onClick={step.type==="welcome"?next:onFinish}>
            {step.type==="welcome"?"Start tour":"Got it!"}
          </button>
          {step.type==="welcome"&&(
            <button onClick={onSkip} style={{background:"none",border:"none",color:"var(--t3)",fontSize:12.5,cursor:"pointer",textDecoration:"underline",display:"block",margin:"0 auto"}}>
              Skip
            </button>
          )}
        </div>
      </div>
    );
  }

  if(!rect){
    // Still locating the target (tab switch / poll in flight) — dim only, so there's no flash of
    // a spotlight in the wrong place before the real element is found.
    return <div style={{position:"fixed",inset:0,zIndex:9500,background:"rgba(8,10,16,0.5)"}}/>;
  }

  // Four-rectangle dim, not a CSS clip-path mask — a precise rounded-corner cutout without mask
  // browser quirks. Validated in the interactive mockup this was built from.
  const vw=window.innerWidth,vh=window.innerHeight;
  const dimRects=[
    {top:0,left:0,width:vw,height:rect.top},
    {top:rect.top+rect.height,left:0,width:vw,height:vh-(rect.top+rect.height)},
    {top:rect.top,left:0,width:rect.left,height:rect.height},
    {top:rect.top,left:rect.left+rect.width,width:vw-(rect.left+rect.width),height:rect.height},
  ];

  const calloutW=Math.min(300,vw-32);
  let calloutTop=rect.top+rect.height+14,pointTop=true;
  if(calloutTop+190>vh){calloutTop=rect.top-14;pointTop=false;}
  let calloutLeft=Math.min(Math.max(rect.left,16),vw-calloutW-16);

  const spotIndex=STEPS.slice(0,i+1).filter(s=>s.type==="spot").length; // 1-based among spot steps

  return(
    <div style={{position:"fixed",inset:0,zIndex:9500}}>
      {dimRects.map((r,idx)=>(
        <div key={idx} style={{position:"absolute",top:r.top,left:r.left,width:r.width,height:r.height,
          background:"rgba(8,10,16,0.74)",transition:"all .3s ease"}}/>
      ))}
      <div style={{position:"absolute",top:rect.top,left:rect.left,width:rect.width,height:rect.height,
        borderRadius:12,boxShadow:"0 0 0 3px var(--amber), 0 0 28px 6px rgba(207,154,72,0.4)",
        transition:"all .3s ease",pointerEvents:"none"}}/>
      {/* The spotlighted element itself stays inert during the tour — a click here shouldn't
          start a real Focus Time session or trigger a real Replan while the tour is just
          pointing at it. */}
      <div style={{position:"absolute",top:rect.top,left:rect.left,width:rect.width,height:rect.height}}/>
      <div style={{position:"absolute",top:calloutTop,left:calloutLeft,width:calloutW,
        transform:pointTop?undefined:"translateY(-100%)",
        background:"var(--card)",borderRadius:12,padding:"15px 17px",boxShadow:"0 24px 60px rgba(0,0,0,0.55)",
        border:"1px solid var(--b2)",transition:"top .3s ease, left .3s ease"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
          <span style={{fontSize:10.5,color:"var(--t3)",textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:600}}>
            {spotIndex} / {SPOT_COUNT}
          </span>
          <button onClick={onSkip} aria-label="Skip tour" style={{background:"none",border:"none",color:"var(--t3)",fontSize:15,cursor:"pointer",padding:2,lineHeight:1}}>
            <i className="ti ti-x"/>
          </button>
        </div>
        <div style={{fontSize:15,fontWeight:700,color:"var(--t1)",marginBottom:5}}>{step.title}</div>
        <div style={{fontSize:13,color:"var(--t2)",lineHeight:1.55,marginBottom:12}}>{step.body}</div>
        <div style={{display:"flex",gap:5,marginBottom:13}}>
          {Array.from({length:SPOT_COUNT}).map((_,d)=>(
            <span key={d} style={{height:6,borderRadius:3,background:d===spotIndex-1?"var(--amber)":"var(--b2)",width:d===spotIndex-1?16:6,transition:"all .2s ease"}}/>
          ))}
        </div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <button onClick={onSkip} style={{background:"none",border:"none",color:"var(--t3)",fontSize:12.5,cursor:"pointer",textDecoration:"underline",padding:0,fontFamily:"inherit"}}>
            Skip tour
          </button>
          <div style={{display:"flex",gap:8}}>
            {i>1&&<button className="btn btn-ghost btn-sm" onClick={back}>Back</button>}
            <button className="btn btn-action btn-sm" onClick={next}>{i===STEPS.length-2?"Done":"Next"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
