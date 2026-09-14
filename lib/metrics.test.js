import { describe, it, expect } from "vitest";
import { assignmentOnTimeScore, ONTIME_EARLY_BONUS_PER_DAY, ONTIME_EARLY_BONUS_CAP_DAYS, ONTIME_LATE_PENALTY_PER_DAY } from "./metrics";

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
