import { describe, it, expect } from "vitest";
import { estimateDifficulty, estimateStudyHours, computePriorityScore } from "./estimate";
import { difficultyMultiplier, daysFrom } from "./core";

describe("difficultyMultiplier", () => {
  it("is neutral (1.0x) at difficulty 5, and ranges 0.7x-1.3x across 1-10", () => {
    expect(difficultyMultiplier(5)).toBeCloseTo(1.0, 5);
    expect(difficultyMultiplier(1)).toBeCloseTo(0.76, 5);
    expect(difficultyMultiplier(10)).toBeCloseTo(1.3, 5);
    expect(difficultyMultiplier(undefined)).toBeCloseTo(1.0, 5); // unknown -> defaults to 5/Medium
  });
});

describe("estimateDifficulty", () => {
  it("rates a high-weight item in a hard course High, a low-weight item in an easy course Low", async () => {
    const hard = { difficulty: 9 };
    const easy = { difficulty: 2 };
    const highStakes = await estimateDifficulty({ weight: 30 }, hard);
    const lowStakes = await estimateDifficulty({ weight: 2 }, easy);
    expect(highStakes.value).toBe("High");
    expect(lowStakes.value).toBe("Low");
  });
});

describe("estimateStudyHours", () => {
  it("scales with difficulty and weight, rounded to the nearest half-hour", () => {
    const hours = estimateStudyHours({ weight: 15 }, { difficulty: 5 }, "homework");
    expect(hours).toBeGreaterThan(0);
    expect((hours * 2) % 1).toBe(0); // exact multiple of 0.5
  });

  it("gives exams a higher base than homework, all else equal", () => {
    const item = { weight: 15 };
    const course = { difficulty: 5 };
    expect(estimateStudyHours(item, course, "exam")).toBeGreaterThan(
      estimateStudyHours(item, course, "homework")
    );
  });
});

describe("computePriorityScore", () => {
  it("ramps up as the due date approaches", () => {
    const today = "2026-09-04";
    const soon = computePriorityScore("2026-09-06", "Mid", 10, today); // 2 days out
    const far = computePriorityScore("2026-09-20", "Mid", 10, today); // 16 days out
    expect(soon).toBeGreaterThan(far);
  });

  it("returns 0 with no due date", () => {
    expect(computePriorityScore(null, "Mid", 10, "2026-09-04")).toBe(0);
  });
});

describe("daysFrom", () => {
  it("computes whole-day differences", () => {
    expect(daysFrom("2026-09-04", "2026-09-09")).toBe(5);
    expect(daysFrom("2026-09-09", "2026-09-04")).toBe(-5);
    expect(daysFrom("2026-09-04", "2026-09-04")).toBe(0);
  });
});
