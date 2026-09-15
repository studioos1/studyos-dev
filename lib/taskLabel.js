// Every task label the planner writes (lib/planner/schedule.js) is built as
// "<courseName> <rest>" — "MATH 180A exam prep (4d left)", "MATH 180A — Problem Set 5 (due in
// 11d)", "DSC 10 — regular study", etc. Today's Focus Time row shows that label AND the course
// name as its own line right below it — same information twice, wasting the width the row's
// ellipsis truncation needs. This strips the leading course-name prefix for display only; the
// stored label itself is never touched, since other surfaces (Calendar's day agenda, PlanDrawer)
// show the task without a separate course line and still need it whole.
//
// Tries the raw course name first, then a "(" -split-and-trimmed version — the planner itself is
// inconsistent about which form ends up in the label (exam/homework labels use the raw course
// name; project/regular-study labels use the cleaned one), so a course name with a parenthetical
// suffix (e.g. "MATH 180A (Prof. Smith)") needs both tried to match whichever form the label
// actually used.
export function dedupeCourseFromTaskLabel(task,course){
  if(!task)return task;
  const candidates=[course||"",(course||"").split("(")[0].trim()];
  for(const prefix of candidates){
    if(!prefix||!task.startsWith(prefix))continue;
    let rest=task.slice(prefix.length).trim().replace(/^—\s*/,"").trim();
    if(!rest)continue; // stripped to nothing — try the other candidate rather than show blank
    return rest[0].toUpperCase()+rest.slice(1);
  }
  return task; // neither form matched (or both stripped to nothing) — leave it whole
}
