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

// Ongoing repair for broken term/course linkage (root cause of "new account's plan is empty or
// wrong"). Two failure modes, both from onboarding creating things out of order:
//   1. A term with no start/end — computeTermStatuses can't mark it "current", so term-dependent
//      features (Finals Week, holidays, horizon anchoring) misbehave.
//   2. Courses with termId null / pointing at a deleted term — termScopedForPlanning filters the
//      planner's courses to the current term, so an unlinked course is invisible to it and the
//      plan comes out empty.
// Fills a dateless term from profile.termStart/termEnd, then links every orphan course to the
// current term. Idempotent — returns null once everything lines up. Runs on load like the others.
export function repairTermLinkageIfNeeded(data){
  const terms=data.terms||[];
  if(!terms.length)return null;

  const anyDateless=terms.some(t=>!t.start||!t.end);
  const fixedTerms=(anyDateless&&(data.profile?.termStart||data.profile?.termEnd))
    ? terms.map(t=>(!t.start||!t.end)
        ? {...t,start:t.start||data.profile.termStart||"",end:t.end||data.profile.termEnd||""}
        : t)
    : terms;

  const {term}=getActiveTermAndSchool({...data,terms:fixedTerms});
  if(!term)return fixedTerms!==terms?{terms:fixedTerms}:null;

  const termIds=new Set(fixedTerms.map(t=>t.id));
  const hasOrphan=(data.courses||[]).some(c=>!c.termId||!termIds.has(c.termId));
  const fixedCourses=hasOrphan
    ? (data.courses||[]).map(c=>(!c.termId||!termIds.has(c.termId))?{...c,termId:term.id}:c)
    : data.courses;

  const patch={};
  if(fixedTerms!==terms)patch.terms=fixedTerms;
  if(fixedCourses!==data.courses)patch.courses=fixedCourses;
  return Object.keys(patch).length?patch:null;
}

