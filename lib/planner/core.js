// Small pure helpers shared by estimate.js and schedule.js — kept in their own file so
// neither of those two has to import from the other.

export const ISO_DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
// Rounds a minute-of-day value UP to the next 15-min grid line (:00/:15/:30/:45).
// Already-aligned values pass through unchanged.
export function alignUp15(m){return Math.ceil(m/15)*15;}
export function daysFrom(dateStr,targetDate){
  return Math.round((new Date(targetDate+"T12:00:00")-new Date(dateStr+"T12:00:00"))/864e5);
}
// Harder classes get proportionally more time: 1/10 difficulty → 0.76x baseline, 5/10 → 1.0x (neutral), 10/10 → 1.3x.
export function difficultyMultiplier(difficulty){
  const n=+difficulty;
  const d=Number.isFinite(n)&&n>=1&&n<=10?n:5;
  return 0.7+(d/10)*0.6;
}
