import { describe, it, expect } from "vitest";
import { briefPeriodStart } from "./time";

describe("briefPeriodStart", () => {
  it("at/after 8am, the period started today", () => {
    expect(briefPeriodStart(new Date(2026, 8, 15, 8, 0))).toBe("2026-09-15");
    expect(briefPeriodStart(new Date(2026, 8, 15, 8, 1))).toBe("2026-09-15");
    expect(briefPeriodStart(new Date(2026, 8, 15, 23, 59))).toBe("2026-09-15");
  });

  it("before 8am, the period started YESTERDAY, not today", () => {
    expect(briefPeriodStart(new Date(2026, 8, 15, 7, 59))).toBe("2026-09-14");
    expect(briefPeriodStart(new Date(2026, 8, 15, 0, 0))).toBe("2026-09-14");
    expect(briefPeriodStart(new Date(2026, 8, 15, 1, 30))).toBe("2026-09-14"); // e.g. up late studying
  });

  it("correctly rolls back across a month boundary", () => {
    expect(briefPeriodStart(new Date(2026, 9, 1, 3, 0))).toBe("2026-09-30");
  });

  it("defaults to the real current time when called with no argument", () => {
    expect(typeof briefPeriodStart()).toBe("string");
    expect(briefPeriodStart()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
