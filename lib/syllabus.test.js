import { describe, it, expect } from "vitest";
import {
  reclassifyQuizzesAsExams,
  checkScheduleExtraction,
  checkSyllabusExtraction,
  scanForDatedItemSignals,
  expandRecurringSeries,
  applyRecurringSeries,
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

describe("reclassifyQuizzesAsExams (safety net, bidirectional — weight decides which array a quiz-titled item belongs in)", () => {
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

  it("does NOT promote a quiz-titled item with no weight of its own — real case: an 'Academic Integrity Quiz' whose score is folded into the homework grade, never listed in the syllabus's own Exams section, explicitly unlimited attempts", () => {
    const { courses, moved } = reclassifyQuizzesAsExams([
      { courseName: "MATH 180A", assignments: [
        { title: "Academic Integrity Quiz (Canvas)", dueDate: "2026-09-30", weight: null },
        { title: "Reading Quiz 3", dueDate: "2026-10-02", weight: 2 },
      ], exams: [{ title: "Final Exam", date: "2026-12-08" }] },
    ]);
    expect(moved).toBe(1); // only the genuinely-weighted quiz
    expect(courses[0].assignments).toHaveLength(1);
    expect(courses[0].assignments[0].title).toBe("Academic Integrity Quiz (Canvas)");
    expect(courses[0].exams).toHaveLength(2);
    expect(courses[0].exams.some(e => e.title === "Reading Quiz 3")).toBe(true);
    expect(courses[0].exams.some(e => e.title === "Academic Integrity Quiz (Canvas)")).toBe(false);
  });

  it("demotes a quiz-titled item the AI put directly in exams with no weight — the actual real-world shape of the bug, confirmed live against the real MATH 180A syllabus: the AI's own raw output placed 'Academic Integrity Quiz' straight into exams (weight: null), never touching 'assignments' at all, so only a check on exams itself (not just a promotion check on assignments) catches this", () => {
    const { courses, moved } = reclassifyQuizzesAsExams([
      { courseName: "MATH 180A", assignments: [], exams: [
        { title: "Academic Integrity Quiz", date: "2026-09-30", topics: "Canvas, unlimited attempts; counts toward homework grade", prepDays: 2, weight: null },
        { title: "Midterm 1", date: "2026-10-26", topics: "Held during class", prepDays: 5, weight: 20 },
        { title: "Final Exam", date: "2026-12-08", topics: "Cumulative", prepDays: 7, weight: 40 },
      ] },
    ]);
    expect(moved).toBe(1); // only the no-weight quiz; the two real, weighted exams are untouched
    expect(courses[0].exams).toHaveLength(2);
    expect(courses[0].exams.every(e => e.title !== "Academic Integrity Quiz")).toBe(true);
    expect(courses[0].exams.find(e => e.title === "Midterm 1")).toMatchObject({ weight: 20 }); // untouched
    expect(courses[0].assignments).toHaveLength(1);
    expect(courses[0].assignments[0]).toMatchObject({ title: "Academic Integrity Quiz", dueDate: "2026-09-30", weight: null });
  });

  it("a weighted quiz already correctly in exams is left alone (no-op both directions at once)", () => {
    const input = [{ courseName: "DSC 10", assignments: [], exams: [{ title: "Quiz 1", date: "2026-10-09", weight: 5 }] }];
    const { courses, moved } = reclassifyQuizzesAsExams(input);
    expect(moved).toBe(0);
    expect(courses[0]).toBe(input[0]);
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

  it("returns null when the new title is missing", () => {
    expect(findProbableDuplicate([mkAssignment()], "c1", "", "2026-10-30", "dueDate")).toBeNull();
  });

  // The actual bug this rebuild fixes: a re-extraction can recognize a duty (same category+number)
  // without recovering its date. The old logic bailed out entirely whenever either date was
  // missing — letting exactly these items flood in as fresh duplicates.
  it("matches on category+number alone when the new item has no date at all", () => {
    const dup = findProbableDuplicate([mkAssignment()], "c1", "Problem Set 5", "", "dueDate");
    expect(dup?.id).toBe("a1");
  });
  it("matches on category+number alone when the EXISTING item has no date at all", () => {
    const dup = findProbableDuplicate([mkAssignment({ dueDate: "" })], "c1", "Problem Set 5", "2026-10-30", "dueDate");
    expect(dup?.id).toBe("a1");
  });
  // Real cases found in a live account: an AI re-summary reworded these entirely, but they're
  // clearly the same duty (same category, same ordinal, same/close date).
  it("matches reworded titles sharing a category+number ('Lab 1' vs 'Lab Assignment 1')", () => {
    const dup = findProbableDuplicate([mkAssignment({ title: "Lab Assignment 1", dueDate: "2026-10-06" })], "c1", "Lab 1", "2026-10-06", "dueDate");
    expect(dup?.id).toBe("a1");
  });
  it("matches reworded titles sharing a category+number ('Homework 1' vs 'Homework Assignment 1')", () => {
    const dup = findProbableDuplicate([mkAssignment({ title: "Homework Assignment 1", dueDate: "2026-10-01" })], "c1", "Homework 1", "2026-10-01", "dueDate");
    expect(dup?.id).toBe("a1");
  });
  it("matches differently-structured titles for the same week ('Discussion Assignment 1' vs 'Discussion Section Groupwork 1')", () => {
    const dup = findProbableDuplicate([mkAssignment({ title: "Discussion Section Groupwork 1", dueDate: "2026-10-06" })], "c1", "Discussion Assignment 1", "2026-10-06", "dueDate");
    expect(dup?.id).toBe("a1");
  });

  it("never matches different ordinals in the same category, even on the exact same date (number veto)", () => {
    const dup = findProbableDuplicate([mkAssignment({ title: "Quiz 10", dueDate: "2026-10-09" })], "c1", "Quiz 1", "2026-10-09", "dueDate");
    expect(dup).toBeNull();
  });
  it("does not extract a trailing chapter-range digit as the item number (regression)", () => {
    // "Problem Set 5 (Ch 3-4)" must still be recognized as item #5, not #4.
    const dup = findProbableDuplicate([mkAssignment()], "c1", "Problem Set 5 (Ch 3-4)", "2026-10-30", "dueDate");
    expect(dup?.id).toBe("a1");
  });

  // "Getting Started: ..." and "Course Setup — ..." both map to the "onboarding" category —
  // real case: the same join-Campuswire/verify-Gradescope duty worded two different ways.
  it("matches 'Getting Started' and 'Course Setup' titles as the same onboarding duty", () => {
    const existing = [{ id: "a9", courseId: "c1", title: "Getting Started: Join Campuswire (join code 4942)", dueDate: "2026-09-29" }];
    const dup = findProbableDuplicate(existing, "c1", "Course Setup — Join Campuswire + verify Gradescope access", "2026-09-29", "dueDate");
    expect(dup?.id).toBe("a9");
  });
  it("does not match same-category undated titles that are only weakly related", () => {
    // Both "midterm", no number on either side, no date — too weak a signal on its own.
    const dup = findProbableDuplicate([mkAssignment({ title: "Midterm Project" })], "c1", "Midterm Paper", "", "dueDate");
    expect(dup).toBeNull();
  });
  it("falls back to token-overlap for uncategorized titles with an exact date match", () => {
    const existing = [{ id: "a9", courseId: "c1", title: "Field Trip Reflection Writeup", dueDate: "2026-10-06" }];
    const dup = findProbableDuplicate(existing, "c1", "Field Trip Reflection", "2026-10-06", "dueDate");
    expect(dup?.id).toBe("a9");
  });
  it("does not fall back to token-overlap on weak similarity without a real date match", () => {
    const existing = [{ id: "a9", courseId: "c1", title: "Field Trip Reflection Essay Submission Portfolio", dueDate: "" }];
    const dup = findProbableDuplicate(existing, "c1", "Field Trip Reflection", "", "dueDate");
    expect(dup).toBeNull();
  });

  it("checks the opposite-type list and flags a cross-type match", () => {
    const existingExams = [{ id: "e1", courseId: "c1", title: "Syllabus Check (must score 80%+)", date: "2026-09-29" }];
    const dup = findProbableDuplicate([], "c1", "Syllabus Check (score ≥80% required)", "2026-09-29", "dueDate", existingExams, "date");
    expect(dup?.id).toBe("e1");
    expect(dup?._crossType).toBe(true);
    expect(dup?._crossDateField).toBe("date");
  });
  it("prefers a same-type match over a cross-type one when both exist", () => {
    const sameType = [{ id: "a1", courseId: "c1", title: "Quiz 1", dueDate: "2026-10-09" }];
    const crossType = [{ id: "e1", courseId: "c1", title: "Quiz 1", date: "2026-10-09" }];
    const dup = findProbableDuplicate(sameType, "c1", "Quiz 1", "2026-10-09", "dueDate", crossType, "date");
    expect(dup?.id).toBe("a1");
    expect(dup?._crossType).toBeUndefined();
  });
});

describe("expandRecurringSeries", () => {
  // 2026-09-24 is a Thursday.
  const bounds = { termStart: "2026-09-24", lastDeadline: "2026-12-05" };

  it("generates one instance per week on the stated weekday", () => {
    const out = expandRecurringSeries([{ title: "Lab", dayOfWeek: 2, weightTotal: 10 }], bounds); // Tuesday
    expect(out.length).toBeGreaterThan(1);
    out.forEach(o => expect(new Date(o.dueDate + "T00:00:00").getDay()).toBe(2));
    expect(out[0].title).toBe("Lab 1");
    expect(out[1].title).toBe("Lab 2");
  });

  it("skips the first occurrence if it falls inside the lead-in window", () => {
    // termStart is Thursday 9/24; dayOfWeek=4 (Thursday) means the very first candidate IS
    // termStart itself (0 days in) — must be skipped, first real one a week later.
    const out = expandRecurringSeries([{ title: "Homework", dayOfWeek: 4, weightTotal: 20 }], bounds);
    expect(out[0].dueDate).toBe("2026-10-01"); // not 2026-09-24
  });

  it("stops strictly before lastDeadline", () => {
    const out = expandRecurringSeries([{ title: "Lab", dayOfWeek: 2, weightTotal: 10 }], bounds);
    out.forEach(o => expect(o.dueDate < bounds.lastDeadline).toBe(true));
  });

  it("splits the total weight evenly across generated occurrences", () => {
    const out = expandRecurringSeries([{ title: "Lab", dayOfWeek: 2, weightTotal: 10 }], bounds);
    const sum = out.reduce((s, o) => s + o.weight, 0);
    expect(sum).toBeCloseTo(10, 0);
    expect(out[0].weight).toBeCloseTo(10 / out.length, 1);
  });

  it("flags every generated row so the verify screen can tell it apart from a real extracted date", () => {
    const out = expandRecurringSeries([{ title: "Lab", dayOfWeek: 2, weightTotal: 10 }], bounds);
    out.forEach(o => expect(o.generated).toBe(true));
  });

  it("falls back to a ~17-week ceiling with no lastDeadline given", () => {
    const out = expandRecurringSeries([{ title: "Lab", dayOfWeek: 2, weightTotal: 10 }], { termStart: "2026-09-24" });
    expect(out.length).toBeGreaterThan(10);
  });

  it("returns nothing for an invalid dayOfWeek or missing termStart", () => {
    expect(expandRecurringSeries([{ title: "Lab", dayOfWeek: 9, weightTotal: 10 }], bounds)).toEqual([]);
    expect(expandRecurringSeries([{ title: "Lab", dayOfWeek: 2, weightTotal: 10 }], {})).toEqual([]);
  });

  it("handles multiple series independently", () => {
    const out = expandRecurringSeries([
      { title: "Lab", dayOfWeek: 2, weightTotal: 10 },
      { title: "Homework", dayOfWeek: 4, weightTotal: 20 },
    ], bounds);
    expect(out.some(o => o.title.startsWith("Lab"))).toBe(true);
    expect(out.some(o => o.title.startsWith("Homework"))).toBe(true);
  });
});

describe("applyRecurringSeries", () => {
  it("merges generated items into the course's assignments and consumes recurringSeries", () => {
    const courses = [{
      courseName: "DSC 10",
      assignments: [{ title: "Welcome Survey", dueDate: "2026-09-29" }],
      exams: [{ title: "Final Exam", date: "2026-12-05" }],
      recurringSeries: [{ title: "Lab", dayOfWeek: 2, weightTotal: 10 }],
    }];
    const { courses: out, generated } = applyRecurringSeries(courses, { termStart: "2026-09-24", termEnd: "2026-12-15" });
    expect(generated).toBeGreaterThan(0);
    const c = out[0];
    expect(c.assignments.some(a => a.title === "Welcome Survey")).toBe(true); // original kept
    expect(c.assignments.some(a => a.title === "Lab 1")).toBe(true); // generated merged in
    expect(c.recurringSeries).toBeUndefined();
  });

  it("anchors the end bound to the course's own last exam date, not termEnd, when both exist", () => {
    const courses = [{
      courseName: "DSC 10",
      assignments: [],
      exams: [{ title: "Final Exam", date: "2026-11-01" }], // well before termEnd
      recurringSeries: [{ title: "Lab", dayOfWeek: 2, weightTotal: 10 }],
    }];
    const { courses: out } = applyRecurringSeries(courses, { termStart: "2026-09-24", termEnd: "2026-12-15" });
    out[0].assignments.forEach(a => expect(a.dueDate < "2026-11-01").toBe(true));
  });

  it("falls back to termEnd when the course has no exams", () => {
    const courses = [{
      courseName: "DSC 10",
      assignments: [],
      exams: [],
      recurringSeries: [{ title: "Lab", dayOfWeek: 2, weightTotal: 10 }],
    }];
    const { courses: out } = applyRecurringSeries(courses, { termStart: "2026-09-24", termEnd: "2026-11-01" });
    expect(out[0].assignments.length).toBeGreaterThan(0);
    out[0].assignments.forEach(a => expect(a.dueDate < "2026-11-01").toBe(true));
  });

  it("leaves a course with no recurringSeries untouched", () => {
    const courses = [{ courseName: "DSC 10", assignments: [{ title: "PS1", dueDate: "2026-10-02" }], exams: [] }];
    const { courses: out, generated } = applyRecurringSeries(courses, { termStart: "2026-09-24" });
    expect(generated).toBe(0);
    expect(out[0].assignments).toHaveLength(1);
  });
});
