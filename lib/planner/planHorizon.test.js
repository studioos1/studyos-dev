// Regression tests for the exact behaviors the CHANGELOG describes fixing/validating when the
// Phase 2 planner was built (v2.22.0-v2.22.2) — ported into real assertions per roadmap step A6,
// so they can no longer silently regress. Each `gapsByDayFn` here is a synthetic stand-in for the
// real `freeSlots()` (which lives in components/App.jsx and depends on the UI-coupled
// `buildBlocks()`) — it fulfils the exact same contract `planHorizon` expects
// (`(dateStr, userEditedBlocks) => [{s,e}, ...]`), so the planner is tested in isolation from the
// rest of the app.
import { describe, it, expect } from "vitest";
import { planHorizon } from "./index";

const PROFILE = { wakeTime: "07:00", sleepTime: "23:00", sessionPreset: 30, energyPeak: "morning" };

function addDays(dateStr, n) {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + n);
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// A generous 9am-10pm daily window, carving out any pre-existing (userEdited) blocks the same
// way the real freeSlots() would — so overlap tests are meaningful, not just structurally trivial.
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

function minutesFor(dayBlocks, predicate) {
  return (dayBlocks || []).filter(predicate).reduce((s, b) => s + (b.e - b.s), 0);
}

const TODAY = "2026-09-04";

describe("planHorizon — priority completion", () => {
  it("two competing items across a wide horizon both fully complete with zero shortfall", () => {
    const dateStrs = Array.from({ length: 14 }, (_, i) => addDays(TODAY, i));
    const data = {
      profile: PROFILE,
      courses: [
        { id: 1, name: "Course A", difficulty: 5, weeklyHours: 4 },
        { id: 2, name: "Course B", difficulty: 5, weeklyHours: 4 },
      ],
      assignments: [
        { id: 101, courseId: 1, title: "PS1", dueDate: addDays(TODAY, 6), status: "not-started", estimatedHours: 3, weight: 10 },
        { id: 102, courseId: 2, title: "PS2", dueDate: addDays(TODAY, 8), status: "not-started", estimatedHours: 3, weight: 10 },
      ],
      exams: [],
    };
    const result = planHorizon(dateStrs, data, makeGapsFn(), {});
    expect(result.shortfalls).toHaveLength(0);
    const a1 = Object.values(result.blocksByDate).reduce((s, d) => s + minutesFor(d, (b) => b.source?.id === 101), 0);
    const a2 = Object.values(result.blocksByDate).reduce((s, d) => s + minutesFor(d, (b) => b.source?.id === 102), 0);
    expect(a1).toBe(180);
    expect(a2).toBe(180);
  });
});

describe("planHorizon — 15-minute grid alignment", () => {
  it("every placed block starts and ends on the :00/:15/:30/:45 grid", () => {
    const dateStrs = Array.from({ length: 10 }, (_, i) => addDays(TODAY, i));
    const data = {
      profile: PROFILE,
      courses: [{ id: 1, name: "Course A", difficulty: 7, weeklyHours: 5 }],
      assignments: [
        { id: 201, courseId: 1, title: "PS1", dueDate: addDays(TODAY, 4), status: "not-started", estimatedHours: 2.5, weight: 15 },
      ],
      exams: [{ id: 301, courseId: 1, date: addDays(TODAY, 9), prepDays: 7, status: "not-started", estimatedHours: 3, weight: 25 }],
    };
    const result = planHorizon(dateStrs, data, makeGapsFn(), {});
    const allBlocks = Object.values(result.blocksByDate).flat();
    expect(allBlocks.length).toBeGreaterThan(0);
    allBlocks.forEach((b) => {
      expect(b.s % 15).toBe(0);
      expect(b.e % 15).toBe(0);
    });
  });
});

