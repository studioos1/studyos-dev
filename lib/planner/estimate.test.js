import { describe, it, expect } from "vitest";
import {
  estimateDifficulty,
  estimateStudyHours,
  computePriorityScore,
  computeEstimateFields,
  STUDY_HOURS_BY_RATING,
  expectedHoursRange,
} from "./estimate";
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
    const highStakes = await estimateDifficulty({ weight: 22 }, hard);
    const lowStakes = await estimateDifficulty({ weight: 2 }, easy);
    expect(highStakes.value).toBe("High");
    expect(lowStakes.value).toBe("Low");
  });

  it("rates a very-heavy item in a very-hard course Very High, but a merely-hard one only High", async () => {
    expect((await estimateDifficulty({ weight: 45 }, { difficulty: 10 })).value).toBe("Very High");
    expect((await estimateDifficulty({ weight: 20 }, { difficulty: 8 })).value).toBe("High");
  });
});

describe("estimateStudyHours", () => {
  const course = { difficulty: 5 };
  const neutral = { weight: 15 }; // ~neutral weight nudge (×1.0)

  it("rounds to the nearest half-hour", () => {
    const hours = estimateStudyHours({ weight: 15 }, course, "homework", "Mid");
    expect(hours).toBeGreaterThan(0);
    expect((hours * 2) % 1).toBe(0);
  });

  it("rises monotonically across the difficulty bands", () => {
    const h = (r) => estimateStudyHours(neutral, course, "homework", r);
    expect(h("Low")).toBeLessThan(h("Mid"));
    expect(h("Mid")).toBeLessThan(h("High"));
    expect(h("High")).toBeLessThan(h("Very High"));
  });

  it("moves the suggestion when the rating changes (the reported bug)", () => {
    const mid = estimateStudyHours(neutral, course, "exam", "Mid");
    const high = estimateStudyHours(neutral, course, "exam", "High");
    expect(high).toBeGreaterThan(mid); // Mid→High must change hours, not keep them
  });

  it("at neutral weight, returns the band's table value exactly", () => {
    expect(estimateStudyHours(neutral, course, "exam", "High")).toBe(STUDY_HOURS_BY_RATING.exam.High);
    expect(estimateStudyHours(neutral, course, "homework", "Low")).toBe(STUDY_HOURS_BY_RATING.homework.Low);
  });

  it("gives exams more hours than homework at the same band", () => {
    expect(estimateStudyHours(neutral, course, "exam", "Mid")).toBeGreaterThan(
      estimateStudyHours(neutral, course, "homework", "Mid")
    );
  });

  it("weight nudges the suggestion but stays within ±30% of the band value", () => {
    const base = STUDY_HOURS_BY_RATING.exam.Mid;
    const heavy = estimateStudyHours({ weight: 50 }, course, "exam", "Mid");
    const light = estimateStudyHours({ weight: 1 }, course, "exam", "Mid");
    expect(heavy).toBeGreaterThan(base);
    expect(light).toBeLessThan(base);
    expect(heavy).toBeLessThanOrEqual(base * 1.3);
    expect(light).toBeGreaterThanOrEqual(base * 0.7);
  });

  it("falls back to the Mid band when no rating is given", () => {
    expect(estimateStudyHours(neutral, course, "homework")).toBe(
      estimateStudyHours(neutral, course, "homework", "Mid")
    );
  });
});

describe("computeEstimateFields", () => {
  it("packages a rating and an hours suggestion that agrees with that rating", async () => {
    const course = { difficulty: 8 };
    const f = await computeEstimateFields({ weight: 30 }, course, "exam");
    expect(["Low", "Mid", "High", "Very High"]).toContain(f.estimatorValue);
    expect(f.aiHours).toBe(estimateStudyHours({ weight: 30 }, course, "exam", f.estimatorValue));
    expect(f.userValue).toBeNull();
    expect(f.userHours).toBeNull();
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

describe("expectedHoursRange", () => {
  it("returns the wider range as difficulty score climbs through each band", () => {
    expect(expectedHoursRange(2)).toEqual([1, 5]);   // Light
    expect(expectedHoursRange(5)).toEqual([3, 8]);   // Medium
    expect(expectedHoursRange(7)).toEqual([5, 12]);  // Heavy
    expect(expectedHoursRange(10)).toEqual([8, 18]); // Intense
  });

  it("is monotonic at every band boundary (3/4, 6/7, 8/9)", () => {
    expect(expectedHoursRange(3)).toEqual([1, 5]);
    expect(expectedHoursRange(4)).toEqual([3, 8]);
    expect(expectedHoursRange(6)).toEqual([3, 8]);
    expect(expectedHoursRange(8)).toEqual([5, 12]);
    expect(expectedHoursRange(9)).toEqual([8, 18]);
  });

  it("falls back to the top band for an out-of-range score instead of throwing", () => {
    expect(expectedHoursRange(11)).toEqual([8, 18]);
  });
});
