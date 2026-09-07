// Exam-prep pre-pass (rules A–H). The pre-pass decides all exam study GLOBALLY before day-by-day
// planning so it can be back-loaded toward each exam and prioritised across exams. Same synthetic
// `gapsByDayFn` contract as planHorizon.test.js — the planner is exercised in isolation.
import { describe, it, expect } from "vitest";
import { planHorizon, buildExamPrepPlan, buildItemDemand } from "./index";

const PROFILE = { wakeTime: "07:00", sleepTime: "23:00", sessionPreset: 30, energyPeak: "morning" };

function addDays(dateStr, n) {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + n);
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function makeGapsFn({ dayStart = 540, dayEnd = 1320 } = {}) {
  return (dateStr, userEditedBlocks = []) => {
    const occupied = [...userEditedBlocks]
      .map((b) => ({ s: Math.max(b.s, dayStart), e: Math.min(b.e, dayEnd) }))
      .filter((b) => b.s < b.e)
      .sort((a, b) => a.s - b.s);
    const gaps = [];
    let cursor = dayStart;
    occupied.forEach((b) => {
      if (b.s > cursor) gaps.push({ s: cursor, e: b.s });
      cursor = Math.max(cursor, b.e);
    });
    if (cursor < dayEnd) gaps.push({ s: cursor, e: dayEnd });
    return gaps.filter((g) => g.e - g.s >= 10);
  };
}
const minutesFor = (dayBlocks, predicate) =>
  (dayBlocks || []).filter(predicate).reduce((s, b) => s + (b.e - b.s), 0);
const isExamPrep = (b) => /exam prep|final review/.test(b.label || "");
const isRegular = (b) => /regular study/.test(b.label || "");

const TODAY = "2026-10-20";

describe("exam pre-pass — rule F: no study on an exam day", () => {
  it("the exam's own date carries zero study blocks", () => {
    const examDate = addDays(TODAY, 6);
    const dateStrs = Array.from({ length: 12 }, (_, i) => addDays(TODAY, i));
    const data = {
      profile: PROFILE,
      courses: [{ id: 1, name: "MMW", difficulty: 6, weeklyHours: 5 }],
      assignments: [],
      exams: [{ id: 900, courseId: 1, date: examDate, prepDays: 7, status: "not-started", estimatedHours: 5, weight: 30 }],
    };
    const result = planHorizon(dateStrs, data, makeGapsFn(), {});
    expect((result.blocksByDate[examDate] || []).length).toBe(0);
  });
});

describe("exam pre-pass — rule B: prep is back-loaded toward the exam", () => {
  it("each day nearer the exam gets at least as much prep as the day before it", () => {
    const examDate = addDays(TODAY, 7);
    const dateStrs = Array.from({ length: 12 }, (_, i) => addDays(TODAY, i));
    const data = {
      profile: PROFILE,
      courses: [{ id: 1, name: "MMW", difficulty: 6, weeklyHours: 0 }],
      assignments: [],
      exams: [{ id: 901, courseId: 1, date: examDate, prepDays: 7, status: "not-started", estimatedHours: 6, weight: 30 }],
    };
    const result = planHorizon(dateStrs, data, makeGapsFn(), {});
    const prepDays = dateStrs.filter((d) => d < examDate);
    const series = prepDays.map((d) => minutesFor(result.blocksByDate[d], isExamPrep));
    // Non-decreasing as the exam approaches (last element = D-1 = the eve).
    for (let i = 1; i < series.length; i++) expect(series[i]).toBeGreaterThanOrEqual(series[i - 1]);
    // The eve is packed well past a normal prep day's 3.5h cap — it's the last chance.
    const eveMinutes = series[series.length - 1];
    expect(eveMinutes).toBeGreaterThan(210);
    expect(eveMinutes).toBeLessThanOrEqual(420);
    // Every earlier prep day still respects the normal per-exam daily cap (3.5h).
    series.slice(0, -1).forEach((m) => expect(m).toBeLessThanOrEqual(210));
  });

  it("high-stakes exams are spread across at least 3 distinct days", () => {
    const examDate = addDays(TODAY, 7);
    const dateStrs = Array.from({ length: 12 }, (_, i) => addDays(TODAY, i));
    const data = {
      profile: PROFILE,
      courses: [{ id: 1, name: "MMW", difficulty: 6, weeklyHours: 0 }],
      assignments: [],
      exams: [{ id: 902, courseId: 1, date: examDate, prepDays: 7, status: "not-started", estimatedHours: 6, weight: 40 }],
    };
    const result = planHorizon(dateStrs, data, makeGapsFn(), {});
    const daysWithPrep = dateStrs.filter((d) => minutesFor(result.blocksByDate[d], isExamPrep) > 0);
    expect(daysWithPrep.length).toBeGreaterThanOrEqual(3);
  });
});

