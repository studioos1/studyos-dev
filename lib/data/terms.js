import { iso } from "@/lib/time";
import { uid } from "./schema";
import { prettyCourseCode } from "@/lib/courses";

// One-time normalization: fresh syllabus extraction stores the full AI title as course.name
// ("Introduction to Probability (MATH 180A)"), which overflows tables and differs account to
// account. Collapse every course.name to its canonical code ("MATH 180A"); keep the full title
// in description if that's empty. No-op once names are already codes. Returns null when nothing changed.
export function normalizeCourseNamesIfNeeded(data){
  let changed=false;
  const courses=(data.courses||[]).map(c=>{
    const short=prettyCourseCode(c.name);
    if(!short||short===c.name)return c;
    changed=true;
    return {...c,name:short,description:c.description||c.name};
  });
  return changed?{courses}:null;
}

// One-time repair. Earlier builds generated assignment/exam ids as Date.now()+i+random(0..999),
// which collides when many are created together (syllabus sync). Colliding ids make every
// edit / mark-done / prioritise action hit ALL records that share the id (e.g. one checkbox
// ticking three rows). Reassign any duplicate — or non-finite — id to a fresh unique one,
// keeping the FIRST occurrence stable so existing references mostly survive. Per-array, since
// ids only need to be unique within their own list. Returns null (no-op) when everything's fine.
export function dedupeItemIdsIfNeeded(data){
  let changed=false;
  const fixList=list=>{
    const seen=new Set();
    return (list||[]).map(x=>{
      let id=x.id;
      if(id==null||!Number.isFinite(+id)||seen.has(id)){id=uid();changed=true;x={...x,id};}
      seen.add(id);
      return x;
    });
  };
  const assignments=fixList(data.assignments);
  const exams=fixList(data.exams);
  return changed?{assignments,exams}:null;
}

