import { getTermRange, termScopedForPlanning } from "@/lib/data";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const daysBetween = (a, b) => Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 864e5);

// The date range study planning should actually use for the active term.
//
// The END is anchored on the term's real work — the latest exam date / assignment due date among
// its items — NOT the term-end date the student typed. That typed date is easy to get wrong in
// either direction:
//   - too late  → the plan grows a long empty tail after the last final (D1 keeps it blockless,
//                 but the horizon math is still off)
//   - too early → real deadlines fall outside the horizon and get hidden
// and it's only relied on elsewhere (finals-week badge, holiday detection, term status). We fall
// back to the typed term-end only when the term has no dated items yet.
//
// Returns null when there's nothing to anchor on at all. When the typed term-end is meaningfully
// off from the real last deadline (either direction), `termEndWarning` describes the mismatch so
// the UI can nudge the student to fix the date in School Info.
export function planningRange(data) {
  const raw = getTermRange(data.profile); // { start, end } from the typed term dates, or null
  const scoped = termScopedForPlanning(data);
  const deadlines = [
    ...scoped.exams.map(e => e.date),
    ...scoped.assignments.filter(a => a.dueDate).map(a => a.dueDate),
  ].filter(d => d && ISO.test(d));

  const lastDeadline = deadlines.length ? deadlines.reduce((m, d) => (d > m ? d : m)) : null;
  const firstDeadline = deadlines.length ? deadlines.reduce((m, d) => (d < m ? d : m)) : null;
  const typedStart = raw?.start || null;
  const typedEnd = raw?.end || null;

  const end = lastDeadline || typedEnd;
  if (!end) return null;

  // Start keeps its current behaviour: the typed term start, pulled earlier if a deadline predates it.
  let start = typedStart || firstDeadline || end;
  if (firstDeadline && firstDeadline < start) start = firstDeadline;

  const GAP_DAYS = 2; // cushion — a term that legitimately ends a day or two after the last final isn't a mistake
  let termEndWarning = null;
  if (typedEnd && lastDeadline) {
    const gap = daysBetween(lastDeadline, typedEnd); // + = typed end is later than last deadline, - = earlier
    if (Math.abs(gap) > GAP_DAYS) {
      termEndWarning = {
        typedEnd,
        lastDeadline,
        gapDays: Math.abs(gap),
        direction: gap > 0 ? "after" : "before",
      };
    }
  }

  return { start, end, lastDeadline, typedEnd, termEndWarning };
}
