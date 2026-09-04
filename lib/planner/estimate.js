import { iso } from "@/lib/time";
import { daysFrom, difficultyMultiplier } from "./core";

// MOCK — real-world difficulty signal lookup for a single assignment/exam (e.g. "how hard is a
// UCSD MATH 180A midterm" from student reviews, past syllabi, etc). This is the seam for a real
// web-search implementation later; for now it returns a neutral stub so the rest of the Estimator
// pipeline can be built and tested end-to-end without depending on that feature existing yet.
// Swapping this one function for a real search call is the only change needed to wire it up later.
export async function webDifficultySignal(item,course){
  // Deliberately neutral/no-op — returning null means "no external signal available," which the
  // estimator treats the same as if this function didn't exist at all (falls back to local-only
  // calculation). This keeps today's estimates identical to a pre-web-search world by design.
  return null;
}
// Core Estimator — computes a Low/Mid/High difficulty rating for one assignment or exam.
// Local-only inputs: the course's own difficulty score (1-10) and the item's weight (% of grade).
// A high-weight item in a hard course scores High; a low-weight item in an easy course scores Low.
// The webDifficultySignal() call is wired in but currently always returns null (see above) — when
// a real implementation exists later, its result would nudge this rating without any other change
// needed here.
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

  const webSignal=await webDifficultySignal(item,course);
  if(webSignal?.adjustment)combined=Math.max(0,combined+webSignal.adjustment);

  const value=combined<=4?"Low":combined<=7.5?"Mid":"High";
  return{value,combinedScore:Math.round(combined*10)/10};
}

// Total suggested study hours for one assignment/exam — Phase 1 of the planner design.
// total_hours = base_hours(type) × difficulty_multiplier(course) × weight_scaling(item stakes)
// Reuses difficultyMultiplier() (course-level 1-10 → 0.7x-1.3x, same as studyTargets' regular-study
// scaling) and the same weightScore normalization as estimateDifficulty, rather than introducing a
// second, inconsistent notion of "how much this course's difficulty matters." Deliberately does NOT
// factor in the item's own Low/Mid/High rating — that rating is itself partly weight-derived, so
// multiplying by it too would double-count stakes.
export const STUDY_HOURS_BASE={homework:2,exam:4}; // homework matches today's existing estimatedHours default; exams start higher since prep spans more material
export function estimateStudyHours(item,course,kind){
  const base=STUDY_HOURS_BASE[kind]??2;
  const diffMult=difficultyMultiplier(course?.difficulty);
  const weight=item.weight!=null?+item.weight:10;
  const weightScore=Math.min(10,weight/3); // same normalization as estimateDifficulty
  const weightScaling=Math.min(2.0,Math.max(0.5,weightScore/5)); // 15% weight (weightScore 5) → neutral 1.0x
  const hours=base*diffMult*weightScaling;
  return Math.round(hours*2)/2; // nearest half-hour, matches the existing "Est. hours" input's step
}

// Composite priority score for one assignment/exam — priority = urgency × difficulty_weight × grade_weight.
// Not persisted (depends on "today," so storing it would go stale immediately) — always computed
// live wherever it's displayed or used for scheduling.
export function urgencyFactor(daysUntilDue){
  const clamped=Math.max(0,Math.min(14,daysUntilDue));
  return daysUntilDue>14?1.0:1.0+(14-clamped)/14; // flat 1.0x beyond 2 weeks out, gentle linear ramp to 2.0x by the due date — no drastic spike
}
export const DIFFICULTY_WEIGHT={Low:1,Mid:2,High:3};
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
  const aiHours=estimateStudyHours(item,course,kind);
  return{estimatorValue:r.value,aiHours,userValue:null,userHours:null,reviewedAt:null};
}
