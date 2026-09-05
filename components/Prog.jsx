import { useState } from "react";
import { iso, du } from "@/lib/time";
import { courseNameFor } from "@/lib/courses";
import { calcGPA } from "@/lib/grades";
import { AI } from "@/lib/api";
import { GYM0 } from "@/lib/data";
import { StatCard, SecHead, Sp } from "@/components/shared";

// ── PROGRESS ─────────────────────────────────────────────────────────────────
export function Prog({data,upd,toast2,ai,busy}){
  const logs=data.dailyLogs||[],gymLogs=data.gymLogs||[],p=data.profile;
  const td=iso(),gymD=(p.gymDays||GYM0).filter(g=>g.on),gymTarget=gymD.length;
  const streak=(()=>{let s=0;for(let i=0;i<30;i++){const d=iso(new Date(Date.now()-i*864e5));const l=logs.find(x=>x.date===d);if(l&&l.completed?.length>0)s++;else if(i>0)break;}return s;})();
  const cr=logs.length?Math.round(logs.filter(l=>l.completed?.length>0).length/logs.length*100):0;
  const g30=gymLogs.filter(g=>{const d=new Date(g.date);const a=new Date();a.setDate(a.getDate()-30);return d>=a;}).length;
  const hs=Math.min(100,Math.round(streak*4+cr*0.4+Math.min(20,g30*2)+(data.onboarded?10:0)));
  const ms=[
    {l:"7+ day study streak",ok:streak>=7},
    {l:"Consistent check-ins (14+ days)",ok:logs.length>=14},
    {l:"Gym habit (12+ sessions/month)",ok:g30>=12},
    {l:"Completion rate above 70%",ok:cr>=70},
    {l:"10+ day streak",ok:streak>=10},
    {l:"No missed exam prep",ok:data.exams.every(e=>du(e.date)<0||du(e.date)>e.prepDays)},
  ];
  const tl=logs.find(l=>l.date===td)||{date:td,completed:[],skipped:[],notes:""};
  const [comp,setComp]=useState(tl.completed||[]);
  const [notes,setNotes]=useState(tl.notes||"");
  const [fb,setFb]=useState(null);
  const [sub,setSub]=useState(false);
  const tasks=[
    ...data.assignments.filter(a=>a.status!=="done"&&a.dueDate&&du(a.dueDate)<=2).map(a=>({id:`a-${a.id}`,l:`${a.title} (${courseNameFor(data.courses,a.courseId)})`,t:"assignment",days:du(a.dueDate)})),
    ...data.exams.filter(e=>{const d=du(e.date);return d>=0&&d<=e.prepDays;}).map(e=>({id:`e-${e.id}`,l:`Study for ${courseNameFor(data.courses,e.courseId)} exam`,t:"exam",days:du(e.date)})),
  ].sort((a,b)=>a.days-b.days);

  async function submit(){
    setSub(true);
    const nl={date:td,completed:comp,skipped:tasks.map(t=>t.id).filter(id=>!comp.includes(id)),notes,savedAt:new Date().toISOString()};
    upd({dailyLogs:[...logs.filter(l=>l.date!==td),nl]});
    try{
      const t=await AI(`Warm encouraging assistant. ${p.name} has ADD. Lead with achievements. 3-4 sentences. Plain text.`,
        `Check-in: ${comp.length}/${tasks.length} done.
Done: ${comp.map(id=>tasks.find(t=>t.id===id)?.l||id).join(", ")||"None"}
Notes: ${notes||"None"}
Celebrate, no guilt, one encouragement for tomorrow.`);
      setFb(t);
    }catch{}
    toast2("Check-in saved! 🎯");setSub(false);
  }

  const dp=tasks.length?Math.round(comp.length/tasks.length*100):100;
  const gpa=calcGPA(data.courses);
  const pomoLogs=data.pomodoroLogs||[];
  const focus30=pomoLogs.filter(l=>{const d=new Date(l.date);const a=new Date();a.setDate(a.getDate()-30);return d>=a;}).reduce((s,l)=>s+l.mins,0);

  return(
    <div className="fade">
      <h2 style={{marginBottom:16}}>Progress</h2>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(105px,1fr))",gap:10,marginBottom:14}}>
        <StatCard label="Habit score" value={hs} sub="/100" col="var(--blue)" icon="ti-star"/>
        <StatCard label="Streak" value={streak} sub=" days" col="var(--a-study-t)" icon="ti-flame"/>
        <StatCard label="Completion" value={cr} sub="%" col="var(--amber)" icon="ti-chart-bar"/>
        <StatCard label="Gym/30d" value={g30} sub={`/${gymTarget*4}`} col="var(--a-gym-t)" icon="ti-barbell"/>
        <StatCard label="GPA" value={gpa!==null?gpa.toFixed(2):"—"} sub="" col="var(--amber)" icon="ti-award"/>
        <StatCard label="Focus/30d" value={focus30} sub=" min" col="var(--a-study-t)" icon="ti-clock-play"/>
        <StatCard label="UCSD ready" value={ms.filter(m=>m.ok).length} sub={`/${ms.length}`} col="var(--lime)" icon="ti-school"/>
      </div>

      <div className="card" style={{marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <SecHead icon="ti-star" title="Habit Score"/>
          <span style={{fontSize:18,color:"var(--blue)"}}>{hs}/100</span>
        </div>
        <div className="bar" style={{marginBottom:7}}><div className="bar-fill" style={{width:`${hs}%`,background:hs>=75?"var(--a-study-t)":hs>=50?"var(--amber)":"var(--blue)"}}/></div>
        <div style={{fontSize:13,color:"var(--t2)"}}>{hs>=75?"UCSD-ready habits forming":hs>=50?"Good progress — keep going":"Every check-in builds the habit"}</div>
      </div>

      <div className="card" style={{marginBottom:12}}>
        <SecHead icon="ti-checkbox" title="Evening Check-in"/>
        <p style={{fontSize:13,marginBottom:12}}>No judgment — tracking so tomorrow's plan is smarter.</p>
        {tasks.length===0
          ?<div style={{fontSize:14,color:"var(--a-study-t)",textAlign:"center",padding:"10px"}}>Nothing urgent today</div>
          :<div>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
              <span style={{fontSize:13,color:"var(--t2)"}}>What got done?</span>
              <span style={{fontSize:13,color:dp>=80?"var(--a-study-t)":dp>=50?"var(--amber)":"var(--red)"}}>{dp}%</span>
            </div>
            <div className="bar" style={{marginBottom:12}}><div className="bar-fill" style={{width:`${dp}%`,background:dp>=80?"var(--a-study-t)":dp>=50?"var(--amber)":"var(--red)"}}/></div>
            {tasks.map((t,i)=>(
              <div key={t.id} className="list-item" style={{cursor:"pointer",opacity:comp.includes(t.id)?0.5:1}} onClick={()=>setComp(prev=>prev.includes(t.id)?prev.filter(x=>x!==t.id):[...prev,t.id])}>
                <div className={`chk${comp.includes(t.id)?" on":""}`}>{comp.includes(t.id)&&<i className="ti ti-check" style={{fontSize:10,color:"var(--green)"}}/>}</div>
                <span style={{fontSize:14,flex:1,textDecoration:comp.includes(t.id)?"line-through":"none",color:"var(--t1)"}}>{t.l}</span>
                <span className={`badge ${t.t==="exam"?"badge-amber":"badge-blue"}`} style={{fontSize:11}}>{t.t}</span>
              </div>
            ))}
          </div>
        }
        <textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Anything to add?" style={{width:"100%",minHeight:55,fontFamily:"inherit",fontSize:13,resize:"vertical",marginTop:12,marginBottom:10}}/>
        <button className="btn btn-action" style={{width:"100%"}} onClick={submit} disabled={sub}>
          {sub?<><Sp sz={13}/> Saving...</>:<><i className="ti ti-send"/> Submit Check-in</>}
        </button>
        {fb&&<div style={{marginTop:11,padding:"12px 15px",background:"var(--green-bg)",borderRadius:9,fontSize:13,lineHeight:1.7,color:"var(--t2)"}}><div style={{fontSize:10,color:"var(--a-study-t)",textTransform:"uppercase",letterSpacing:"0.09em",marginBottom:5}}>AI feedback</div>{fb}</div>}
      </div>

      <div className="card" style={{marginBottom:12}}>
        <SecHead icon="ti-school" title="UCSD Readiness"/>
        {ms.map((m,i)=>(
          <div key={i} className="list-item">
            <div style={{width:17,height:17,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,background:m.ok?"var(--green-bg)":"var(--card2)"}}>
              {m.ok&&<i className="ti ti-check" style={{fontSize:10,color:"var(--green)"}}/>}
            </div>
            <span style={{fontSize:13,color:m.ok?"var(--t1)":"var(--t3)",flex:1}}>{m.l}</span>
            {m.ok&&<span style={{fontSize:11,color:"var(--green)"}}>✓</span>}
          </div>
        ))}
      </div>

      <div className="card">
        <SecHead icon="ti-calendar" title="Last 14 days"/>
        <div className="row" style={{flexWrap:"wrap",marginBottom:7}}>
          {Array.from({length:14},(_,i)=>{
            const d=iso(new Date(Date.now()-(13-i)*864e5));
            const l=logs.find(x=>x.date===d);const dn=l?.completed?.length||0;
            const gym=gymLogs.some(g=>g.date===d);const isT=d===iso();
            return(
              <div key={i} title={d} style={{width:30,height:30,borderRadius:7,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
                background:dn>0?"var(--a-study)":l?"var(--amber-bg)":"var(--card2)",
                outline:isT?"2px solid var(--blue)":"none"}}>
                <span style={{fontSize:11,color:dn>0?"var(--a-study-t)":l?"var(--amber)":"var(--t3)"}}>{dn>0?dn:"·"}</span>
                {gym&&<span style={{fontSize:7,color:"var(--a-gym-t)"}}>💪</span>}
              </div>
            );
          })}
        </div>
        <div style={{fontSize:11,color:"var(--t3)"}}>Number = tasks completed · 💪 = gym</div>
      </div>
    </div>
  );
}
