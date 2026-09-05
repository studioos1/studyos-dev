// Course difficulty lookup proxy. The generic AI(sys,prompt) proxy stays in components/App.jsx —
// it's tightly coupled to the ai()/busy wrapper defined there; this one's a simple standalone
// fetch used directly by both Onboard and Academics' syllabus sync.
export async function CI(name,code){
  try{const r=await fetch("/api/course-info",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({courseName:name,courseCode:code})});return await r.json();}
  catch{return{difficultyScore:5,difficultyLabel:"Medium",weeklyStudyHours:5,startExamPrepDays:5};}
}
