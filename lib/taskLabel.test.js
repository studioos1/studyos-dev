import { describe, it, expect } from "vitest";
import { dedupeCourseFromTaskLabel } from "./taskLabel";

describe("dedupeCourseFromTaskLabel", () => {
  // Real label shapes from lib/planner/schedule.js — not made up.
  it("strips a space-separated exam-prep label", () => {
    expect(dedupeCourseFromTaskLabel("MATH 180A exam prep (4d left)", "MATH 180A"))
      .toBe("Exam prep (4d left)");
  });

  it("strips a space-separated final-review label", () => {
    expect(dedupeCourseFromTaskLabel("MATH 180A exam — final review", "MATH 180A"))
      .toBe("Exam — final review");
  });

  it("strips a dash-separated homework label", () => {
    expect(dedupeCourseFromTaskLabel("MATH 180A — Problem Set 5 (due in 11d)", "MATH 180A"))
      .toBe("Problem Set 5 (due in 11d)");
  });

  it("strips a dash-separated project label", () => {
    expect(dedupeCourseFromTaskLabel("DSC 10 — Project 1 (project)", "DSC 10"))
      .toBe("Project 1 (project)");
  });

  it("strips a dash-separated regular-study label", () => {
    expect(dedupeCourseFromTaskLabel("DSC 10 — regular study", "DSC 10"))
      .toBe("Regular study");
  });

  it("matches a parenthetical course-name suffix against the cleaned form", () => {
    expect(dedupeCourseFromTaskLabel("MATH 180A (Prof. Smith) exam prep (4d left)", "MATH 180A (Prof. Smith)"))
      .toBe("Exam prep (4d left)");
  });

  it("leaves the label alone when it doesn't start with the course name", () => {
    const label = "Adhoc: Doctor appointment";
    expect(dedupeCourseFromTaskLabel(label, "MATH 180A")).toBe(label);
  });

  it("leaves the label alone when there's no course", () => {
    const label = "MATH 180A exam prep (4d left)";
    expect(dedupeCourseFromTaskLabel(label, null)).toBe(label);
    expect(dedupeCourseFromTaskLabel(label, "")).toBe(label);
  });

  it("falls back to the original if stripping would leave nothing", () => {
    expect(dedupeCourseFromTaskLabel("MATH 180A", "MATH 180A")).toBe("MATH 180A");
  });

  it("passes through empty/null task unchanged", () => {
    expect(dedupeCourseFromTaskLabel("", "MATH 180A")).toBe("");
    expect(dedupeCourseFromTaskLabel(null, "MATH 180A")).toBe(null);
  });
});
