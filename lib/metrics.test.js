import { describe, it, expect } from "vitest";
import { assignmentOnTimeScore, splitOnTimeScore, computeStudyPace, computeOnTimeRaw, ONTIME_EARLY_BONUS_PER_DAY, ONTIME_EARLY_BONUS_CAP_DAYS, ONTIME_LATE_PENALTY_PER_DAY } from "./metrics";

describe("assignmentOnTimeScore", () => {
  it("on time (diffDays 0) scores exactly 100", () => {
    expect(assignmentOnTimeScore(0)).toBe(100);
  });

  it("early gives a bonus above 100, growing per day", () => {
    expect(assignmentOnTimeScore(1)).toBe(100 + ONTIME_EARLY_BONUS_PER_DAY);
    expect(assignmentOnTimeScore(3)).toBe(100 + 3 * ONTIME_EARLY_BONUS_PER_DAY);
  });

  it("early bonus stops growing past the cap", () => {
    const atCap = assignmentOnTimeScore(ONTIME_EARLY_BONUS_CAP_DAYS);
    const wayPastCap = assignmentOnTimeScore(ONTIME_EARLY_BONUS_CAP_DAYS + 50);
    expect(wayPastCap).toBe(atCap); // 50 days early is no better than exactly at the cap
  });

  it("late gives back partial credit, shrinking per day", () => {
    expect(assignmentOnTimeScore(-1)).toBe(100 - ONTIME_LATE_PENALTY_PER_DAY);
    expect(assignmentOnTimeScore(-3)).toBe(100 - 3 * ONTIME_LATE_PENALTY_PER_DAY);
  });

  it("floors at 0 rather than going negative", () => {
    expect(assignmentOnTimeScore(-50)).toBe(0);
  });

  it("is monotonically non-increasing as diffDays decreases (later is never better)", () => {
    for (let d = 10; d > -15; d--) {
      expect(assignmentOnTimeScore(d - 1)).toBeLessThanOrEqual(assignmentOnTimeScore(d));
    }
  });
});

describe("splitOnTimeScore", () => {
  it("passes null through untouched", () => {
    expect(splitOnTimeScore(null)).toEqual({ pct: null, bonus: 0 });
  });

  it("at or below 100 has no bonus, pct unchanged", () => {
    expect(splitOnTimeScore(100)).toEqual({ pct: 100, bonus: 0 });
    expect(splitOnTimeScore(72)).toEqual({ pct: 72, bonus: 0 });
    expect(splitOnTimeScore(0)).toEqual({ pct: 0, bonus: 0 });
  });

  it("above 100 caps pct at 100 and carries the excess as bonus", () => {
    expect(splitOnTimeScore(112)).toEqual({ pct: 100, bonus: 12 });
  });

  it("pct + bonus always reconstructs the raw value when raw >= 0", () => {
    [0, 50, 100, 101, 130, 150].forEach((raw) => {
      const { pct, bonus } = splitOnTimeScore(raw);
      expect(pct + bonus).toBe(raw);
    });
  });
});

describe("computeStudyPace", () => {
  it("computes % of planned minutes marked completed, within range", () => {
    const weeks = { w1: { days: {
      "2026-01-05": [{ s: 540, e: 600, completed: true }],   // 60 done
      "2026-01-06": [{ s: 540, e: 600, completed: false }],  // 60 not done
    } } };
    expect(computeStudyPace(weeks, "2026-01-01", "2026-01-10")).toBe(50);
  });

  it("excludes days before termStart and after today", () => {
    const weeks = { w1: { days: {
      "2025-12-31": [{ s: 0, e: 600, completed: false }], // before termStart
      "2026-01-05": [{ s: 540, e: 600, completed: true }], // in range, fully done
      "2026-01-15": [{ s: 0, e: 600, completed: false }], // after today
    } } };
    expect(computeStudyPace(weeks, "2026-01-01", "2026-01-10")).toBe(100);
  });

  it("includes termStart and today themselves — an inclusive range on both ends", () => {
    const startOnly = { w1: { days: { "2026-01-01": [{ s: 0, e: 60, completed: true }] } } };
    expect(computeStudyPace(startOnly, "2026-01-01", "2026-01-10")).toBe(100);
    const todayOnly = { w1: { days: { "2026-01-10": [{ s: 0, e: 60, completed: true }] } } };
    expect(computeStudyPace(todayOnly, "2026-01-01", "2026-01-10")).toBe(100);
  });

  it("returns null (not 0) when there's no term start yet", () => {
    expect(computeStudyPace({}, null, "2026-01-10")).toBeNull();
    expect(computeStudyPace({}, undefined, "2026-01-10")).toBeNull();
  });

  it("returns null when the term hasn't started yet", () => {
    expect(computeStudyPace({}, "2026-02-01", "2026-01-10")).toBeNull();
  });

  it("returns null (not 0) when nothing has been planned in range yet", () => {
    expect(computeStudyPace({}, "2026-01-01", "2026-01-10")).toBeNull();
    const allOutsideRange = { w1: { days: { "2025-12-01": [{ s: 0, e: 60, completed: true }] } } };
    expect(computeStudyPace(allOutsideRange, "2026-01-01", "2026-01-10")).toBeNull();
  });

  it("rounds to the nearest integer percent", () => {
    const weeks = { w1: { days: {
      "2026-01-05": [{ s: 0, e: 30, completed: true }, { s: 0, e: 60, completed: false }], // 30 of 90 = 33.33%
    } } };
    expect(computeStudyPace(weeks, "2026-01-01", "2026-01-10")).toBe(33);
  });
});