// ── MULTI-SCHOOL / MULTI-TERM ────────────────────────────────────────────────
// Term status is a STORED, user-controlled field now — one of "current" | "upcoming" | "archived"
// — not derived from dates. Real request: "remove the function to close current term... instead
// we need a function to set a term to Active. That requires: add a field to manage the term
// states: Current, Upcoming, Archive." Explicit reversal of this module's earlier design (status
// used to be entirely date-computed, never stored, specifically so it couldn't drift out of sync
// with the data — see git history for that reasoning) — the student now explicitly sets which
// term is Current via School Info's "Change Status" control (only one term can hold it at a
// time), and setting a term to Archive is likewise an explicit choice, not something that happens
// automatically once its end date passes. Changing a term's status never touches its
// courses/assignments/exams/etc — every consumer already scopes by `termId`, so a term's own data
// just sits exactly as it was, untouched, regardless of status (real request: "data model of each
// term is not affected by changing the status... no need to process anything, just to keep a full
// set of its isolated data as in that moment"). A term with no stored status at all (should only
// happen to genuinely new/malformed data — see migrateTermStatusIfNeeded for the one-time backfill
// on existing accounts) falls back to "upcoming", never silently "current".
export function computeTermStatuses(terms){
  return (terms||[]).map(t=>({...t,status:t.status||"upcoming"}));
}
// One-time migration for accounts that already had terms before status became a stored field —
// backfills a `status` onto every term that doesn't have one yet, computed via the OLD date-based
// rule this module used to use, so an existing account's terms land on a sensible, non-disruptive
// starting point (whichever term WOULD have read as "current" today stays current) instead of
// every term suddenly defaulting to "upcoming" with no term marked current at all. Idempotent —
// once every term has its own explicit status, this is permanently a no-op.
export function migrateTermStatusIfNeeded(data){
  const terms=data.terms||[];
  if(!terms.length||terms.every(t=>t.status))return null;
  const today=iso();
  const sorted=[...terms].sort((a,b)=>(a.start||"").localeCompare(b.start||""));
  const notArchived=sorted.filter(t=>t.end&&t.end>=today);
  const currentId=notArchived.length?notArchived[0].id:null;
  const withStatus=terms.map(t=>t.status?t:{
    ...t,
    status:(t.end&&t.end<today)?"archived":(t.id===currentId?"current":"upcoming"),
  });
  return{terms:withStatus};
}
// Whether two inclusive date ranges (ISO "YYYY-MM-DD" strings) overlap at all. Used to warn when
// adding/editing a term whose dates collide with the term currently driving the planner —
// getActiveTermAndSchool()/termScopedForPlanning() only ever treat ONE term as "current", so an
// overlap silently drops one term's courses from planning rather than merging them. False if
// either range is missing a date (a dateless term can't be checked; other logic already repairs
// those separately).
export function datesOverlap(aStart,aEnd,bStart,bEnd){
  if(!aStart||!aEnd||!bStart||!bEnd)return false;
  return aStart<=bEnd&&bStart<=aEnd;
}
// The term currently driving the planner, plus the school it belongs to. Null if no terms exist
// yet (e.g. before the one-time legacy migration below has run, or a brand-new install).
export function getActiveTermAndSchool(data){
  const statuses=computeTermStatuses(data.terms);
  const active=statuses.find(t=>t.status==="current");
  if(!active)return{term:null,school:null};
  const school=(data.schools||[]).find(s=>s.id===active.schoolId)||null;
  return{term:active,school};
}
// Scopes courses/assignments/exams to just the current term before handing off to the planner.
// Without this, the planner (both the deadline-driven scheduler and the regular-study fallback,
// which iterates data.courses directly) would consider EVERY course/assignment/exam ever
// created — including years-old archived terms kept for history, and any upcoming term
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
  // Real, shipped bug: deleting the last term left terms[] empty while the profile mirror fields
  // (schoolName/termStart/termEnd/...) were still cleared by a SEPARATE effect
  // (syncActiveTermToProfilePatch) on its own timing — in the gap (or across a reload that lands
  // between the two writes), this function saw "terms.length===0 + legacy fields still present"
  // and resynthesized a brand-new term from them, resurrecting the just-deleted term under a new
  // id. `termsInitialized` is a permanent, one-way marker: once an account has ever gone through
  // the real terms system (via this migration OR by adding a term directly), migration must never
  // fire again, no matter how empty terms[] gets afterward or what the profile mirror still says.
  if(data.termsInitialized)return null;
  if((data.terms||[]).length>0)return null; // already migrated (or a fresh install with no school yet)
  // Wait for the WHOLE legacy term (name + both dates), not just the school name. Firing on
  // schoolName alone — as it used to — synthesised a dateless term mid-onboarding, and the guard
  // above then blocked it from ever being fixed. repairTermLinkageIfNeeded still backstops any
  // account already in that state.
  if(!data.profile.schoolName||!data.profile.termStart||!data.profile.termEnd)return null;
  // During first-run onboarding, wait for the user to actually complete (save) the Term step —
  // an auto-fill from the school autocomplete would otherwise lock in a term they haven't
  // confirmed, and later edits on that step wouldn't reach it. Already-onboarded legacy accounts
  // never set this flag and still migrate on load via the checks above.
  if(!data.onboarded&&!data.profile.onboardTermSaved)return null;
  const schoolId="sch_"+Date.now();
  const termId="term_"+Date.now();
  const school={id:schoolId,name:data.profile.schoolName,address:data.profile.schoolAddress||"",schoolType:data.profile.schoolType||"quarter"};
  const term={
    id:termId,schoolId,name:data.profile.termName||data.profile.collegeCalendar?.quarters?.[0]?.name||"Current term",
    type:data.profile.schoolType||"quarter",
    start:data.profile.termStart||"",end:data.profile.termEnd||"",
    holidays:data.profile.collegeCalendar?.holidays||[],
    source:data.profile.collegeCalendar?.source||null,fetchedAt:data.profile.collegeCalendar?.fetchedAt||null,
    status:"current", // the ONLY term this migration ever creates — it's synthesizing whatever was already active from the old single-term profile fields
  };
  const patch={schools:[school],terms:[term],termsInitialized:true};
  // Backfill: any course that predates this feature has no termId at all — without this, it
  // would silently disappear from every term-filtered view the moment filtering goes live,
  // since undefined never matches the freshly-generated term id above.
  const untagged=(data.courses||[]).filter(c=>!c.termId);
  if(untagged.length>0){
    patch.courses=(data.courses||[]).map(c=>c.termId?c:{...c,termId});
  }
  return patch;
}
// One-time backfill for accounts that already have terms from before `termsInitialized` existed
// as a marker (see the guard at the top of migrateLegacyTermIfNeeded) — without this, an account
// that migrated/added its first term before this fix shipped would still be one deletion away
// from the exact resurrection bug that marker exists to prevent. Idempotent.
export function backfillTermsInitializedIfNeeded(data){
  if(data.termsInitialized)return null;
  if(!(data.terms||[]).length)return null;
  return{termsInitialized:true};
}
// Whether a term is safe to delete outright, and why not if it isn't. Only "upcoming" terms are
// ever deletable — never "current" (actively driving the planner) or "archived" (real history) —
// and even an upcoming term is blocked if courses are already attached to it, since a student can
// prep courses against a future term before it starts (Academics' term selector allows this), and
// silently cascading that deletion would be a much bigger, easy-to-miss loss than the term itself.
// `status` must already be computed (pass a term from computeTermStatuses' output, not a raw one).
export function canDeleteTerm(term,courses){
  if(!term)return{deletable:false,reason:"Term not found."};
  if(term.status!=="upcoming")return{deletable:false,reason:`Only upcoming terms can be deleted (this one is ${term.status}).`};
  const attachedCourses=(courses||[]).filter(c=>c.termId===term.id).length;
  if(attachedCourses>0){
    return{deletable:false,attachedCourses,
      reason:`It still has ${attachedCourses} course${attachedCourses!==1?"s":""} attached. Remove ${attachedCourses!==1?"those":"it"} first, or edit the term instead of deleting it.`};
  }
  return{deletable:true,reason:null};
}

// Keeps profile's existing termStart/termEnd/schoolName/schoolAddress/schoolType/collegeCalendar
// mirrored to whichever term is currently active, so every existing consumer of those fields
// (the planner, getTermRange, isFin/isHol, WeekGrid...) keeps working completely unchanged —
// they just always reflect "the active term" now instead of being the single source of truth
// themselves. Returns a patch to apply via updP, or null if nothing needs to change.
export function syncActiveTermToProfilePatch(data){
  const{term,school}=getActiveTermAndSchool(data);
  const p=data.profile;
  // No active/current term at all — every term was deleted, or none is marked Current. Real
  // reported bug: "I deleted all terms, and still showing term" — this mirror used to just be
  // left as whatever the last active term happened to be, since there was nothing to overwrite it
  // WITH; it needs to be actively cleared instead, or a deleted term's name/dates/calendar keeps
  // showing everywhere that reads these fields (the header badge, isFin/isHol, etc.) forever.
  if(!term){
    const patch={};
    if(p.termName)patch.termName="";
    if(p.termStart)patch.termStart="";
    if(p.termEnd)patch.termEnd="";
    if(p.schoolName)patch.schoolName="";
    if(p.schoolAddress)patch.schoolAddress="";
    if(p.collegeCalendar)patch.collegeCalendar=null;
    return Object.keys(patch).length?patch:null;
  }
  const patch={};
  if(p.termName!==term.name)patch.termName=term.name;
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
