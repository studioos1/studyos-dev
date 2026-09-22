// Assignments On-time scoring — a continuous per-item score, not a binary on-time/late count.
// One formula covers the whole spec: on time = 100%, early = bonus above 100% (capped), late =
// partial credit that shrinks the later it was turned in, still-missing = the same shrinking
// credit computed live against today (so it keeps dropping until it's done, then locks in
// wherever it landed). Used by Today.jsx's Progress card.
//
// diffDays is "days before the deadline" the item was resolved — positive = early, 0 = on time,
// negative = late/overdue. Tunable, centralized here rather than scattered through the
// component, same convention as the planner's own tuned constants (lib/planner/*).
export const ONTIME_EARLY_BONUS_PER_DAY = 5;   // % bonus per day early
export const ONTIME_EARLY_BONUS_CAP_DAYS = 10; // bonus stops growing past this many days early
export const ONTIME_LATE_PENALTY_PER_DAY = 10; // % penalty per day late or still overdue

export function assignmentOnTimeScore(diffDays){
  if(diffDays>=0)return 100+Math.min(diffDays,ONTIME_EARLY_BONUS_CAP_DAYS)*ONTIME_EARLY_BONUS_PER_DAY;
  return Math.max(0,100+diffDays*ONTIME_LATE_PENALTY_PER_DAY);
}

// The raw average of assignmentOnTimeScore() across a set of items can exceed 100 (early-bonus
// items pull it up) — but a metric literally called "on time" reading as 112% is confusing on
// its own. Splits it into a normal capped 0-100 reading (for the main number/bar/color) and
// whatever's earned above that (shown as its own small "+N" badge next to the number instead of
// being folded into it).
export function splitOnTimeScore(raw){
  if(raw===null)return{pct:null,bonus:0};
  return{pct:Math.min(100,raw),bonus:Math.max(0,raw-100)};
}

// Both extracted from components/Today.jsx's Progress card, which used to compute these inline —
// assignmentOnTimeScore/splitOnTimeScore above were already tested, but the aggregation AROUND
// them (which items count, how the reference date is picked) wasn't, same gap Study Pace had.
// Pure functions here so both get the same real test coverage; Today.jsx now just calls these and
// keeps only the presentation logic (color bands, the shared headline) of its own.

// Study Pace — term-accumulated completion rate for planned study/homework/project time, counting
// ONLY the portion of the term that's already happened (term start through today, inclusive) — not
// the term's total planned load, and not anything past today. `weeks` is data.studyPlan.weeks (the
// same source lib/calendar/weeks.js's realDayBlocks reads); every block found there is already
// study/homework/project by construction (the planner never writes classes/meals/gym into
// studyPlan — those come from a separate structure merged in only at render time), so this doesn't
// need its own kind filter. null (not 0) when nothing's been planned in that window yet — "no
// data", not "0%".
export function computeStudyPace(weeks,termStart,today){
  if(!termStart||termStart>today)return null;
  let planned=0,done=0;
  Object.values(weeks||{}).forEach(week=>{
    Object.entries(week.days||{}).forEach(([dateStr,blocks])=>{
      if(dateStr<termStart||dateStr>today)return;
      (blocks||[]).forEach(b=>{
        const mins=b.e-b.s;
        planned+=mins;
        if(b.completed)done+=mins;
      });
    });
  });
  return planned>0?Math.round(100*done/planned):null;
}

// Assignments On-time — the raw (uncapped) average assignmentOnTimeScore() across every
// assignment accumulated from the term's start through today: EITHER already due, OR already done
// (even ahead of its own due date — that's exactly what "early" means, and it should count the
// moment it happens, not sit excluded until the due date eventually passes it by). completedAt
// (stamped the moment status flips to "done") is the reference date; a completion recorded before
// that field existed has no completedAt and defaults to the due date itself (exactly on time)
// rather than being penalized retroactively for data that was never captured. A still-open,
// already-due item scores against TODAY, so it keeps shrinking until it's actually done, then
// locks in wherever it landed. Pass the raw result to splitOnTimeScore() for display, same as
// before extraction — this only replaces the filtering/averaging that used to sit inline.
export function computeOnTimeRaw(assignments,termStart,today){
  if(!termStart)return null;
  const dueToDate=(assignments||[]).filter(a=>a.dueDate&&a.dueDate>=termStart&&(a.dueDate<=today||a.status==="done"));
  if(dueToDate.length===0)return null;
  const scores=dueToDate.map(a=>{
    const refDate=a.status==="done"?(a.completedAt?a.completedAt.slice(0,10):a.dueDate):today;
    const diffDays=Math.round((new Date(a.dueDate)-new Date(refDate))/864e5);
    return assignmentOnTimeScore(diffDays);
  });
  return Math.round(scores.reduce((s,v)=>s+v,0)/scores.length);
}