describe("exam pre-pass — rule A: exclusive eve", () => {
  it("the day before an exam carries only that exam's prep — no other course's homework", () => {
    const examDate = addDays(TODAY, 6);
    const eve = addDays(TODAY, 5);
    const hwDue = addDays(TODAY, 9); // course B homework, its 5-day window is open on the eve
    const dateStrs = Array.from({ length: 12 }, (_, i) => addDays(TODAY, i));
    const data = {
      profile: PROFILE,
      courses: [
        { id: 1, name: "MMW", difficulty: 6, weeklyHours: 0 },
        { id: 2, name: "DSC", difficulty: 6, weeklyHours: 0 },
      ],
      assignments: [
        { id: 20, courseId: 2, title: "PS3", dueDate: hwDue, status: "not-started", estimatedHours: 4, weight: 15 },
      ],
      exams: [{ id: 903, courseId: 1, date: examDate, prepDays: 7, status: "not-started", estimatedHours: 4, weight: 30 }],
    };
    const result = planHorizon(dateStrs, data, makeGapsFn(), {});
    const eveBlocks = result.blocksByDate[eve] || [];
    expect(eveBlocks.length).toBeGreaterThan(0);
    expect(eveBlocks.every(isExamPrep)).toBe(true);
    expect(minutesFor(eveBlocks, (b) => b.source?.id === 20)).toBe(0);
  });
});

describe("exam pre-pass — rule A: a nearer exam's eve is off-limits to a later exam", () => {
  it("three back-to-back finals — each eve carries only its own exam's prep", () => {
    // Mirrors the real MMW / MATH / DSC finals cluster: exams 2 days apart, all high-stakes.
    const examMMW = addDays(TODAY, 12);
    const examMATH = addDays(TODAY, 14);
    const examDSC = addDays(TODAY, 16);
    const dateStrs = Array.from({ length: 20 }, (_, i) => addDays(TODAY, i));
    const data = {
      profile: PROFILE,
      courses: [
        { id: 1, name: "MMW", difficulty: 6, weeklyHours: 0 },
        { id: 2, name: "MATH", difficulty: 6, weeklyHours: 0 },
        { id: 3, name: "DSC", difficulty: 6, weeklyHours: 0 },
      ],
      assignments: [],
      exams: [
        { id: 11, courseId: 1, date: examMMW, prepDays: 10, status: "not-started", estimatedHours: 8, weight: 35 },
        { id: 12, courseId: 2, date: examMATH, prepDays: 10, status: "not-started", estimatedHours: 8, weight: 35 },
        { id: 13, courseId: 3, date: examDSC, prepDays: 10, status: "not-started", estimatedHours: 8, weight: 35 },
      ],
    };
    const result = planHorizon(dateStrs, data, makeGapsFn(), {});
    const onlyCourse = (d, courseId) => {
      const blocks = (result.blocksByDate[d] || []).filter(isExamPrep);
      expect(blocks.length).toBeGreaterThan(0);
      expect(blocks.every((b) => b.courseId === courseId)).toBe(true);
    };
    onlyCourse(addDays(examMMW, -1), 1);  // MMW eve → MMW only
    onlyCourse(addDays(examMATH, -1), 2); // MATH eve → MATH only (no MMW spillover, no DSC)
    onlyCourse(addDays(examDSC, -1), 3);  // DSC eve → DSC only
    // And nothing at all on the exam days themselves.
    [examMMW, examMATH, examDSC].forEach((d) => expect((result.blocksByDate[d] || []).length).toBe(0));
  });
});

