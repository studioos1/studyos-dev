// Exam-prep pre-pass (rules A–H). The pre-pass decides all exam study GLOBALLY before day-by-day
// planning so it can be back-loaded toward each exam and prioritised across exams. Same synthetic
// `gapsByDayFn` contract as planHorizon.test.js — the planner is exercised in isolation.
import { describe, it, expect } from "vitest";
import { planHorizon, buildExamPrepPlan, buildItemDemand } from "./index";

const PROFILE = { wakeTime: "07:00", sleepTime: "23:00", focusMins: 25, breakMins: 5, energyPeakTime: "08:00" };

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

  it("gets two dedicated days normally, and spills onto a third only when demand is large", () => {
    const examDate = addDays(TODAY, 9);
    const dateStrs = Array.from({ length: 14 }, (_, i) => addDays(TODAY, i));
    const mk = (hours) => ({
      profile: PROFILE,
      courses: [{ id: 1, name: "MMW", difficulty: 6, weeklyHours: 0 }],
      assignments: [],
      exams: [{ id: 902, courseId: 1, date: examDate, prepDays: 9, status: "not-started", estimatedHours: hours, weight: 40 }],
    });
    const daysUsed = (data) => {
      const r = planHorizon(dateStrs, data, makeGapsFn(), {});
      return dateStrs.filter((d) => minutesFor(r.blocksByDate[d], isExamPrep) > 0).length;
    };
    expect(daysUsed(mk(6))).toBe(2);              // 6h fits in the eve + lead-in
    expect(daysUsed(mk(20))).toBeGreaterThanOrEqual(3); // 20h can't — spills onto earlier days
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

describe("exam pre-pass — rule A: dedicated single-exam days, sequenced in exam order", () => {
  it("three back-to-back finals — each exam gets an eve + a lead-in, all single-course, in exam order", () => {
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
        { id: 11, courseId: 1, date: examMMW, prepDays: 10, status: "not-started", estimatedHours: 6, weight: 35 },
        { id: 12, courseId: 2, date: examMATH, prepDays: 10, status: "not-started", estimatedHours: 6, weight: 35 },
        { id: 13, courseId: 3, date: examDSC, prepDays: 10, status: "not-started", estimatedHours: 6, weight: 35 },
      ],
    };
    const result = planHorizon(dateStrs, data, makeGapsFn(), {});
    const soleCourseOn = (d) => {
      const ids = new Set((result.blocksByDate[d] || []).filter(isExamPrep).map((b) => b.courseId));
      expect(ids.size).toBe(1); // exactly one course's prep on this day
      return [...ids][0];
    };
    // Each eve is that exam's alone.
    expect(soleCourseOn(addDays(examMMW, -1))).toBe(1);
    expect(soleCourseOn(addDays(examMATH, -1))).toBe(2);
    expect(soleCourseOn(addDays(examDSC, -1))).toBe(3);
    // Each exam also has an earlier lead-in day, and the lead-ins run in exam order
    // (MMW's is earliest, DSC's latest) — never interleaved.
    const leadIn = (courseId) =>
      dateStrs.find((d) => d < addDays(examMMW, -1) &&
        minutesFor(result.blocksByDate[d], (b) => isExamPrep(b) && b.courseId === courseId) > 0);
    const [lMMW, lMATH, lDSC] = [leadIn(1), leadIn(2), leadIn(3)];
    expect(lMMW && lMATH && lDSC).toBeTruthy();
    expect(lMMW < lMATH).toBe(true);
    expect(lMATH < lDSC).toBe(true);
    [lMMW, lMATH, lDSC].forEach((d, i) => expect(soleCourseOn(d)).toBe(i + 1));
    // Nothing at all on the exam days themselves.
    [examMMW, examMATH, examDSC].forEach((d) => expect((result.blocksByDate[d] || []).length).toBe(0));
  });

  it("a lone midterm gets an exclusive eve and a lead-in that still has no regular study", () => {
    const exam = addDays(TODAY, 10);
    const dateStrs = Array.from({ length: 14 }, (_, i) => addDays(TODAY, i));
    const data = {
      profile: PROFILE,
      courses: [
        { id: 1, name: "MMW", difficulty: 6, weeklyHours: 6 },
        { id: 2, name: "DSC", difficulty: 6, weeklyHours: 6 },
      ],
      assignments: [
        { id: 30, courseId: 2, title: "PS5", dueDate: addDays(TODAY, 12), status: "not-started", estimatedHours: 5, weight: 15 },
      ],
      exams: [{ id: 40, courseId: 1, date: exam, prepDays: 7, status: "not-started", estimatedHours: 7, weight: 30 }],
    };
    const result = planHorizon(dateStrs, data, makeGapsFn(), {});
    const eve = result.blocksByDate[addDays(exam, -1)] || [];
    expect(eve.length).toBeGreaterThan(0);
    expect(eve.every(isExamPrep)).toBe(true);                     // eve stays fully exclusive
    [addDays(exam, -1), addDays(exam, -2)].forEach((d) => {
      const blocks = result.blocksByDate[d] || [];
      expect(minutesFor(blocks, (b) => /regular study/.test(b.label))).toBe(0); // no Tier-2 on either
    });
  });

  it("a homework due in the finals run-up still gets time on the lead-in day (not dropped for exam prep)", () => {
    const exam = addDays(TODAY, 13);
    const eveDay = addDays(TODAY, 12);
    const leadInDay = addDays(TODAY, 11);
    const hwDue = addDays(TODAY, 14); // due right after the exam — tight, no slack by the lead-in
    const dateStrs = Array.from({ length: 16 }, (_, i) => addDays(TODAY, i));
    const data = {
      profile: PROFILE,
      courses: [
        { id: 1, name: "MMW", difficulty: 6, weeklyHours: 0 },
        { id: 2, name: "DSC", difficulty: 6, weeklyHours: 0 },
      ],
      assignments: [
        { id: 50, courseId: 2, title: "PS8", dueDate: hwDue, status: "not-started", estimatedHours: 6, weight: 20 },
      ],
      exams: [{ id: 60, courseId: 1, date: exam, prepDays: 7, status: "not-started", estimatedHours: 7, weight: 30 }],
    };
    const result = planHorizon(dateStrs, data, makeGapsFn(), {});
    const leadInBlocks = result.blocksByDate[leadInDay] || [];
    // The lead-in day carries BOTH: this exam's prep and the due homework — the homework isn't
    // dropped just because the day is dedicated to exam prep.
    expect(minutesFor(leadInBlocks, isExamPrep)).toBeGreaterThan(0);
    expect(minutesFor(leadInBlocks, (b) => b.source?.id === 50)).toBeGreaterThan(60);
    // The eve is still exam-only.
    expect((result.blocksByDate[eveDay] || []).every(isExamPrep)).toBe(true);
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

  it("every exam-prep label names the specific exam, not just the course (real report: calendar tooltip should show e.g. 'Quiz1')", () => {
    const examDate = addDays(TODAY, 7);
    const eve = addDays(TODAY, 6);
    const dateStrs = Array.from({ length: 12 }, (_, i) => addDays(TODAY, i));
    const data = {
      profile: PROFILE,
      courses: [{ id: 1, name: "DSC 10", difficulty: 6, weeklyHours: 0 }],
      assignments: [],
      exams: [{ id: 906, courseId: 1, title: "Quiz 1", date: examDate, prepDays: 7, status: "not-started", estimatedHours: 6, weight: 40 }],
    };
    const result = planHorizon(dateStrs, data, makeGapsFn(), {});
    const eveBlocks = result.blocksByDate[eve] || [];
    expect(eveBlocks.length).toBeGreaterThan(0);
    eveBlocks.forEach((b) => expect(b.label).toContain("Quiz 1"));
    const earlier = result.blocksByDate[addDays(TODAY, 4)] || [];
    earlier.filter((b) => /exam prep/.test(b.label)).forEach((b) => expect(b.label).toContain("Quiz 1"));
  });
});

describe("exam pre-pass — back-to-back exams exception", () => {
  // Real, reported case: two exams on consecutive days. Rule F blocks all study on the first
  // exam's own day — which is also exactly the day the second exam's natural eve would have
  // been — so that time goes unused even though the student is free after the first exam and
  // the second exam badly needs it. A narrow post-exam window should be carved out instead.
  it("with no stated exam end time, carves out time from 3pm (the default floor) onward for the next day's exam", () => {
    const day1 = addDays(TODAY, 6), day2 = addDays(TODAY, 7);
    const dateStrs = Array.from({ length: 12 }, (_, i) => addDays(TODAY, i));
    const data = {
      profile: PROFILE,
      courses: [{ id: 1, name: "MATH 180A", difficulty: 6, weeklyHours: 0 }, { id: 2, name: "LIGN 008", difficulty: 5, weeklyHours: 0 }],
      assignments: [],
      exams: [
        { id: 901, courseId: 1, title: "Final Exam", date: day1, prepDays: 7, status: "not-started", estimatedHours: 6, weight: 40 },
        // 14h — large enough that LIGN 008's own eve + lead-in (7h + 3.5h = 10.5h combined) can't
        // absorb it alone, so the test actually exercises the carve-out instead of the ordinary
        // eve/lead-in days quietly finishing the job first.
        { id: 902, courseId: 2, title: "Final Exam", date: day2, prepDays: 7, status: "not-started", estimatedHours: 14, weight: 40 },
      ],
    };
    const result = planHorizon(dateStrs, data, makeGapsFn(), {});
    const day1Blocks = result.blocksByDate[day1] || [];
    // Nothing before 3pm (900 min) — the default cutoff when no end time is known.
    expect(day1Blocks.every((b) => b.s >= 900)).toBe(true);
    // Whatever IS there is the next day's (LIGN 008's) exam prep, never MATH 180A's own (rule F
    // still fully applies to the exam that's actually happening that day).
    expect(day1Blocks.length).toBeGreaterThan(0);
    expect(day1Blocks.every((b) => /LIGN 008/.test(b.label) && /final review/.test(b.label))).toBe(true);
  });

  it("with a stated exam end time, the cutoff is end time + 3h when that's later than 3pm", () => {
    const day1 = addDays(TODAY, 6), day2 = addDays(TODAY, 7);
    const dateStrs = Array.from({ length: 12 }, (_, i) => addDays(TODAY, i));
    const data = {
      profile: PROFILE,
      courses: [{ id: 1, name: "MATH 180A", difficulty: 6, weeklyHours: 0 }, { id: 2, name: "LIGN 008", difficulty: 5, weeklyHours: 0 }],
      assignments: [],
      exams: [
        { id: 901, courseId: 1, title: "Final Exam", date: day1, endTime: "15:00", prepDays: 7, status: "not-started", estimatedHours: 6, weight: 40 },
        { id: 902, courseId: 2, title: "Final Exam", date: day2, prepDays: 7, status: "not-started", estimatedHours: 14, weight: 40 },
      ],
    };
    const result = planHorizon(dateStrs, data, makeGapsFn(), {});
    const day1Blocks = result.blocksByDate[day1] || [];
    // 15:00 (900) + 3h = 18:00 (1080) — later than the 3pm floor, so that's the real cutoff.
    expect(day1Blocks.every((b) => b.s >= 1080)).toBe(true);
    expect(day1Blocks.length).toBeGreaterThan(0);
  });

  it("an exam end time earlier in the day still never allows anything before the 3pm floor", () => {
    const day1 = addDays(TODAY, 6), day2 = addDays(TODAY, 7);
    const dateStrs = Array.from({ length: 12 }, (_, i) => addDays(TODAY, i));
    const data = {
      profile: PROFILE,
      courses: [{ id: 1, name: "MATH 180A", difficulty: 6, weeklyHours: 0 }, { id: 2, name: "LIGN 008", difficulty: 5, weeklyHours: 0 }],
      assignments: [],
      exams: [
        { id: 901, courseId: 1, title: "Final Exam", date: day1, endTime: "09:30", prepDays: 7, status: "not-started", estimatedHours: 6, weight: 40 },
        { id: 902, courseId: 2, title: "Final Exam", date: day2, prepDays: 7, status: "not-started", estimatedHours: 14, weight: 40 },
      ],
    };
    const result = planHorizon(dateStrs, data, makeGapsFn(), {});
    const day1Blocks = result.blocksByDate[day1] || [];
    // 09:30 (570) + 3h = 12:30 (750) — earlier than the 3pm (900) floor, so 3pm wins.
    expect(day1Blocks.every((b) => b.s >= 900)).toBe(true);
    expect(day1Blocks.length).toBeGreaterThan(0);
  });

  it("a non-adjacent exam with modest demand that fits its own eve doesn't touch an earlier exam's post-cutoff day", () => {
    // The carve-out pool now exists on every exam day regardless of distance (see the
    // "post-exam-day pool, generalized" describe block below) — but it's only ever DRAWN from
    // when an exam actually still needs it. Here day2's 6h demand fits entirely on its own eve, so
    // day1 — 4 days earlier, not even adjacent — correctly stays untouched, same end result as
    // before this was generalized, just for a different reason now (no demand reached it, not
    // "no carve-out existed").
    const day1 = addDays(TODAY, 6), day2 = addDays(TODAY, 10);
    const dateStrs = Array.from({ length: 14 }, (_, i) => addDays(TODAY, i));
    const data = {
      profile: PROFILE,
      courses: [{ id: 1, name: "MATH 180A", difficulty: 6, weeklyHours: 0 }, { id: 2, name: "LIGN 008", difficulty: 5, weeklyHours: 0 }],
      assignments: [],
      exams: [
        { id: 901, courseId: 1, title: "Final Exam", date: day1, prepDays: 7, status: "not-started", estimatedHours: 6, weight: 40 },
        { id: 902, courseId: 2, title: "Final Exam", date: day2, prepDays: 7, status: "not-started", estimatedHours: 6, weight: 40 },
      ],
    };
    const result = planHorizon(dateStrs, data, makeGapsFn(), {});
    expect((result.blocksByDate[day1] || []).length).toBe(0);
  });
});

describe("exam pre-pass — post-exam-day pool, generalized beyond literally-adjacent exams", () => {
  // Real, reported case this generalization fixes: a quiz whose every eligible prep day was
  // itself blocked — one its own eve claimed by a DIFFERENT exam, the other an exam day — went
  // short despite hours of genuinely free time sitting on a nearby exam day. The back-to-back
  // version of this pool only opened when the next CALENDAR day also had an exam; this proves it
  // now opens for any exam whose own window reaches that day, however many days apart they are.
  it("an exam 3 days later, with demand too large for its own eve+lead-in, draws from an earlier exam's post-cutoff day", () => {
    const day1 = addDays(TODAY, 6), day2 = addDays(TODAY, 9); // NOT consecutive — a 3-day gap
    const dateStrs = Array.from({ length: 14 }, (_, i) => addDays(TODAY, i));
    const data = {
      profile: PROFILE,
      courses: [{ id: 1, name: "MATH 180A", difficulty: 6, weeklyHours: 0 }, { id: 2, name: "LIGN 008", difficulty: 5, weeklyHours: 0 }],
      assignments: [],
      exams: [
        { id: 901, courseId: 1, title: "Final Exam", date: day1, prepDays: 7, status: "not-started", estimatedHours: 6, weight: 40 },
        // 14h — more than the eve+lead-in combined max (7h+3.5h=10.5h) can ever hold, so this
        // genuinely needs the pool rather than quietly finishing on its own dedicated days first.
        { id: 902, courseId: 2, title: "Final Exam", date: day2, prepDays: 7, status: "not-started", estimatedHours: 14, weight: 40 },
      ],
    };
    const result = planHorizon(dateStrs, data, makeGapsFn(), {});
    const day1Blocks = result.blocksByDate[day1] || [];
    expect(day1Blocks.length).toBeGreaterThan(0);
    expect(day1Blocks.every((b) => b.s >= 900)).toBe(true); // still never before the 3pm floor
    expect(day1Blocks.every((b) => /LIGN 008/.test(b.label))).toBe(true); // exam2's prep, never exam1's own (rule F)
  });
});

describe("exam pre-pass — leftover-sharing on a reserved eve/lead-in day", () => {
  // Real, reported case: two exams whose only eligible prep day collides (one exam's own day is
  // blocked as an exam day, the other already claimed as a different exam's eve) — the exam
  // processed second used to go straight to a full shortfall, even though the first exam left
  // most of that day's capacity unused. Mirrors the real DSC 10 Quiz 1 / LIGN 008 Weekly Quiz #1
  // case exactly: two short-window exams one day apart, each needing the same single day.
  it("an exam that can't claim its own eve still gets covered from another exam's unused leftover capacity", () => {
    const examA = addDays(TODAY, 8); // claims the shared day first (sooner due date)
    const examB = addDays(TODAY, 9); // its only other window day is examA's own due date (blocked)
    const dateStrs = Array.from({ length: 12 }, (_, i) => addDays(TODAY, i));
    const itemState = buildItemDemand({
      profile: PROFILE,
      courses: [{ id: 1, name: "LIGN 008" }, { id: 2, name: "DSC 10" }],
      assignments: [],
      exams: [
        { id: 1, courseId: 1, title: "Weekly Quiz 1", date: examA, prepDays: 2, estimatedHours: 2, weight: 2.5 },
        { id: 2, courseId: 2, title: "Quiz 1", date: examB, prepDays: 2, estimatedHours: 2, weight: 5 },
      ],
    });
    const gapsFn = makeGapsFn(); // a full ordinary day free (13h) — plenty left over after examA's 2h
    const gapsByDay = {};
    dateStrs.forEach((d) => { gapsByDay[d] = gapsFn(d, []); });
    const plan = buildExamPrepPlan(dateStrs, itemState, gapsByDay);
    const totalFor = (id) => Object.values(plan.byDate).reduce((s, day) => s + (day[id] || 0), 0);
    const demandA = itemState.find((i) => i.id === "e_1").remainingMinutes;
    const demandB = itemState.find((i) => i.id === "e_2").remainingMinutes;
    // Neither exam is short — examA keeps everything it needs on the day it claimed, and examB,
    // which never secured a dedicated eve of its own, is fully covered from what examA left over.
    expect(totalFor("e_1")).toBe(demandA);
    expect(totalFor("e_2")).toBe(demandB);
    expect(plan.shortfalls.length).toBe(0);
  });

  it("the borrowing exam never eats into capacity the day's own exam still needs", () => {
    // Same shared-day collision, but examA's OWN demand is big enough to want most of the day —
    // examB should only ever get what's genuinely left over, never cause examA itself to go short.
    const examA = addDays(TODAY, 8);
    const examB = addDays(TODAY, 9);
    const dateStrs = Array.from({ length: 12 }, (_, i) => addDays(TODAY, i));
    const itemState = buildItemDemand({
      profile: PROFILE,
      courses: [{ id: 1, name: "LIGN 008" }, { id: 2, name: "DSC 10" }],
      assignments: [],
      exams: [
        { id: 1, courseId: 1, title: "Midterm", date: examA, prepDays: 2, estimatedHours: 6, weight: 25 },
        { id: 2, courseId: 2, title: "Quiz 1", date: examB, prepDays: 2, estimatedHours: 2, weight: 5 },
      ],
    });
    const gapsFn = makeGapsFn();
    const gapsByDay = {};
    dateStrs.forEach((d) => { gapsByDay[d] = gapsFn(d, []); });
    const plan = buildExamPrepPlan(dateStrs, itemState, gapsByDay);
    const totalFor = (id) => Object.values(plan.byDate).reduce((s, day) => s + (day[id] || 0), 0);
    const demandA = itemState.find((i) => i.id === "e_1").remainingMinutes;
    expect(totalFor("e_1")).toBe(demandA); // examA still gets everything it needs, uncontested
    expect(plan.shortfalls.some((s) => s.id === "e_1")).toBe(false);
  });
});
