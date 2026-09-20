import { describe, it, expect } from "vitest";
import { iso } from "@/lib/time";
import { weekStartOf } from "@/lib/calendar/weeks";
import { buildDailySummaryMessage, buildEncouragementLine } from "./dailySummary";

// Dates built relative to iso() (today), not hardcoded — du() (used for the exam countdown) is
// itself relative to real "today", so a fixture built off a fixed past/future date would silently
// drift out of whatever window these tests check as time passes.
const daysFromNow = (n) => { const d = new Date(iso() + "T12:00:00"); d.setDate(d.getDate() + n); return iso(d); };

function mkData({ blocks = [], pastBlocks = [], gymDays, exams = [], courses = [], assignments = [], profile = {} } = {}) {
  const date = daysFromNow(0);
  const weeks = {};
  const addDay = (d, blks) => {
    if (!blks.length) return;
    const ws = weekStartOf(d);
    weeks[ws] = weeks[ws] || { days: {} };
    weeks[ws].days[d] = blks;
  };
  addDay(date, blocks);
  pastBlocks.forEach(({ date: d, blocks: blks }) => addDay(d, blks));
  return {
    date,
    data: {
      studyPlan: { weeks },
      exams,
      courses,
      assignments,
      profile: {
        breakfastTime: "09:00", dinnerTime: "19:30", gymDays, ...profile,
      },
    },
  };
}

