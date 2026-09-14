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
