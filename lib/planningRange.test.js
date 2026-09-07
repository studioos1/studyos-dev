import { describe, it, expect } from "vitest";
import { planningRange } from "./planningRange";

// termScopedForPlanning returns `data` unchanged when there's no active term (data.terms empty),
// so these fixtures just put assignments/exams straight on `data` and set the typed term dates
// on the profile — getTermRange falls back to profile.termStart/termEnd with no collegeCalendar.
const base = (over = {}) => ({
  profile: { termStart: "2026-09-01", termEnd: "2026-11-12", ...over.profile },
  courses: [{ id: 1, name: "Course A" }],
  assignments: [],
  exams: [],
  ...over,
});

describe("planningRange — end anchors on the last deadline, not the typed term-end", () => {
  it("typed term-end LATER than the last deadline → end is the last deadline, warned 'after'", () => {
    const data = base({
      exams: [{ id: 9, courseId: 1, date: "2026-11-05" }],
      assignments: [{ id: 1, courseId: 1, dueDate: "2026-10-20" }],
    });
    const r = planningRange(data);
    expect(r.end).toBe("2026-11-05");
    expect(r.lastDeadline).toBe("2026-11-05");
    expect(r.termEndWarning).toMatchObject({ direction: "after", gapDays: 7 });
  });

  it("typed term-end EARLIER than the last deadline → end still reaches the last deadline, warned 'before'", () => {
    const data = base({
      profile: { termStart: "2026-09-01", termEnd: "2026-10-25" },
      exams: [{ id: 9, courseId: 1, date: "2026-11-05" }],
    });
    const r = planningRange(data);
    expect(r.end).toBe("2026-11-05");
    expect(r.termEndWarning).toMatchObject({ direction: "before", gapDays: 11 });
  });

  it("typed term-end within the 2-day cushion → no warning", () => {
    const data = base({
      profile: { termStart: "2026-09-01", termEnd: "2026-11-06" },
      exams: [{ id: 9, courseId: 1, date: "2026-11-05" }],
    });
    const r = planningRange(data);
    expect(r.end).toBe("2026-11-05");
    expect(r.termEndWarning).toBeNull();
  });

  it("no dated items → falls back to the typed term-end, no warning", () => {
    const r = planningRange(base());
    expect(r.end).toBe("2026-11-12");
    expect(r.lastDeadline).toBeNull();
    expect(r.termEndWarning).toBeNull();
  });

  it("no typed term dates and no deadlines → null", () => {
    expect(planningRange({ profile: {}, courses: [], assignments: [], exams: [] })).toBeNull();
  });

  it("a deadline earlier than the typed term-start pulls the start back", () => {
    const data = base({
      assignments: [{ id: 1, courseId: 1, dueDate: "2026-08-20" }],
      exams: [{ id: 9, courseId: 1, date: "2026-11-05" }],
    });
    expect(planningRange(data).start).toBe("2026-08-20");
  });
});