describe("planHorizon — zero overlaps", () => {
  it("never overlaps blocks within a day, and routes around a pre-existing user-edited block", () => {
    const dateStrs = Array.from({ length: 7 }, (_, i) => addDays(TODAY, i));
    const userBlock = { id: "u1", s: 600, e: 660, userEdited: true, kind: "personal", label: "Gym" };
    const userEditedByDate = { [addDays(TODAY, 2)]: [userBlock] };
    const data = {
      profile: PROFILE,
      courses: [{ id: 1, name: "Course A", difficulty: 5, weeklyHours: 6 }],
      assignments: [
        { id: 401, courseId: 1, title: "PS1", dueDate: addDays(TODAY, 5), status: "not-started", estimatedHours: 4, weight: 10 },
      ],
      exams: [],
    };
    const result = planHorizon(dateStrs, data, makeGapsFn(), userEditedByDate);
    Object.values(result.blocksByDate).forEach((dayBlocks) => {
      const sorted = [...dayBlocks].sort((a, b) => a.s - b.s);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].s).toBeGreaterThanOrEqual(sorted[i - 1].e);
      }
    });
    const day2 = result.blocksByDate[addDays(TODAY, 2)];
    expect(day2.some((b) => b.id === "u1" && b.s === 600 && b.e === 660)).toBe(true);
  });
});

describe("planHorizon — 1-day due-date buffer", () => {
  it("never places study time on the due date itself", () => {
    const dueDate = addDays(TODAY, 3);
    const dateStrs = Array.from({ length: 5 }, (_, i) => addDays(TODAY, i)); // includes the due date
    const data = {
      profile: PROFILE,
      courses: [{ id: 1, name: "Course A", difficulty: 5, weeklyHours: 4 }],
      assignments: [
        { id: 501, courseId: 1, title: "PS1", dueDate, status: "not-started", estimatedHours: 2, weight: 10 },
      ],
      exams: [],
    };
    const result = planHorizon(dateStrs, data, makeGapsFn(), {});
    const dueDay = result.blocksByDate[dueDate] || [];
    expect(dueDay.some((b) => b.source?.id === 501)).toBe(false);
  });
});

describe("planHorizon — due-2 slack deferral", () => {
  it("a solo item with zero competition lands on the due-2 target, not day 0", () => {
    // Matches the exact CHANGELOG v2.22.2 case: a solo 90-min homework item due in 5 days,
    // no competition — previously landed entirely on day 0, now lands entirely on day 3.
    const dueDate = addDays(TODAY, 5);
    const dateStrs = Array.from({ length: 6 }, (_, i) => addDays(TODAY, i));
    const dueMinus2 = addDays(TODAY, 3);
    const data = {
      profile: PROFILE,
      courses: [{ id: 1, name: "Course A", difficulty: 5, weeklyHours: 0 }],
      assignments: [
        { id: 601, courseId: 1, title: "PS1", dueDate, status: "not-started", estimatedHours: 1.5, weight: 10 }, // 90 min
      ],
      exams: [],
    };
    const result = planHorizon(dateStrs, data, makeGapsFn(), {});
    dateStrs.forEach((d) => {
      const mins = minutesFor(result.blocksByDate[d], (b) => b.source?.id === 601);
      expect(mins).toBe(d === dueMinus2 ? 90 : 0);
    });
  });
});

