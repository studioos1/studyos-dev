import { describe, it, expect } from "vitest";
import { repairTermLinkageIfNeeded } from "./terms";

// Term end far in the future so it always computes as "current" regardless of when the test runs.
const FUTURE = "2099-06-01";
const mk = (over = {}) => ({
  profile: { termStart: "2026-08-22", termEnd: FUTURE, schoolName: "u" },
  schools: [{ id: "sch1", name: "u" }],
  terms: [{ id: "term1", schoolId: "sch1", name: "Fall", start: "2026-08-22", end: FUTURE }],
  courses: [{ id: "c1", name: "MATH 180A", termId: "term1" }],
  assignments: [], exams: [],
  ...over,
});

describe("repairTermLinkageIfNeeded", () => {
  it("no-op when the term has dates and every course is linked", () => {
    expect(repairTermLinkageIfNeeded(mk())).toBeNull();
  });

  it("links orphan courses (termId null) to the current term", () => {
    const fix = repairTermLinkageIfNeeded(mk({
      courses: [{ id: "c1", name: "MATH 180A", termId: null }, { id: "c2", name: "DSC 10" }],
    }));
    expect(fix.courses.every(c => c.termId === "term1")).toBe(true);
    expect(fix.terms).toBeUndefined(); // dates were fine
  });

  it("fills a dateless term from the profile, then links courses", () => {
    const fix = repairTermLinkageIfNeeded(mk({
      terms: [{ id: "term1", schoolId: "sch1", name: "Current term", start: "", end: "" }],
      courses: [{ id: "c1", name: "MATH 180A", termId: null }],
    }));
    expect(fix.terms[0].start).toBe("2026-08-22");
    expect(fix.terms[0].end).toBe(FUTURE);
    expect(fix.courses[0].termId).toBe("term1");
  });

  it("relinks a course pointing at a term that no longer exists", () => {
    const fix = repairTermLinkageIfNeeded(mk({
      courses: [{ id: "c1", name: "MATH 180A", termId: "term_deleted" }],
    }));
    expect(fix.courses[0].termId).toBe("term1");
  });

  it("returns null when there are no terms to link to", () => {
    expect(repairTermLinkageIfNeeded(mk({ terms: [] }))).toBeNull();
  });
});
