import { describe, it, expect } from "vitest";
import { presetLenFor, windowOrderFor } from "./schedule";

describe("presetLenFor", () => {
  // Replaces the old fixed 30/45/60 sessionPreset — now derived from focusMins+breakMins
  // (the same pair the Pomodoro timer uses), rounded to the nearest 15 so placed blocks always
  // land on the scheduling grid.
  it("sums focus+break exactly when the sum is already a multiple of 15", () => {
    expect(presetLenFor({ focusMins: 25, breakMins: 5 })).toBe(30);
    expect(presetLenFor({ focusMins: 40, breakMins: 5 })).toBe(45);
    expect(presetLenFor({ focusMins: 50, breakMins: 10 })).toBe(60);
  });

  it("rounds a non-multiple-of-15 sum to the nearest 15", () => {
    expect(presetLenFor({ focusMins: 20, breakMins: 5 })).toBe(30); // 25 -> nearer 30 than 15
    expect(presetLenFor({ focusMins: 15, breakMins: 5 })).toBe(15); // 20 -> nearer 15 than 30
  });

  it("never goes below a 15-minute floor even for a tiny sum", () => {
    expect(presetLenFor({ focusMins: 5, breakMins: 2 })).toBeGreaterThanOrEqual(15);
  });

  it("falls back to the default 25+5=30 when fields are missing", () => {
    expect(presetLenFor({})).toBe(30);
  });
});

describe("windowOrderFor", () => {
  // energyPeakTime replaces the old morning/afternoon/evening enum — classified here into the
  // same three broad windows dayWindows() uses (before noon / noon-5pm / after 5pm).
  it("puts morning first for a time before noon", () => {
    expect(windowOrderFor("08:00")).toEqual(["morning", "afternoon", "evening"]);
  });

  it("puts afternoon first for a time between noon and 5pm", () => {
    expect(windowOrderFor("14:30")).toEqual(["afternoon", "evening", "morning"]);
  });

  it("puts evening first for a time after 5pm", () => {
    expect(windowOrderFor("20:00")).toEqual(["evening", "afternoon", "morning"]);
  });

  it("treats exactly noon as afternoon and exactly 5pm as evening (boundary-inclusive)", () => {
    expect(windowOrderFor("12:00")[0]).toBe("afternoon");
    expect(windowOrderFor("17:00")[0]).toBe("evening");
  });

  it("falls back to morning-first for a missing or unparseable time", () => {
    expect(windowOrderFor(undefined)).toEqual(["morning", "afternoon", "evening"]);
    expect(windowOrderFor("")).toEqual(["morning", "afternoon", "evening"]);
  });
});
