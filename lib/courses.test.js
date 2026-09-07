import { describe, it, expect } from "vitest";
import { prettyCourseCode, courseNameFor } from "./courses";

describe("prettyCourseCode", () => {
  it("pulls the code out of a full AI title", () => {
    expect(prettyCourseCode("Introduction to Probability (MATH 180A)")).toBe("MATH 180A");
    expect(prettyCourseCode("Exploring the Modern World (MMW 122)")).toBe("MMW 122");
    expect(prettyCourseCode("Principles of Data Science (DSC 10)")).toBe("DSC 10");
  });
  it("is a no-op on names that are already codes", () => {
    expect(prettyCourseCode("MATH 180A")).toBe("MATH 180A");
    expect(prettyCourseCode("DSC 10")).toBe("DSC 10");
    expect(prettyCourseCode("MMW122")).toBe("MMW 122");
  });
  it("handles a leading code with trailing description", () => {
    expect(prettyCourseCode("DSC 10 — Principles of Data Science")).toBe("DSC 10");
    expect(prettyCourseCode("math 20c multivariable")).toBe("MATH 20C");
  });
  it("leaves names with no code pattern untouched", () => {
    expect(prettyCourseCode("Freshman Writing Seminar")).toBe("Freshman Writing Seminar");
    expect(prettyCourseCode("")).toBe("");
    expect(prettyCourseCode(null)).toBe("");
  });
  it("courseNameFor resolves through prettyCourseCode", () => {
    const courses = [{ id: 1, name: "Introduction to Probability (MATH 180A)" }];
    expect(courseNameFor(courses, 1)).toBe("MATH 180A");
    expect(courseNameFor(courses, 99)).toBe("(unknown course)");
  });
});
