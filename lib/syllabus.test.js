import { describe, it, expect } from "vitest";
import {
  reclassifyQuizzesAsExams,
  checkScheduleExtraction,
  checkSyllabusExtraction,
  scanForDatedItemSignals,
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

  it("errors when a numbered series shares one identical date (likely a guessed schedule)", () => {
    const assignments = Array.from({ length: 6 }, (_, i) => ({ title: `Homework ${i + 1}`, dueDate: "2026-10-29", weight: null }));
    const r = checkSyllabusExtraction({ courses: [{ courseName: "DSC 10", assignments, exams: [] }] }, term);
    expect(levels(r)).toContain("error");
    expect(msgs(r)).toMatch(/6 items named like "homework N" all share the same date \(2026-10-29\)/);
  });

  it("does not flag a real numbered series with different dates each", () => {
    const assignments = ["2026-10-02", "2026-10-09", "2026-10-16"].map((d, i) => ({ title: `Homework ${i + 1}`, dueDate: d }));
    const r = checkSyllabusExtraction({ courses: [{ courseName: "DSC 10", assignments, exams: [] }] }, term);
    expect(msgs(r)).not.toMatch(/share the same date/);
  });

  it("does not flag a real one-off cluster of distinctly-named items sharing a date", () => {
    const assignments = ["Join Campuswire", "Check Gradescope Access", "Syllabus Check", "Welcome Survey"]
      .map(title => ({ title, dueDate: "2026-09-29" }));
    const r = checkSyllabusExtraction({ courses: [{ courseName: "DSC 10", assignments, exams: [] }] }, term);
    expect(msgs(r)).not.toMatch(/share the same date/);
  });

  it("does not flag a normal quiz-heavy course (quizzes now legitimately count as exams)", () => {
    const exams = Array.from({ length: 8 }, (_, i) => ({ title: `Quiz ${i}`, date: "2026-10-02", weight: 2 }));
    const r = checkSyllabusExtraction({ courses: [{ courseName: "DSC 10", assignments: [], exams }] }, term);
    expect(msgs(r)).not.toMatch(/exams for "DSC 10"/);
  });

  it("warns when a course has an implausibly large number of exams", () => {
    const exams = Array.from({ length: 16 }, (_, i) => ({ title: `Quiz ${i}`, date: "2026-10-02", weight: 2 }));
    const r = checkSyllabusExtraction({ courses: [{ courseName: "DSC 10", assignments: [], exams }] }, term);
    expect(msgs(r)).toMatch(/exams for "DSC 10"/);
  });

  describe("completeness signal (sourceText cross-reference)", () => {
    it("flags a date mentioned near exam language that wasn't extracted", () => {
      const sourceText = "Midterm Exam: Monday, October 26th, during your enrolled lecture slot.";
      const r = checkSyllabusExtraction({ courses: [okCourse] }, { ...term, sourceText });
      expect(msgs(r)).toMatch(/2026-10-26/);
    });

    it("does not flag a date that IS already covered by an extracted item", () => {
      const sourceText = "Midterm Exam: Monday, October 26th, during your enrolled lecture slot.";
      const covered = { courseName: "DSC 10", assignments: [], exams: [{ title: "Midterm Exam", date: "2026-10-26", weight: 10 }] };
      const r = checkSyllabusExtraction({ courses: [covered] }, { ...term, sourceText });
      expect(msgs(r)).not.toMatch(/doesn't match any extracted item/);
    });

    it("is silent with no sourceText (opt-in, never required)", () => {
      const r = checkSyllabusExtraction({ courses: [okCourse] }, term);
      expect(msgs(r)).not.toMatch(/doesn't match any extracted item/);
    });

    it("produces zero false positives on real syllabus phrasing against its correct extraction", () => {
      // Verbatim-shaped excerpts from a real UCSD DSC 10 syllabus (the actual case this check was
      // built for), spaced apart the way they actually are in the real ~40k-char document (the
      // Course Meetings section, with its non-graded Discussion start date, is pages away from the
      // Assessments section's real quiz/exam dates) — condensing them together would create a
      // false window-overlap that doesn't happen in the real document (confirmed manually).
      const filler = " ".repeat(50) + "Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. " + " ".repeat(50);
      const sourceText = `
        Discussions will start in Week 1 on Monday, September 28th.
        ${filler}
        Make sure to complete the four items listed below by Tuesday, September 29th at 11:59PM.
        Join Campuswire (join code: 4942). Check if you can access Gradescope. Complete the
        Syllabus Check. Fill out the Welcome Survey.
        ${filler}
        Midterm Exam: Monday, October 26th, during your enrolled lecture slot.
        Final Exam: Saturday, December 5th from 3PM to 6PM.
        There are four quizzes: Quiz 1: Friday, October 9th. Quiz 2: Friday, October 16th.
        Quiz 3: Friday, November 6th. Quiz 4: Friday, November 20th.
      `;
      const correct = {
        courseName: "DSC 10",
        assignments: [
          { title: "Getting Started: Join Campuswire", dueDate: "2026-09-29" },
          { title: "Getting Started: Verify Gradescope Access", dueDate: "2026-09-29" },
          { title: "Syllabus Check", dueDate: "2026-09-29" },
          { title: "Welcome Survey", dueDate: "2026-09-29" },
        ],
        exams: [
          { title: "Quiz 1", date: "2026-10-09", weight: 5 },
          { title: "Quiz 2", date: "2026-10-16", weight: 5 },
          { title: "Midterm Exam", date: "2026-10-26", weight: 10 },
          { title: "Quiz 3", date: "2026-11-06", weight: 5 },
          { title: "Quiz 4", date: "2026-11-20", weight: 5 },
          { title: "Final Exam", date: "2026-12-05", weight: 20 },
        ],
      };
      const r = checkSyllabusExtraction({ courses: [correct] }, { termStart: "2026-09-24", termEnd: "2026-12-15", sourceText });
      expect(msgs(r)).not.toMatch(/doesn't match any extracted item/);
    });
  });
});

describe("scanForDatedItemSignals", () => {
  it("finds a date sitting near graded-item language", () => {
    const r = scanForDatedItemSignals("The Final Exam is on December 5th from 3-6pm.", "2026-09-24");
    expect(r).toContainEqual(expect.objectContaining({ date: "2026-12-05" }));
  });

  it("ignores a date with no graded-item language nearby", () => {
    const r = scanForDatedItemSignals("The library will be closed on December 5th for the holiday.", "2026-09-24");
    expect(r).toEqual([]);
  });

  it("resolves a bare month/day to the year closest to refDate", () => {
    const r = scanForDatedItemSignals("Quiz 1 is due January 15th.", "2026-09-24");
    expect(r[0].date).toBe("2027-01-15"); // closer to Sep 2026 than Jan 2026 would be
  });

  it("dedupes multiple mentions of the same resolved date", () => {
    const r = scanForDatedItemSignals("Final Exam: December 5th. Reminder: the Final Exam is December 5th.", "2026-09-24");
    expect(r).toHaveLength(1);
  });
});

describe("reclassifyQuizzesAsExams (safety net, promotes quiz-titled assignments into exams)", () => {
  it("moves a quiz-titled item out of assignments and into exams", () => {
    const { courses, moved } = reclassifyQuizzesAsExams([
      { courseName: "DSC 10", assignments: [{ title: "Reading Quiz 3", dueDate: "2026-10-02", weight: 2 }, { title: "Problem Set 4", dueDate: "2026-10-09" }], exams: [{ title: "Final Exam", date: "2026-12-09" }] },
    ]);
    expect(moved).toBe(1);
    expect(courses[0].assignments).toHaveLength(1);
    expect(courses[0].exams).toHaveLength(2);
    const promoted = courses[0].exams.find(e => e.title === "Reading Quiz 3");
    expect(promoted).toMatchObject({ date: "2026-10-02", weight: 2, prepDays: 3 });
  });

  it("leaves courses with no quiz-titled assignments untouched", () => {
    const input = [{ courseName: "DSC 10", assignments: [{ title: "Problem Set 4", dueDate: "2026-10-09" }], exams: [] }];
    const { courses, moved } = reclassifyQuizzesAsExams(input);
    expect(moved).toBe(0);
    expect(courses[0]).toBe(input[0]); // untouched course object is returned as-is
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