// ── MULTI-SCHOOL / MULTI-TERM ────────────────────────────────────────────────
// Derives each term's status from real dates — status is never stored, always computed, so it
// can't drift out of sync with the data it's derived from. Rule: a term is "completed" once its
// end date has passed; among the rest, the one with the earliest start date is "current" (even
// if its own start date hasn't technically arrived yet — once the previous term ends, the next
// one in line is what's relevant), and everything else is "upcoming". A newly-added future term
// stays "upcoming" no matter how far ahead it's dated, until the currently-current term's end
// date actually passes.
export function computeTermStatuses(terms,todayStr){
  const sorted=[...(terms||[])].sort((a,b)=>(a.start||"").localeCompare(b.start||""));
  const notCompleted=sorted.filter(t=>t.end&&t.end>=todayStr);
  const currentId=notCompleted.length?notCompleted[0].id:null;
  return sorted.map(t=>({
    ...t,
    status:(t.end&&t.end<todayStr)?"completed":(t.id===currentId?"current":"upcoming"),
  }));
}
// The term currently driving the planner, plus the school it belongs to. Null if no terms exist
// yet (e.g. before the one-time legacy migration below has run, or a brand-new install).
export function getActiveTermAndSchool(data){
  const statuses=computeTermStatuses(data.terms,iso());
  const active=statuses.find(t=>t.status==="current");
  if(!active)return{term:null,school:null};
  const school=(data.schools||[]).find(s=>s.id===active.schoolId)||null;
  return{term:active,school};
}
// Scopes courses/assignments/exams to just the current term before handing off to the planner.
// Without this, the planner (both the deadline-driven scheduler and the regular-study fallback,
// which iterates data.courses directly) would consider EVERY course/assignment/exam ever
// created — including years-old completed terms kept for history, and any upcoming term
// prepped in advance — mixing all of it into today's real schedule. freeSlots() also reads
// data.courses for class-time blocking, so scoping it here via the same data object fixes both
// at once. If no term exists yet (e.g. before the legacy migration has run), falls back to
// unscoped data rather than breaking a fresh/pre-migration install.
export function termScopedForPlanning(data){
  const{term}=getActiveTermAndSchool(data);
  if(!term)return data;
  const currentCourses=data.courses.filter(c=>c.termId===term.id);
  const currentCourseIds=new Set(currentCourses.map(c=>c.id));
  return{
    ...data,
    courses:currentCourses,
    assignments:data.assignments.filter(a=>currentCourseIds.has(a.courseId)),
    exams:data.exams.filter(e=>currentCourseIds.has(e.courseId)),
  };
}
// One-time migration: existing installs (like the current single-school/single-term setup)
// have their school+term info living directly on profile, not in schools[]/terms[]. If terms[]
// is still empty but profile already has a school on record, synthesize a school+term entry
// from those legacy fields so nothing is lost. Idempotent — once terms[] is non-empty, this
// never fires again, so it's safe to check on every load rather than needing a version flag.
export function migrateLegacyTermIfNeeded(data){
  if((data.terms||[]).length>0)return null; // already migrated (or a fresh install with no school yet)
  if(!data.profile.schoolName)return null; // nothing to migrate
  const schoolId="sch_"+Date.now();
  const termId="term_"+Date.now();
  const school={id:schoolId,name:data.profile.schoolName,address:data.profile.schoolAddress||"",schoolType:data.profile.schoolType||"quarter"};
  const term={
    id:termId,schoolId,name:data.profile.collegeCalendar?.quarters?.[0]?.name||"Current term",
    type:data.profile.schoolType||"quarter",
    start:data.profile.termStart||"",end:data.profile.termEnd||"",
    holidays:data.profile.collegeCalendar?.holidays||[],
    source:data.profile.collegeCalendar?.source||null,fetchedAt:data.profile.collegeCalendar?.fetchedAt||null,
  };
  const patch={schools:[school],terms:[term]};
  // Backfill: any course that predates this feature has no termId at all — without this, it
  // would silently disappear from every term-filtered view the moment filtering goes live,
  // since undefined never matches the freshly-generated term id above.
  const untagged=(data.courses||[]).filter(c=>!c.termId);
  if(untagged.length>0){
    patch.courses=(data.courses||[]).map(c=>c.termId?c:{...c,termId});
  }
  return patch;
}
// Keeps profile's existing termStart/termEnd/schoolName/schoolAddress/schoolType/collegeCalendar
// mirrored to whichever term is currently active, so every existing consumer of those fields
// (the planner, getTermRange, isFin/isHol, WeekGrid...) keeps working completely unchanged —
// they just always reflect "the active term" now instead of being the single source of truth
// themselves. Returns a patch to apply via updP, or null if nothing needs to change.
export function syncActiveTermToProfilePatch(data){
  const{term,school}=getActiveTermAndSchool(data);
  if(!term)return null;
  const p=data.profile;
  const patch={};
  if(p.termStart!==term.start)patch.termStart=term.start;
  if(p.termEnd!==term.end)patch.termEnd=term.end;
  if(school){
    if(p.schoolName!==school.name)patch.schoolName=school.name;
    if(p.schoolAddress!==school.address)patch.schoolAddress=school.address;
    if(p.schoolType!==term.type)patch.schoolType=term.type;
  }
  if(term.start&&term.end){
    const wantCal=JSON.stringify({quarters:[{name:term.name,start:term.start,end:term.end}],holidays:term.holidays||[],source:term.source||null});
    const haveCal=JSON.stringify({quarters:p.collegeCalendar?.quarters||[],holidays:p.collegeCalendar?.holidays||[],source:p.collegeCalendar?.source||null});
    if(wantCal!==haveCal)patch.collegeCalendar={quarters:[{name:term.name,start:term.start,end:term.end}],holidays:term.holidays||[],source:term.source||null,fetchedAt:new Date().toISOString()};
  }
  return Object.keys(patch).length?patch:null;
}
