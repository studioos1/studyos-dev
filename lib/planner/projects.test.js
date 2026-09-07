// Project scheduling: an assignment with type:"project" is planned as steady, even-pace work
// starting from today — not a homework-style sprint in the last few days before it's due.
import { describe, it, expect } from "vitest";
import { planHorizon } from "./index";

const PROFILE = { wakeTime: "07:00", sleepTime: "23:00", sessionPreset: 30, energyPeak: "morning" };

function addDays(dateStr, n) {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + n);
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function makeGapsFn({ dayStart = 540, dayEnd = 1320 } = {}) {
  return (dateStr, userEditedBlocks = []) => {
    const occ = [...userEditedBlocks].map((b) => ({ s: Math.max(b.s, dayStart), e: Math.min(b.e, dayEnd) }))
      .filter((b) => b.s < b.e).sort((a, b) => a.s - b.s);
    const gaps = []; let cur = dayStart;
    occ.forEach((b) => { if (b.s > cur) gaps.push({ s: cur, e: b.s }); cur = Math.max(cur, b.e); });
    if (cur < dayEnd) gaps.push({ s: cur, e: dayEnd });
    return gaps.filter((g) => g.e - g.s >= 10);
  };
}
const minutesFor = (dayBlocks, pred) => (dayBlocks || []).filter(pred).reduce((s, b) => s + (b.e - b.s), 0);
const isProject = (b) => b.kind === "project";

const TODAY = "2026-09-07";

describe("project scheduling", () => {
  it("starts well before the 5-day homework window and spreads across many days", () => {
    const due = addDays(TODAY, 40);
    const dateStrs = Array.from({ length: 41 }, (_, i) => addDays(TODAY, i));
    const data = {
      profile: PROFILE,
      courses: [{ id: 1, name: "MMW 122", difficulty: 6, weeklyHours: 0 }],
      assignments: [
        { id: 1, courseId: 1, title: "Research Paper", type: "project", dueDate: due, status: "not-started", estimatedHours: 12, weight: 25 },
      ],
      exams: [],
    };
    const result = planHorizon(dateStrs, data, makeGapsFn(), {});

    const daysWithWork = dateStrs.filter((d) => minutesFor(result.blocksByDate[d], isProject) > 0);
    // Work begins in the first week, not 5 days out.
    expect(daysWithWork[0] < addDays(due, -5)).toBe(true);
    expect(daysWithWork[0] <= addDays(TODAY, 7)).toBe(true);
    // Spread over many days, not dumped into a handful.
    expect(daysWithWork.length).toBeGreaterThanOrEqual(10);
    // No single day carries a huge share — even pace.
    const maxDay = Math.max(...dateStrs.map((d) => minutesFor(result.blocksByDate[d], isProject)));
    expect(maxDay).toBeLessThanOrEqual(150);
  });

  it("finishes before the due date, with nothing on the due date itself", () => {
    const due = addDays(TODAY, 30);
    const dateStrs = Array.from({ length: 31 }, (_, i) => addDays(TODAY, i));
    const data = {
      profile: PROFILE,
      courses: [{ id: 1, name: "MMW 122", difficulty: 6, weeklyHours: 0 }],
      assignments: [
        { id: 2, courseId: 1, title: "Term Project", type: "project", dueDate: due, status: "not-started", estimatedHours: 10, weight: 20 },
      ],
      exams: [],
    };
    const result = planHorizon(dateStrs, data, makeGapsFn(), {});
    expect(minutesFor(result.blocksByDate[due], isProject)).toBe(0);
    const total = dateStrs.reduce((s, d) => s + minutesFor(result.blocksByDate[d], isProject), 0);
    expect(total).toBeGreaterThanOrEqual(10 * 60 - 30); // essentially fully covered
    // A finish buffer: the last few days before the due date are clear.
    const tailClear = [addDays(due, -1), addDays(due, -2)].every(
      (d) => minutesFor(result.blocksByDate[d], isProject) === 0
    );
    expect(tailClear).toBe(true);
  });

  it("a plain homework assignment (no type) is still held to its 5-day window", () => {
    const due = addDays(TODAY, 20);
    const dateStrs = Array.from({ length: 21 }, (_, i) => addDays(TODAY, i));
    const data = {
      profile: PROFILE,
      courses: [{ id: 1, name: "MMW 122", difficulty: 6, weeklyHours: 0 }],
      assignments: [
        { id: 3, courseId: 1, title: "Essay 2", dueDate: due, status: "not-started", estimatedHours: 4, weight: 10 },
      ],
      exams: [],
    };
    const result = planHorizon(dateStrs, data, makeGapsFn(), {});
    const windowOpen = addDays(due, -5);
    dateStrs.filter((d) => d < windowOpen).forEach((d) => {
      expect(minutesFor(result.blocksByDate[d], (b) => b.source?.id === 3)).toBe(0);
    });
  });

  it("keeps going during the finals stretch, when regular study is suppressed", () => {
    const examA = addDays(TODAY, 20);
    const examB = addDays(TODAY, 24);
    const projDue = addDays(TODAY, 23); // due mid-finals-week
    const dateStrs = Array.from({ length: 28 }, (_, i) => addDays(TODAY, i));
    const data = {
      profile: PROFILE,
      courses: [
        { id: 1, name: "MMW 122", difficulty: 6, weeklyHours: 6 },
        { id: 2, name: "MATH 180A", difficulty: 6, weeklyHours: 6 },
      ],
      assignments: [
        { id: 4, courseId: 1, title: "Capstone", type: "project", dueDate: projDue, status: "not-started", estimatedHours: 10, weight: 25 },
      ],
      exams: [
        { id: 10, courseId: 1, date: examA, prepDays: 7, status: "not-started", estimatedHours: 3, weight: 30 },
        { id: 11, courseId: 2, date: examB, prepDays: 7, status: "not-started", estimatedHours: 3, weight: 30 },
      ],
    };
    const result = planHorizon(dateStrs, data, makeGapsFn(), {});
    // Inside the finals stretch (examA-1 .. examB) regular study is gone…
    const stretch = dateStrs.filter((d) => d >= addDays(examA, -1) && d <= examB);
    stretch.forEach((d) => {
      expect(minutesFor(result.blocksByDate[d], (b) => /regular study/.test(b.label || ""))).toBe(0);
    });
    // …but the project keeps making progress on days before its own due date within that window.
    const projWorkInStretch = stretch
      .filter((d) => d < projDue)
      .reduce((s, d) => s + minutesFor(result.blocksByDate[d], isProject), 0);
    expect(projWorkInStretch).toBeGreaterThan(0);
  });
});
