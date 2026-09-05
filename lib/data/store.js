import { STORE } from "./schema";

// load()/save() are async by contract (not just by convention) even though today's only backend
// (localStorage) is itself synchronous — this is the seam a future real backend (Supabase, once
// multi-user/hosted access is built) swaps in behind, without every call site changing. The one
// and only call site today is components/App.jsx's initial load and its upd() save path.
export async function load(){
  try{
    const d=JSON.parse(localStorage.getItem(STORE)||"null");
    if(!d)return null;
    // Migrate: coerce all duration fields that may have been stored as strings
    if(d.profile){
      const num=["breakfastDur","lunchDur","dinnerDur","focusMins","breakMins","sessionPreset","commuteMins","funWD","funWE","gymStretch","gymDrive"];
      num.forEach(k=>{if(d.profile[k]!==undefined)d.profile[k]=parseInt(d.profile[k])||0;});
      // Also fix gymDays s/e times — ensure they stay as "HH:MM" strings not numbers
      if(d.profile.gymDays){
        d.profile.gymDays=d.profile.gymDays.map(g=>({...g,day:parseInt(g.day)||0}));
      }
    }
    // Migrate: normalize course records so every downstream consumer can safely assume `days` is
    // an array and `weeklyHours`/`difficulty` are valid numbers — courses created by older import
    // paths or edge cases could otherwise be missing these and crash the scheduling engine.
    if(Array.isArray(d.courses)){
      d.courses=d.courses.map(c=>({
        ...c,
        days:Array.isArray(c.days)?c.days:[],
        weeklyHours:Number.isFinite(+c.weeklyHours)&&+c.weeklyHours>0?+c.weeklyHours:4,
        difficulty:Number.isFinite(+c.difficulty)&&+c.difficulty>=1&&+c.difficulty<=10?+c.difficulty:5,
      }));
    }
    // Migrate: drop any assignment/exam with a missing or malformed date rather than letting it
    // silently poison downstream date math — surfaces as "no due date" which the app already handles.
    if(Array.isArray(d.assignments)){
      d.assignments=d.assignments.map(a=>({...a,dueDate:(a.dueDate&&/^\d{4}-\d{2}-\d{2}$/.test(a.dueDate))?a.dueDate:null}));
    }
    if(Array.isArray(d.exams)){
      d.exams=d.exams.filter(e=>e.date&&/^\d{4}-\d{2}-\d{2}$/.test(e.date));
    }
    return d;
  }catch{return null;}
}
export async function save(d){try{localStorage.setItem(STORE,JSON.stringify(d));}catch{}}