describe("exam pre-pass — rule E: no regular study during the finals stretch", () => {
  it("Tier-2 regular study is suppressed from the eve of the first exam through the last", () => {
    const examA = addDays(TODAY, 8);
    const examB = addDays(TODAY, 12);
    const dateStrs = Array.from({ length: 16 }, (_, i) => addDays(TODAY, i));
    const data = {
      profile: PROFILE,
      courses: [
        { id: 1, name: "MMW", difficulty: 6, weeklyHours: 6 },
        { id: 2, name: "MATH", difficulty: 6, weeklyHours: 6 },
      ],
      assignments: [],
      exams: [
        { id: 904, courseId: 1, date: examA, prepDays: 7, status: "not-started", estimatedHours: 3, weight: 30 },
        { id: 905, courseId: 2, date: examB, prepDays: 7, status: "not-started", estimatedHours: 3, weight: 30 },
      ],
    };
    const result = planHorizon(dateStrs, data, makeGapsFn(), {});
    // Before the stretch: regular study is alive (proves it wasn't killed outright).
    expect(minutesFor(result.blocksByDate[addDays(TODAY, 0)], isRegular)).toBeGreaterThan(0);
    // Inside the stretch (firstExam-1 .. lastExam): none.
    dateStrs.filter((d) => d >= addDays(examA, -1) && d <= examB).forEach((d) => {
      expect(minutesFor(result.blocksByDate[d], isRegular)).toBe(0);
    });
  });
});

describe("exam pre-pass — rule C: the sooner exam claims scarce shared days first", () => {
  it("when two exams compete for the same tight window, the nearer one is fully covered first", () => {
    // Two exams back-to-back with tight 2-day prep windows that overlap on a single shared day,
    // and scarce daily capacity — only the nearer exam can be fully covered from that shared day.
    const examA = addDays(TODAY, 4); // sooner
    const examB = addDays(TODAY, 5); // later
    const dateStrs = Array.from({ length: 8 }, (_, i) => addDays(TODAY, i));
    const gapsFn = makeGapsFn({ dayStart: 540, dayEnd: 720 }); // only 3h free per day
    const itemState = buildItemDemand({
      profile: PROFILE,
      courses: [{ id: 1, name: "A" }, { id: 2, name: "B" }],
      assignments: [],
      exams: [
        { id: 1, courseId: 1, date: examA, prepDays: 2, estimatedHours: 4, weight: 30 },
        { id: 2, courseId: 2, date: examB, prepDays: 2, estimatedHours: 4, weight: 30 },
      ],
    });
    const gapsByDay = {};
    dateStrs.forEach((d) => { gapsByDay[d] = gapsFn(d, []); });
    const plan = buildExamPrepPlan(dateStrs, itemState, gapsByDay);
    const totalFor = (id) => Object.values(plan.byDate).reduce((s, day) => s + (day[id] || 0), 0);
    const demandA = itemState.find((i) => i.id === "e_1").remainingMinutes;
    // The nearer exam (A) gets its full demand; the contention shows up as B's shortfall, not A's.
    expect(totalFor("e_1")).toBe(demandA);
    expect(plan.shortfalls.some((s) => s.id === "e_2")).toBe(true);
    expect(plan.shortfalls.some((s) => s.id === "e_1")).toBe(false);
  });
});

describe("exam pre-pass — rule H: the eve session is labelled 'final review'", () => {
  it("D-1 blocks read 'final review', earlier ones read 'exam prep'", () => {
    const examDate = addDays(TODAY, 7);
    const eve = addDays(TODAY, 6);
    const dateStrs = Array.from({ length: 12 }, (_, i) => addDays(TODAY, i));
    const data = {
      profile: PROFILE,
      courses: [{ id: 1, name: "MMW", difficulty: 6, weeklyHours: 0 }],
      assignments: [],
      exams: [{ id: 906, courseId: 1, date: examDate, prepDays: 7, status: "not-started", estimatedHours: 6, weight: 40 }],
    };
    const result = planHorizon(dateStrs, data, makeGapsFn(), {});
    const eveBlocks = result.blocksByDate[eve] || [];
    expect(eveBlocks.length).toBeGreaterThan(0);
    expect(eveBlocks.every((b) => /final review/.test(b.label))).toBe(true);
    const earlier = result.blocksByDate[addDays(TODAY, 4)] || [];
    expect(earlier.every((b) => !/final review/.test(b.label))).toBe(true);
  });
});
