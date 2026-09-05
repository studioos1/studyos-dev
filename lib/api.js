// Course difficulty lookup proxy — a simple standalone fetch used directly by both Onboard and
// Academics' syllabus sync.
export async function CI(name,code){
  try{const r=await fetch("/api/course-info",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({courseName:name,courseCode:code})});return await r.json();}
  catch{return{difficultyScore:5,difficultyLabel:"Medium",weeklyStudyHours:5,startExamPrepDays:5};}
}

// Generic AI(sys,prompt) proxy. Used directly by Progress (its evening check-in feedback), and by
// App's own ai()/busy wrapper (components/App.jsx) which every other tab calls through instead of
// hitting this directly — that wrapper is what actually toggles the shared `busy` spinner state.
export async function AI(sys,prompt,max=1500,opts={}){
  // Note: `opts.temperature` is intentionally not forwarded — the current Claude models have
  // deprecated it and the API 400s on requests that include it. Callers may still pass it
  // harmlessly; it's just ignored here.
  const body={system:sys,prompt,maxTokens:max};
  if(opts.model)body.model=opts.model;
  const r=await fetch("/api/ai",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const j=await r.json();if(!r.ok)throw new Error(j.error||"API error");return j.text;
}
