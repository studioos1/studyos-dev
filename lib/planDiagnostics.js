import { iso } from "@/lib/time";
import { planHorizon, buildItemDemand, computePriorityScore } from "@/lib/planner";
import { freeSlots, weekStartOf } from "@/lib/calendar";
import { getTermRange, termScopedForPlanning } from "@/lib/data";

const round1 = n => Math.round(n * 10) / 10;

// Runs the same planner that "Replan whole term" runs — today through term end (extended to cover
// any late deadline) — but purely to REPORT, never to persist. Feeds the Weekly-tab Plan status
// drawer. Returns null when term dates aren't set.
export function computePlanDiagnostics(data) {
  const raw = getTermRange(data.profile);
  if (!raw) return null;

  let { start, end } = raw;
  [
    ...data.exams.map(e => e.date),
    ...data.assignments.filter(a => a.dueDate && a.dueDate.length === 10).map(a => a.dueDate),
  ].filter(Boolean).forEach(d => { if (d < start) start = d; if (d > end) end = d; });

  const today = iso();
  const startStr = today > start ? today : start;
  const sd = new Date(startStr + "T12:00:00");
  const ed = new Date(end + "T12:00:00");
  const allDates = [];
  for (let d = new Date(sd); d <= ed; d.setDate(d.getDate() + 1)) allDates.push(iso(new Date(d)));

  const meta = { horizon: { start: startStr, end, days: allDates.length } };
  if (!allDates.length) return { ...meta, items: [], totals: { desiredH: 0, plannedH: 0, shortItems: 0, shortH: 0 } };

  const scoped = termScopedForPlanning(data);
  const weeks = data.studyPlan?.weeks || {};
  const userEditedByDate = {};
  allDates.forEach(ds => {
    userEditedByDate[ds] = (weeks[weekStartOf(ds)]?.days?.[ds] || []).filter(b => b.userEdited);
  });
  const gapsByDayFn = (ds, userEdited) => freeSlots(ds, scoped, userEdited);
  const r = planHorizon(allDates, scoped, gapsByDayFn, userEditedByDate);

  // planHorizon's summaryItems carry id/title/course/desired/planned/shortfall/fullyCovered but
  // not due/difficulty/priority — join those from buildItemDemand (same input, same ids).
  const demand = Object.fromEntries(buildItemDemand(scoped).map(d => [d.id, d]));
  const items = r.summaryItems.map(it => {
    const d = demand[it.id] || {};
    const startWindow = d.dueDate && d.startWindowDays != null
      ? iso(new Date(new Date(d.dueDate + "T12:00:00").getTime() - d.startWindowDays * 864e5))
      : null;
    return {
      id: it.id,
      rawId: d.rawId ?? null,          // the underlying assignment/exam id — for edit/prioritise actions
      kind: d.source?.type || null,    // "assignment" | "exam"
      forced: !!d.forced,
      title: it.title,
      courseName: it.courseName,
      dueDate: d.dueDate || null,
      difficulty: d.effectiveDifficulty || null,
      priority: d.dueDate ? computePriorityScore(d.dueDate, d.effectiveDifficulty, d.weight, today) : null,
      desiredHours: it.desiredHours,
      plannedHours: it.plannedHours,
      shortfallHours: it.shortfallHours,
      fullyCovered: it.fullyCovered,
      startWindow,
    };
  }).sort((a, b) => {
    if (a.fullyCovered !== b.fullyCovered) return a.fullyCovered ? 1 : -1; // shortfalls first
    return (a.dueDate || "9999").localeCompare(b.dueDate || "9999");
  });

  // Items whose due date has already passed but which aren't marked done can never be scheduled
  // in a today→future horizon, so the planner scores them 100% short. That's not a real capacity
  // problem — it's a status-tracking gap. Split them out so the headline "short" number only
  // reflects genuinely-schedulable-but-unfittable work.
  const overdue = items.filter(it => it.dueDate && it.dueDate < today)
    .sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""));
  const upcoming = items.filter(it => !(it.dueDate && it.dueDate < today));

  const desiredH = round1(upcoming.reduce((s, it) => s + it.desiredHours, 0));
  const plannedH = round1(upcoming.reduce((s, it) => s + it.plannedHours, 0));
  const short = upcoming.filter(it => !it.fullyCovered);
  const totals = {
    desiredH,
    plannedH,
    shortItems: short.length,
    shortH: round1(short.reduce((s, it) => s + it.shortfallHours, 0)),
  };

  return { ...meta, items: upcoming, overdue, totals };
}