describe("computeOnTimeRaw", () => {
  it("scores an assignment done exactly on its due date as 100", () => {
    const assignments = [{ dueDate: "2026-01-05", status: "done", completedAt: "2026-01-05T10:00:00.000Z" }];
    expect(computeOnTimeRaw(assignments, "2026-01-01", "2026-01-10")).toBe(100);
  });

  it("gives a bonus for completing early", () => {
    const assignments = [{ dueDate: "2026-01-05", status: "done", completedAt: "2026-01-03T10:00:00.000Z" }]; // 2 days early
    expect(computeOnTimeRaw(assignments, "2026-01-01", "2026-01-10")).toBe(100 + 2 * ONTIME_EARLY_BONUS_PER_DAY);
  });

  it("gives shrinking partial credit for a late completion", () => {
    const assignments = [{ dueDate: "2026-01-05", status: "done", completedAt: "2026-01-07T10:00:00.000Z" }]; // 2 days late
    expect(computeOnTimeRaw(assignments, "2026-01-01", "2026-01-10")).toBe(100 - 2 * ONTIME_LATE_PENALTY_PER_DAY);
  });

  it("scores a still-open, already-due item against TODAY, not its own due date — keeps shrinking until it's done", () => {
    const assignments = [{ dueDate: "2026-01-05", status: "open" }];
    expect(computeOnTimeRaw(assignments, "2026-01-01", "2026-01-08")).toBe(100 - 3 * ONTIME_LATE_PENALTY_PER_DAY); // 3 days overdue as of today
  });

  it("excludes a still-open assignment whose due date hasn't arrived yet", () => {
    const assignments = [{ dueDate: "2026-01-20", status: "open" }];
    expect(computeOnTimeRaw(assignments, "2026-01-01", "2026-01-10")).toBeNull();
  });

  it("includes an assignment completed early even though its due date hasn't arrived yet — that's exactly what 'early' means", () => {
    const assignments = [{ dueDate: "2026-01-20", status: "done", completedAt: "2026-01-05T00:00:00.000Z" }];
    expect(computeOnTimeRaw(assignments, "2026-01-01", "2026-01-10")).toBeGreaterThan(100);
  });

  it("excludes an assignment due before the term started", () => {
    const assignments = [{ dueDate: "2025-12-15", status: "done", completedAt: "2025-12-15T00:00:00.000Z" }];
    expect(computeOnTimeRaw(assignments, "2026-01-01", "2026-01-10")).toBeNull();
  });

  it("defaults a done item with no completedAt to exactly on time — never penalized retroactively for data that predates that field", () => {
    const assignments = [{ dueDate: "2026-01-05", status: "done" }];
    expect(computeOnTimeRaw(assignments, "2026-01-01", "2026-01-10")).toBe(100);
  });

  it("averages the score across multiple assignments", () => {
    const assignments = [
      { dueDate: "2026-01-05", status: "done", completedAt: "2026-01-05T00:00:00.000Z" }, // 100
      { dueDate: "2026-01-06", status: "done", completedAt: "2026-01-08T00:00:00.000Z" }, // 2 days late: 80
    ];
    expect(computeOnTimeRaw(assignments, "2026-01-01", "2026-01-10")).toBe(90);
  });

  it("returns null (not 0) when there's no term start, or nothing to score yet", () => {
    expect(computeOnTimeRaw([{ dueDate: "2026-01-05", status: "done" }], null, "2026-01-10")).toBeNull();
    expect(computeOnTimeRaw([], "2026-01-01", "2026-01-10")).toBeNull();
    expect(computeOnTimeRaw(undefined, "2026-01-01", "2026-01-10")).toBeNull();
  });

  it("excludes an assignment with no due date at all", () => {
    expect(computeOnTimeRaw([{ status: "open" }], "2026-01-01", "2026-01-10")).toBeNull();
  });
});
