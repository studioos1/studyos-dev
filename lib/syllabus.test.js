import { describe, it, expect } from "vitest";
import {
  reclassifyMisplacedQuizzes,
  checkScheduleExtraction,
  checkSyllabusExtraction,
  coreNorm,
  findProbableDuplicate,
} from "./syllabus";

const levels = r => r.issues.map(i => i.level);
const msgs = r => r.issues.map(i => i.msg).join(" | ");

describe("checkScheduleExtraction", () => {
  const goodCourse = {
    name: "Probability", code: "MATH 180A", days: [1, 3, 5],
    startTime: "09:00", endTime: "09:50", format: "in-person",
  };

  it("no issues on a clean parse", () => {
    expect(checkScheduleExtraction({ courses: [goodCourse] }).issues).toEqual([]);
  });

  it("errors when nothing was extracted", () => {
    expect(levels(checkScheduleExtraction({ courses: [] }))).toContain("error");
    expect(levels(checkScheduleExtraction({}))).toContain("error");
  });

  it("errors on a course with no recognizable code (a misread heading)", () => {
    const r = checkScheduleExtraction({ courses: [{ name: "Week 1 — Course Introduction and Logistics", days: [1] }] });
    expect(levels(r)).toContain("error");
  });

  it("warns on reversed / unreadable class times", () => {
    const r = checkScheduleExtraction({ courses: [{ ...goodCourse, startTime: "11:00", endTime: "10:00" }] });
    expect(msgs(r)).toMatch(/ends before it starts/);
  });

  it("warns on missing class days for a non-async course", () => {
    const r = checkScheduleExtraction({ courses: [{ ...goodCourse, days: [] }] });
    expect(msgs(r)).toMatch(/no valid class days/);
  });

  it("does not flag an async course for missing days/times", () => {
    const r = checkScheduleExtraction({ courses: [{ name: "Self-paced", code: "CSE 11", days: [], format: "async" }] });
    expect(r.issues).toEqual([]);
  });

  it("warns on a duplicated course code", () => {
    const r = checkScheduleExtraction({ courses: [goodCourse, { ...goodCourse, days: [2] }] });
    expect(msgs(r)).toMatch(/share the code MATH180A/);
  });
});

