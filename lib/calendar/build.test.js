// buildBlocks' exam rendering — no test coverage existed for this at all before the bug fixed
// here: a real, reported case (a student correctly noticed their calendar showed "8:30-11:00am"
// for a final exam their own syllabus states is 3:00-6:00 PM) traced to a hardcoded 540/660
// (9:00-11:00am) used for EVERY exam, unconditionally, regardless of any real time captured.
import { describe, it, expect } from "vitest";
import { buildBlocks } from "./build";

const PROFILE = { wakeTime: "07:00", sleepTime: "23:00" };
const DATE = "2026-12-08";

function baseData(examOverrides = {}, assignmentOverrides = null) {
  return {
    profile: PROFILE,
    courses: [{ id: 1, name: "MATH 180A", days: [], startTime: "09:00", endTime: "10:30" }],
    assignments: assignmentOverrides ? [{ id: 800, courseId: 1, dueDate: DATE, title: "Problem Set 1", status: "not-started", ...assignmentOverrides }] : [],
    exams: [{ id: 900, courseId: 1, date: DATE, title: "Final Exam", ...examOverrides }],
  };
}
const examBlock = (blocks) => blocks.find((b) => b.type === "exam");
const deadlineBlock = (blocks) => blocks.find((b) => b.type === "deadline");

describe("buildBlocks — exam time", () => {
  it("uses the exam's real startTime/endTime when the syllabus stated both", () => {
    const data = baseData({ startTime: "15:00", endTime: "18:00" });
    const b = examBlock(buildBlocks(DATE, data, []));
    expect(b.s).toBe(900); // 15:00
    expect(b.e).toBe(1080); // 18:00
  });

  it("falls back to the 9:00-11:00am placeholder when no exam time is stated", () => {
    const data = baseData({});
    const b = examBlock(buildBlocks(DATE, data, []));
    expect(b.s).toBe(540);
    expect(b.e).toBe(660);
  });

  it("falls back to the placeholder when only ONE of startTime/endTime is present", () => {
    const data = baseData({ endTime: "18:00" }); // no startTime
    const b = examBlock(buildBlocks(DATE, data, []));
    expect(b.s).toBe(540);
    expect(b.e).toBe(660);
  });

  it("falls back to the placeholder when the stated times are reversed/invalid (end <= start)", () => {
    const data = baseData({ startTime: "18:00", endTime: "15:00" });
    const b = examBlock(buildBlocks(DATE, data, []));
    expect(b.s).toBe(540);
    expect(b.e).toBe(660);
  });

  it("the exam block is included in the protected/busy zone at its real time (nothing else gets scheduled over it)", () => {
    const data = baseData({ startTime: "15:00", endTime: "18:00" });
    const blocks = buildBlocks(DATE, data, []);
    // Meals resolveConflict against the fixed academic zone — none should land inside 15:00-18:00.
    const overlapping = blocks.filter((b) => b.type !== "exam" && b.s < 1080 && b.e > 900);
    expect(overlapping.length).toBe(0);
  });

  // timeAssumed — the marker the calendar UI (WeekGrid/Timeline/DayAgenda) uses to visually flag
  // a placeholder time as a guess, not a fact — and that App.jsx's header badge counts until the
  // student fills in the real time. Real request: "we should use the REAL time... if not exist -
  // place it on calendar with assumption and mark it for user to notice."
  it("flags timeAssumed:true on the exam block when no real time is stated", () => {
    const b = examBlock(buildBlocks(DATE, baseData({}), []));
    expect(b.timeAssumed).toBe(true);
  });

  it("flags timeAssumed:false on the exam block when a real time is stated", () => {
    const b = examBlock(buildBlocks(DATE, baseData({ startTime: "15:00", endTime: "18:00" }), []));
    expect(b.timeAssumed).toBe(false);
  });
});

describe("buildBlocks — assignment due time", () => {
  it("uses the assignment's real dueTime when the syllabus stated one", () => {
    const data = baseData({}, { dueTime: "17:00" });
    const b = deadlineBlock(buildBlocks(DATE, data, []));
    expect(b.dueMin).toBe(1020); // 17:00
    expect(b.timeAssumed).toBe(false);
  });

  it("falls back to the 11:59pm placeholder and flags timeAssumed when no dueTime is stated", () => {
    const data = baseData({}, {});
    const b = deadlineBlock(buildBlocks(DATE, data, []));
    expect(b.dueMin).toBe(1439);
    expect(b.timeAssumed).toBe(true);
  });
});
