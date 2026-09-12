import { iso } from "@/lib/time";
import { daysFrom } from "./core";

// Core Estimator — computes a Low/Mid/High difficulty rating for one assignment or exam.
// Inputs: the course's own difficulty score (1-10) — itself web-research-backed, see B-01's
// /api/course-info — and the item's weight (% of grade). A high-weight item in a hard course
// scores High; a low-weight item in an easy course scores Low. (An earlier design researched
// difficulty per-ITEM via a webDifficultySignal() stub; that was superseded by researching the
// COURSE once, at creation time, which is what course.difficulty already reflects — no per-item
// lookup needed here.)
// We never alter or supplement a real weight extracted from the syllabus. Defaults only apply
// per-course, per-category (exams / homework), and only when that ENTIRE category has zero real
// weights for that course — if even one exam has a stated weight, no exam in that course gets a
// default; the rest are simply left unweighted (null) for the student to fill in themselves.
// This avoids ever mixing real and assumed numbers within the same category, which is the only
// way to guarantee we're not silently distorting what the syllabus actually said.
export async function estimateDifficulty(item,course){
  const courseDiff=+(course?.difficulty)||5; // 1-10 scale, defaults to Medium if unknown
  const weight=item.weight!=null?+item.weight:10; // no weight stated → assume a modest 10%, not zero
  // Weight is the primary stakes signal, scaled against realistic single-item grade weights
  // (most fall 2-35% — a 30% midterm should clearly register as high-stakes without needing
  // near-100% weight to do so). Difficulty then modulates that base as a multiplier.
  const weightScore=Math.min(10,weight/3);
  const diffMult=0.7+(courseDiff/10)*0.6; // 1/10 diff → 0.76x, 10/10 diff → 1.3x
  let combined=weightScore*diffMult;

  // Bands over the combined score (roughly 0–13). "Very High" is deliberately rare — reserved for
  // a heavy item in a genuinely hard course (a cumulative final, a capstone), not just any exam.
  const value=combined<=3.5?"Low":combined<=7?"Mid":combined<=11?"High":"Very High";
  return{value,combinedScore:Math.round(combined*10)/10};
}
// The four difficulty bands, in order. "Very High" is for cumulative finals / capstone projects.
export const DIFFICULTY_BANDS=["Low","Mid","High","Very High"];

// Suggested study hours for one assignment/exam. Driven by the item's DIFFICULTY BAND (the same
// Low/Mid/High/Very-High rating shown in Study Preferences — from estimateDifficulty, or the
// student's own override), then fine-tuned by grade weight. A plain lookup on purpose: "why is
// this 5h?" should always have a one-line answer. The band already folds in course difficulty
// (that's what estimateDifficulty does with course.difficulty × weight), so this does NOT also
// multiply by difficultyMultiplier(course) — that would double-count. `course` is kept in the
// signature for call-site stability and possible future use; it is intentionally unused here.
//
// TUNE HERE: these are the numbers that reshape every study plan. Edit freely.
export const STUDY_HOURS_BY_RATING={
  homework:{Low:1.5,Mid:3,High:5,"Very High":7},
  exam:{Low:4,Mid:7,High:11,"Very High":16},
};
export function estimateStudyHours(item,course,kind,rating){
  const band=STUDY_HOURS_BY_RATING[kind==="exam"?"exam":"homework"];
  const base=band[rating]??band.Mid; // no/unknown rating → treat as Mid
  // Weight nudges within the band: ~15% grade weight is neutral, clamped to ±30% either way so a
  // very heavy or very light item shifts without leaving the band's ballpark.
  const weight=item?.weight!=null?+item.weight:15;
  const nudge=Math.max(0.7,Math.min(1.3,0.4+weight/25)); // 15%→1.0, ≤7.5%→0.7, ≥22.5%→1.3
  return Math.round(base*nudge*2)/2; // nearest half-hour, matches the "Est. hours" input's step
}

// Composite priority score for one assignment/exam — priority = urgency × difficulty_weight × grade_weight.
// Not persisted (depends on "today," so storing it would go stale immediately) — always computed
// live wherever it's displayed or used for scheduling.
export function urgencyFactor(daysUntilDue){
  const clamped=Math.max(0,Math.min(14,daysUntilDue));
  return daysUntilDue>14?1.0:1.0+(14-clamped)/14; // flat 1.0x beyond 2 weeks out, gentle linear ramp to 2.0x by the due date — no drastic spike
}
export const DIFFICULTY_WEIGHT={Low:1,Mid:2,High:3,"Very High":4};
export function computePriorityScore(dueDate,effectiveDifficulty,weight,asOfDate){
  if(!dueDate)return 0;
  const urgency=urgencyFactor(daysFrom(asOfDate||iso(),dueDate));
  const diffWeight=DIFFICULTY_WEIGHT[effectiveDifficulty]||2;
  const gradeWeight=weight!=null?+weight:10;
  return Math.round(urgency*diffWeight*gradeWeight*10)/10;
}

// Computes and packages the difficulty + hours fields for a brand-new assignment/exam, meant to be
// called once at item-CREATION time (syllabus sync, manual add) — one of the agreed replan/estimate
// triggers — rather than lazily whenever the Study Preferences tab happens to be opened. This is what
// lets that tab simply read stored values on every visit with no async recompute and no spinner,
// except for genuinely legacy items that predate this change.
export async function computeEstimateFields(item,course,kind){
  const r=await estimateDifficulty(item,course);
  const aiHours=estimateStudyHours(item,course,kind,r.value);
  return{estimatorValue:r.value,aiHours,userValue:null,userHours:null,reviewedAt:null};
}