describe("checkSyllabusExtraction", () => {
  const term = { termStart: "2026-09-25", termEnd: "2026-12-12" };
  const okCourse = {
    courseName: "DSC 10",
    assignments: [{ title: "PS1", dueDate: "2026-10-02", weight: 5 }],
    exams: [{ title: "Final", date: "2026-12-09", weight: 30 }],
  };

  it("no issues on a clean parse", () => {
    expect(checkSyllabusExtraction({ courses: [okCourse] }, term).issues).toEqual([]);
  });

  it("errors when nothing was extracted", () => {
    expect(levels(checkSyllabusExtraction({ courses: [] }, term))).toContain("error");
  });

  it("errors on a courseName that isn't a code", () => {
    const r = checkSyllabusExtraction({ courses: [{ ...okCourse, courseName: "Introduction to Data Science" }] }, term);
    expect(levels(r)).toContain("error");
  });

  it("warns when a syllabus course isn't among the imported classes", () => {
    const r = checkSyllabusExtraction({ courses: [okCourse] }, { ...term, courses: [{ name: "MATH 20C" }] });
    expect(msgs(r)).toMatch(/isn't one of your imported classes/);
  });

  it("warns on due dates outside the term (wrong year)", () => {
    const r = checkSyllabusExtraction({
      courses: [{ courseName: "DSC 10", assignments: [{ title: "PS1", dueDate: "2025-10-02" }], exams: [] }],
    }, term);
    expect(msgs(r)).toMatch(/outside your term/);
  });

  it("warns on unreadable dates", () => {
    const r = checkSyllabusExtraction({
      courses: [{ courseName: "DSC 10", assignments: [{ title: "PS1", dueDate: "TBD" }], exams: [] }],
    }, term);
    expect(msgs(r)).toMatch(/unreadable date/);
  });

  it("warns when weights for a course sum well over 100", () => {
    const r = checkSyllabusExtraction({
      courses: [{ courseName: "DSC 10", assignments: [{ title: "A", dueDate: "2026-10-02", weight: 80 }], exams: [{ title: "Final", date: "2026-12-09", weight: 80 }] }],
    }, term);
    expect(msgs(r)).toMatch(/add up to 160%/);
  });

  it("warns when a course has too many exams (quizzes mislabeled)", () => {
    const exams = Array.from({ length: 8 }, (_, i) => ({ title: `Quiz ${i}`, date: "2026-10-02", weight: 2 }));
    const r = checkSyllabusExtraction({ courses: [{ courseName: "DSC 10", assignments: [], exams }] }, term);
    expect(msgs(r)).toMatch(/exams for "DSC 10"/);
  });
});

describe("reclassifyMisplacedQuizzes (unchanged safety net)", () => {
  it("moves a quiz-titled item out of exams", () => {
    const { courses, moved } = reclassifyMisplacedQuizzes([
      { courseName: "DSC 10", assignments: [], exams: [{ title: "Reading Quiz 3", date: "2026-10-02" }, { title: "Final Exam", date: "2026-12-09" }] },
    ]);
    expect(moved).toBe(1);
    expect(courses[0].exams).toHaveLength(1);
    expect(courses[0].assignments).toHaveLength(1);
  });
});

const mkAssignment = (over = {}) => ({
  id: "a1", courseId: "c1", title: "Problem Set 5", dueDate: "2026-10-30", ...over,
});

describe("coreNorm", () => {
  it("strips punctuation and collapses case/spacing", () => {
    expect(coreNorm("Problem Set #5")).toBe("problem set 5");
    expect(coreNorm("  Problem   Set  5  ")).toBe("problem set 5");
  });
});

describe("findProbableDuplicate", () => {
  it("matches an exact title with the exact same date", () => {
    const dup = findProbableDuplicate([mkAssignment()], "c1", "Problem Set 5", "2026-10-30", "dueDate");
    expect(dup?.id).toBe("a1");
  });

  it("matches a formatting-only title difference (the AI-drift case)", () => {
    const dup = findProbableDuplicate([mkAssignment()], "c1", "Problem Set #5", "2026-10-30", "dueDate");
    expect(dup?.id).toBe("a1");
  });

  it("matches the same title with a due date shifted by a couple days (a syllabus revision)", () => {
    const dup = findProbableDuplicate([mkAssignment()], "c1", "Problem Set 5", "2026-11-01", "dueDate");
    expect(dup?.id).toBe("a1");
  });

  it("does not match the same title with a due date shifted by more than the window", () => {
    const dup = findProbableDuplicate([mkAssignment()], "c1", "Problem Set 5", "2026-11-10", "dueDate");
    expect(dup).toBeNull();
  });

  it("matches the exact same date when one title contains the other", () => {
    const dup = findProbableDuplicate([mkAssignment()], "c1", "Problem Set 5 (Ch 3-4)", "2026-10-30", "dueDate");
    expect(dup?.id).toBe("a1");
  });

  it("does not match a different course, even with identical title/date", () => {
    const dup = findProbableDuplicate([mkAssignment({ courseId: "c2" })], "c1", "Problem Set 5", "2026-10-30", "dueDate");
    expect(dup).toBeNull();
  });

  it("does not match a genuinely different title on the exact same date — no date-only matching", () => {
    const dup = findProbableDuplicate([mkAssignment({ title: "Reading Quiz 3" })], "c1", "Problem Set 5", "2026-10-30", "dueDate");
    expect(dup).toBeNull();
  });

  it("works for exams via the date field name", () => {
    const exam = { id: "e1", courseId: "c1", title: "Midterm 1", date: "2026-10-23" };
    expect(findProbableDuplicate([exam], "c1", "Midterm 1", "2026-10-24", "date")?.id).toBe("e1");
  });

  it("returns null against an empty or missing list", () => {
    expect(findProbableDuplicate([], "c1", "Problem Set 5", "2026-10-30", "dueDate")).toBeNull();
    expect(findProbableDuplicate(null, "c1", "Problem Set 5", "2026-10-30", "dueDate")).toBeNull();
  });

  it("returns null when the new title or date is missing", () => {
    expect(findProbableDuplicate([mkAssignment()], "c1", "", "2026-10-30", "dueDate")).toBeNull();
    expect(findProbableDuplicate([mkAssignment()], "c1", "Problem Set 5", "", "dueDate")).toBeNull();
  });
});