describe("buildDailySummaryMessage", () => {
  it("always opens with the greeting + weekday, and includes breakfast/dinner but never lunch", () => {
    const { data, date } = mkData({});
    const msg = buildDailySummaryMessage(data, date);
    expect(msg).toMatch(/^Good morning! Here's \w+:/);
    expect(msg).toContain("Breakfast");
    expect(msg).toContain("Dinner");
    expect(msg).not.toMatch(/lunch/i);
  });

  it("groups same-task study sessions under one header, numbered in order", () => {
    const { data, date } = mkData({
      blocks: [
        { id: 1, s: 720, e: 780, label: "MMW 122 exam prep", course: "MMW 122", courseId: "c1", kind: "study" },
        { id: 2, s: 930, e: 990, label: "MMW 122 exam prep", course: "MMW 122", courseId: "c1", kind: "study" },
      ],
    });
    const msg = buildDailySummaryMessage(data, date);
    expect(msg).toContain("2 Study Sessions today 📚");
    expect(msg).toContain("MMW 122 exam prep:");
    expect(msg).toContain("1: 12:00pm–1:00pm (session#1)");
    expect(msg).toContain("2: 3:30pm–4:30pm (session#2)");
  });

  it("singularizes to one session with no trailing 's'", () => {
    const { data, date } = mkData({
      blocks: [{ id: 1, s: 600, e: 660, label: "Reading", course: "DSC 10", courseId: "c1", kind: "study" }],
    });
    expect(buildDailySummaryMessage(data, date)).toContain("1 Study Session today 📚");
  });

  it("omits the study-session block entirely on a day with nothing scheduled", () => {
    const { data, date } = mkData({});
    expect(buildDailySummaryMessage(data, date)).not.toMatch(/Study Session/);
  });

  it("includes gym only when that day-of-week is on", () => {
    const onDay = new Date(daysFromNow(0) + "T12:00:00").getDay();
    const { data, date } = mkData({
      gymDays: [{ day: onDay, on: true, s: "14:20", e: "15:20" }],
    });
    expect(buildDailySummaryMessage(data, date)).toContain("2:20pm–3:20pm Gym 💪");
  });

  it("shows no gym line on a rest day", () => {
    const onDay = new Date(daysFromNow(0) + "T12:00:00").getDay();
    const restDay = (onDay + 1) % 7;
    const { data, date } = mkData({
      gymDays: [{ day: restDay, on: true, s: "14:20", e: "15:20" }],
    });
    expect(buildDailySummaryMessage(data, date)).not.toContain("Gym");
  });

  it("surfaces an exam within its prep window with the right day count and weekday", () => {
    const examDate = daysFromNow(2);
    const examWeekday = new Date(examDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" });
    const { data, date } = mkData({
      exams: [{ date: examDate, courseId: "c1", prepDays: 7 }],
      courses: [{ id: "c1", name: "MMW 122" }],
    });
    const msg = buildDailySummaryMessage(data, date);
    expect(msg).toContain(`Reminder ⚠️: EXAM in 2 Days (${examWeekday}) MMW 122`);
  });

  it("singularizes '1 Day' and excludes an exam outside its own prepDays window", () => {
    const near = daysFromNow(1);
    const far = daysFromNow(10);
    const { data, date } = mkData({
      exams: [
        { date: near, courseId: "c1", prepDays: 7 },
        { date: far, courseId: "c1", prepDays: 7 },
      ],
      courses: [{ id: "c1", name: "MATH 180A" }],
    });
    const msg = buildDailySummaryMessage(data, date);
    expect(msg).toContain("EXAM in 1 Day (");
    expect(msg.match(/Reminder/g)).toHaveLength(1);
  });

  it("surfaces a type:'project' assignment within PROJECT_COUNTDOWN_DAYS, title included since a course can have more than one", () => {
    const dueDate = daysFromNow(3);
    const dueWeekday = new Date(dueDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" });
    const { data, date } = mkData({
      assignments: [{ title: "Capstone", type: "project", courseId: "c1", dueDate, status: "open" }],
      courses: [{ id: "c1", name: "DSC 10" }],
    });
    const msg = buildDailySummaryMessage(data, date);
    expect(msg).toContain(`Reminder ⚠️: PROJECT due in 3 Days (${dueWeekday}) DSC 10 — Capstone`);
  });

  it("excludes a project outside the countdown window and one already done — a non-project assignment never gets this line at all", () => {
    const { data, date } = mkData({
      assignments: [
        { title: "Far capstone", type: "project", courseId: "c1", dueDate: daysFromNow(6), status: "open" },
        { title: "Done capstone", type: "project", courseId: "c1", dueDate: daysFromNow(2), status: "done" },
        { title: "PS4", courseId: "c1", dueDate: daysFromNow(2), status: "open" },
      ],
      courses: [{ id: "c1", name: "DSC 10" }],
    });
    expect(buildDailySummaryMessage(data, date)).not.toMatch(/PROJECT/);
  });

  it("lists both an exam and a project countdown together, each with its own line", () => {
    const { data, date } = mkData({
      exams: [{ date: daysFromNow(2), courseId: "c1", prepDays: 7 }],
      assignments: [{ title: "Capstone", type: "project", courseId: "c2", dueDate: daysFromNow(3), status: "open" }],
      courses: [{ id: "c1", name: "MMW 122" }, { id: "c2", name: "DSC 10" }],
    });
    const msg = buildDailySummaryMessage(data, date);
    expect(msg).toContain("EXAM in 2 Days");
    expect(msg).toContain("PROJECT due in 3 Days");
  });

  it("lists today's classes, in start-time order, same shape as study sessions", () => {
    const onDay = new Date(daysFromNow(0) + "T12:00:00").getDay();
    const { data, date } = mkData({
      courses: [
        { id: "c1", name: "MMW 122", days: [onDay], startTime: "13:00", endTime: "13:50" },
        { id: "c2", name: "DSC 10", days: [onDay], startTime: "10:00", endTime: "10:50" },
      ],
    });
    const msg = buildDailySummaryMessage(data, date);
    expect(msg).toContain("2 Classes today 🎓");
    expect(msg).toContain("1: 10:00am–10:50am (DSC 10)");
    expect(msg).toContain("2: 1:00pm–1:50pm (MMW 122)");
  });

  it("omits classes entirely when nothing meets today", () => {
    const onDay = new Date(daysFromNow(0) + "T12:00:00").getDay();
    const otherDay = (onDay + 1) % 7;
    const { data, date } = mkData({
      courses: [{ id: "c1", name: "MMW 122", days: [otherDay], startTime: "13:00", endTime: "13:50" }],
    });
    expect(buildDailySummaryMessage(data, date)).not.toMatch(/Class/);
  });

  it("Pending Report Items: shows the flat reminder line, no breakdown, when an assignment is overdue", () => {
    const { data, date } = mkData({
      courses: [{ id: "c1", name: "MATH 180A" }],
      assignments: [{ title: "Problem Set 4", courseId: "c1", dueDate: daysFromNow(-2), status: "open" }],
    });
    const msg = buildDailySummaryMessage(data, date);
    expect(msg).toContain("Pending Report Items: Reminder to update completion tonight.");
    expect(msg).not.toContain("Problem Set 4");
    expect(msg).not.toContain("Assignments:");
  });

  it("Pending Report Items: excludes assignments due today/future or already done", () => {
    const { data, date } = mkData({
      courses: [{ id: "c1", name: "MATH 180A" }],
      assignments: [
        { title: "Due today", courseId: "c1", dueDate: daysFromNow(0), status: "open" },
        { title: "Due later", courseId: "c1", dueDate: daysFromNow(3), status: "open" },
        { title: "Already done", courseId: "c1", dueDate: daysFromNow(-2), status: "done" },
      ],
    });
    expect(buildDailySummaryMessage(data, date)).not.toContain("Pending Report Items");
  });

  it("Pending Report Items: counts unmarked study sessions from previous days", () => {
    const { data, date } = mkData({
      pastBlocks: [{
        date: daysFromNow(-1),
        blocks: [
          { id: 1, s: 600, e: 660, label: "DSC 10 reading", course: "DSC 10", courseId: "c1", kind: "study", completed: false },
          { id: 2, s: 700, e: 760, label: "DSC 10 reading", course: "DSC 10", courseId: "c1", kind: "study", completed: true },
        ],
      }],
    });
    const msg = buildDailySummaryMessage(data, date);
    expect(msg).toContain("Pending Report Items: Reminder to update completion tonight.");
    expect(msg).not.toContain("Assignments:");
  });

  it("omits Pending Report Items entirely when nothing is overdue or unmarked", () => {
    const { data, date } = mkData({});
    expect(buildDailySummaryMessage(data, date)).not.toContain("Pending Report Items");
  });

  it("encouragement line: picks from the 'yesterday went well' pool when yesterday's blocks were all completed", () => {
    const { data, date } = mkData({
      pastBlocks: [{
        date: daysFromNow(-1),
        blocks: [{ id: 1, s: 600, e: 660, label: "X", course: "X", courseId: "c1", kind: "study", completed: true }],
      }],
    });
    const line = buildEncouragementLine(data, date);
    expect([
      "Great work yesterday — let's keep the pace! 💪",
      "You crushed it yesterday — same energy today.",
      "Strong finish yesterday — let's build on it.",
    ]).toContain(line);
  });

  it("encouragement line: picks from the 'fresh start' pool when yesterday had an unmarked block", () => {
    const { data, date } = mkData({
      pastBlocks: [{
        date: daysFromNow(-1),
        blocks: [{ id: 1, s: 600, e: 660, label: "X", course: "X", courseId: "c1", kind: "study", completed: false }],
      }],
    });
    const line = buildEncouragementLine(data, date);
    expect([
      "New day, fresh start — let's make today count.",
      "Yesterday's behind you — today's a clean slate.",
      "Let's reset and make today productive.",
    ]).toContain(line);
  });

  it("encouragement line: falls back to exam urgency when yesterday has no data but an exam is 1-2 days out", () => {
    const { data, date } = mkData({
      exams: [{ date: daysFromNow(2), courseId: "c1", prepDays: 7 }],
    });
    const line = buildEncouragementLine(data, date);
    expect(["Big one coming up — let's make today's prep count.", "Exam's close — stay sharp today.", "Crunch time — you've got this."]).toContain(line);
  });

  it("encouragement line: an exam 3+ days out does not count as 'soon'", () => {
    const { data, date } = mkData({ exams: [{ date: daysFromNow(3), courseId: "c1", prepDays: 7 }] });
    const line = buildEncouragementLine(data, date);
    expect(["Here's what's on deck today.", "Let's make today productive.", "Here's the plan for today."]).toContain(line);
  });

  it("encouragement line: same date always regenerates the same line (idempotent, not random)", () => {
    const { data, date } = mkData({});
    const a = buildEncouragementLine(data, date);
    const b = buildEncouragementLine(data, date);
    expect(a).toBe(b);
  });

  it("appears as the message's second line, right after the greeting", () => {
    const { data, date } = mkData({});
    const msg = buildDailySummaryMessage(data, date);
    const line = buildEncouragementLine(data, date);
    expect(msg.split("\n")[1]).toBe(line);
  });

  it("never leaves a trailing blank line", () => {
    const { data, date } = mkData({});
    const msg = buildDailySummaryMessage(data, date);
    expect(msg.endsWith("\n")).toBe(false);
    expect(msg.split("\n").at(-1)).not.toBe("");
  });
});