describe("planHorizon — start-window enforcement", () => {
  it("nothing is scheduled before an item's start window opens, but it still fully completes within it", () => {
    const hwDue = addDays(TODAY, 10); // homework: fixed 5-day window
    const examDate = addDays(TODAY, 20); // exam: its own prepDays window
    const dateStrs = Array.from({ length: 21 }, (_, i) => addDays(TODAY, i));
    const data = {
      profile: PROFILE,
      courses: [{ id: 1, name: "Course A", difficulty: 5, weeklyHours: 0 }],
      assignments: [
        { id: 701, courseId: 1, title: "Term paper", dueDate: hwDue, status: "not-started", estimatedHours: 3, weight: 10 },
      ],
      exams: [
        { id: 801, courseId: 1, date: examDate, prepDays: 7, status: "not-started", estimatedHours: 2, weight: 20 },
      ],
    };
    const result = planHorizon(dateStrs, data, makeGapsFn(), {});

    const hwWindowOpen = addDays(hwDue, -5);
    dateStrs.filter((d) => d < hwWindowOpen).forEach((d) => {
      expect(minutesFor(result.blocksByDate[d], (b) => b.source?.id === 701)).toBe(0);
    });

    const examWindowOpen = addDays(examDate, -7);
    dateStrs.filter((d) => d < examWindowOpen).forEach((d) => {
      expect(minutesFor(result.blocksByDate[d], (b) => b.source?.id === 801)).toBe(0);
    });

    // The window isn't a black hole — both still complete somewhere within it.
    expect(result.shortfalls).toHaveLength(0);
  });
});

describe("planHorizon — no regular study after a course's last deadline", () => {
  const regularMinutes = (result, d) =>
    minutesFor(result.blocksByDate[d], (b) => /regular study/.test(b.label || ""));

  it("Tier 2 regular study stops on and after the course's final exam date", () => {
    const examDate = addDays(TODAY, 8);
    const dateStrs = Array.from({ length: 20 }, (_, i) => addDays(TODAY, i));
    const data = {
      profile: PROFILE,
      courses: [{ id: 1, name: "Course A", difficulty: 5, weeklyHours: 6 }],
      assignments: [],
      exams: [{ id: 900, courseId: 1, date: examDate, prepDays: 7, status: "not-started", estimatedHours: 3, weight: 30 }],
    };
    const result = planHorizon(dateStrs, data, makeGapsFn(), {});

    // Day 0 is before the exam's prep window opens, so Tier 1 isn't active — Tier 2 still fills
    // the leftover time. (Proves the guard didn't just kill Tier 2 outright.)
    expect(regularMinutes(result, addDays(TODAY, 0))).toBeGreaterThan(0);

    // On and after the exam date, the course has no demand — nothing regular gets placed.
    dateStrs.filter((d) => d >= examDate).forEach((d) => {
      expect(regularMinutes(result, d)).toBe(0);
    });
  });

  it("a course with no dated items still gets regular study across the whole horizon", () => {
    const dateStrs = Array.from({ length: 10 }, (_, i) => addDays(TODAY, i));
    const data = {
      profile: PROFILE,
      courses: [{ id: 1, name: "Course A", difficulty: 5, weeklyHours: 6 }],
      assignments: [],
      exams: [],
    };
    const result = planHorizon(dateStrs, data, makeGapsFn(), {});
    dateStrs.forEach((d) => {
      expect(regularMinutes(result, d)).toBeGreaterThan(0);
    });
  });
});

describe("planHorizon — forced items", () => {
  it("a forced item schedules from today and completes even outside its normal start window", () => {
    const dueDate = addDays(TODAY, 20); // homework's normal window is due-5, so days 0–14 are normally off-limits
    const dateStrs = Array.from({ length: 21 }, (_, i) => addDays(TODAY, i));
    const data = {
      profile: PROFILE,
      courses: [{ id: 1, name: "Course A", difficulty: 5, weeklyHours: 0 }],
      assignments: [
        { id: 1001, courseId: 1, title: "Big paper", dueDate, status: "not-started", estimatedHours: 4, weight: 10, forced: true },
      ],
      exams: [],
    };
    const result = planHorizon(dateStrs, data, makeGapsFn(), {});
    expect(result.shortfalls).toHaveLength(0);
    const windowOpen = addDays(dueDate, -5);
    const earlyMins = dateStrs.filter((d) => d < windowOpen)
      .reduce((s, d) => s + minutesFor(result.blocksByDate[d], (b) => b.source?.id === 1001), 0);
    expect(earlyMins).toBeGreaterThan(0); // proves `forced` overrides the start-window that the enforcement test relies on
  });
});
