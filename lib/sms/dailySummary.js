import { iso, f12, t2m, m2t, du } from "@/lib/time";
import { DF } from "@/lib/constants";
import { GYM0, PROJECT_COUNTDOWN_DAYS } from "@/lib/data";
import { realDayBlocks, catchUpDays } from "@/lib/calendar/weeks";
import { courseNameFor } from "@/lib/courses";

// Deterministic, situation-aware pick — several phrasings per real situation so the line doesn't
// read the same every day ("rotate few types"), without an AI call for what's ultimately a
// selection among a handful of fixed sentences. Priority, most specific/informative first:
//   1. Yesterday's scheduled study blocks were ALL completed → genuine positive reinforcement.
//   2. Yesterday had scheduled blocks that were never marked complete → a fresh-start nudge, not
//      a scold (the "Pending Report Items" line already covers the factual catch-up ask).
//   3. Nothing scheduled yesterday to judge either way, but an exam lands in the next 1-2 days →
//      urgency framing takes over as the most useful thing to say.
//   4. None of the above → a plain, upbeat default.
// Picking within a pool is a stable hash of dateStr, not Math.random() — the same day always
// regenerates the same line (idempotent, testable), while different days land on different lines.
const ENCOURAGEMENT_POOLS = {
  yesterdayGood: [
    "Great work yesterday — let's keep the pace! 💪",
    "You crushed it yesterday — same energy today.",
    "Strong finish yesterday — let's build on it.",
  ],
  yesterdayMissed: [
    "New day, fresh start — let's make today count.",
    "Yesterday's behind you — today's a clean slate.",
    "Let's reset and make today productive.",
  ],
  examSoon: [
    "Big one coming up — let's make today's prep count.",
    "Exam's close — stay sharp today.",
    "Crunch time — you've got this.",
  ],
  default: [
    "Here's what's on deck today.",
    "Let's make today productive.",
    "Here's the plan for today.",
  ],
};
function pickFromPool(pool, dateStr) {
  let hash = 0;
  for (const ch of dateStr) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return pool[Math.abs(hash) % pool.length];
}
export function buildEncouragementLine(data, dateStr) {
  const yesterday = new Date(`${dateStr}T12:00:00`);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayBlocks = realDayBlocks(data, iso(yesterday));

  let situation = "default";
  if (yesterdayBlocks.length > 0) {
    situation = yesterdayBlocks.every(b => b.completed) ? "yesterdayGood" : "yesterdayMissed";
  } else if ((data.exams || []).some(e => { const d = du(e.date); return d >= 1 && d <= 2; })) {
    situation = "examSoon";
  }
  return pickFromPool(ENCOURAGEMENT_POOLS[situation], dateStr);
}

// The "Daily summary" SMS text (Preferences → Notifications → SMS Reminders → notifyDailySummary,
// "8:30am — today's plan") — deliberately fully deterministic, no AI call. Every piece of this
// (meal times, study session times, gym schedule, exam countdown) already lives in real
// structured data (data.profile, data.studyPlan, data.exams), so there's nothing here an AI call
// would add except cost and inconsistency — matches the standing "prefer deterministic over AI"
// preference. Exact structure/wording tuned directly against a real SMS the student wrote out by
// hand (see CHANGELOG).
//
// dateStr is almost always iso() — this is meant to run once a morning for "today" — but it's a
// parameter rather than calling iso() internally so the exact same function that will eventually
// run on a schedule is also what previews any date on demand.
//
// Lunch is deliberately omitted — breakfast/dinner bookend the day, lunch in the middle adds a
// line without adding information the student doesn't already expect.
export function buildDailySummaryMessage(data, dateStr) {
  const p = data.profile;
  const day = new Date(`${dateStr}T12:00:00`);
  const di = day.getDay();
  const weekday = DF[di];
  const lines = [`Good morning! Here's ${weekday}:`, buildEncouragementLine(data, dateStr), ""];

  if (p.breakfastTime) lines.push(`${f12(p.breakfastTime)} Breakfast`, "");

  // Same "N ... today <emoji>" + numbered-list shape as study sessions below — one line per
  // class, in start-time order, since (unlike study sessions) two classes never share a label to
  // group under.
  const classes = (data.courses || []).filter(c => (c.days || []).includes(di))
    .sort((a, b) => t2m(a.startTime) - t2m(b.startTime));
  if (classes.length > 0) {
    lines.push(`${classes.length} Class${classes.length === 1 ? "" : "es"} today 🎓`);
    classes.forEach((c, i) => {
      lines.push(`${i + 1}: ${f12(c.startTime)}–${f12(c.endTime)} (${c.name})`);
    });
    lines.push("");
  }

  // Grouped by task label (not flattened one-line-per-block) — a student doing 3 sessions on the
  // same assignment across a day wants "3 sessions on X", not X repeated 3 times as separate
  // headers. Groups appear in the order their first session occurs, sessions within a group in
  // their own chronological order (both already guaranteed by realDayBlocks' storage order).
  const blocks = realDayBlocks(data, dateStr);
  if (blocks.length > 0) {
    lines.push(`${blocks.length} Study Session${blocks.length === 1 ? "" : "s"} today 📚`);
    const groups = [];
    const byLabel = new Map();
    blocks.forEach(b => {
      const key = b.task || b.course || "Study";
      if (!byLabel.has(key)) { byLabel.set(key, []); groups.push(key); }
      byLabel.get(key).push(b);
    });
    groups.forEach(label => {
      lines.push(`${label}:`);
      byLabel.get(label).forEach((s, i) => {
        const endMins = t2m(s.time) + (s.duration || 25);
        lines.push(`${i + 1}: ${f12(s.time)}–${f12(m2t(endMins))} (session#${i + 1})`);
      });
    });
    lines.push("");
  }

  const gd = (p.gymDays || GYM0).find(g => g.day === di && g.on);
  if (gd) lines.push(`${f12(gd.s)}–${f12(gd.e)} Gym 💪`, "");

  // "Starting 7 days out" (or the exam's own prepDays if it's set narrower) — same window the
  // Notifications toggle's own label promises ("Exam / project countdown ... starting 7 days
  // out"), and the same du()-relative-to-real-today logic Today.jsx's own exam-prep card uses.
  (data.exams || [])
    .map(e => ({ e, d: du(e.date) }))
    .filter(({ d, e }) => d > 0 && d <= (e.prepDays || 7))
    .sort((a, b) => a.d - b.d)
    .forEach(({ e, d }) => {
      const examWeekday = DF[new Date(`${e.date}T12:00:00`).getDay()];
      // Real inconsistency caught in review: courseNameFor's own implementation does
      // courses.find(...) with no guard, and this call site was the one place in this file that
      // passed data.courses directly instead of data.courses || [] like every other access here —
      // a genuine crash risk if that field is ever missing, not just empty.
      const courseName = courseNameFor(data.courses || [], e.courseId);
      lines.push(`Reminder ⚠️: EXAM in ${d} Day${d === 1 ? "" : "s"} (${examWeekday}) ${courseName}`, "");
    });

  // Same countdown idea, for a type:"project" assignment (components/Acad.jsx's own distinction).
  // Real gap closed: this toggle's own label already said "Exam / project countdown," but only
  // exams ever actually got one — a project fell into the same 2-day-out bucket as any regular
  // homework. PROJECT_COUNTDOWN_DAYS (lib/data/notifications.js) is the exact same fixed window
  // the bell-log/browser-notification feed now uses for projects too, so "how far ahead this gets
  // mentioned" doesn't quietly differ between the two channels. No per-project custom window
  // (unlike exams' prepDays) — deliberately one simple shared default for now, not a new field.
  // Title included (exams don't need one here — courseName already identifies which exam) since a
  // course can plausibly have more than one project active at once.
  (data.assignments || [])
    .filter(a => a.type === "project" && a.status !== "done" && a.dueDate)
    .map(a => ({ a, d: du(a.dueDate) }))
    .filter(({ d }) => d > 0 && d <= PROJECT_COUNTDOWN_DAYS)
    .sort((a, b) => a.d - b.d)
    .forEach(({ a, d }) => {
      const dueWeekday = DF[new Date(`${a.dueDate}T12:00:00`).getDay()];
      const courseName = courseNameFor(data.courses || [], a.courseId);
      lines.push(`Reminder ⚠️: PROJECT due in ${d} Day${d === 1 ? "" : "s"} (${dueWeekday}) ${courseName} — ${a.title}`, "");
    });

  // Pending Report Items — one flat line, no breakdown, explicitly requested ("no need more than
  // this, no details"). Still conditional on there actually being something pending (an overdue
  // assignment, or a past study session never marked complete via catchUpDays() —
  // lib/calendar/weeks.js, the same definition Progress's own catch-up list already uses, so
  // "pending" doesn't have a second, possibly-drifting definition here) — a message with nothing
  // to report doesn't get a reminder line about reporting it. Placed near the end, right before
  // Dinner — a closing "oh, and also" nudge rather than competing with the day's own schedule.
  const hasOverdueAssignment = (data.assignments || [])
    .some(a => a.dueDate && a.dueDate < dateStr && a.status !== "done");
  const hasUnmarkedSession = catchUpDays(data).length > 0;
  if (hasOverdueAssignment || hasUnmarkedSession) {
    lines.push("Pending Report Items: Reminder to update completion tonight.", "");
  }

  if (p.dinnerTime) lines.push(`${f12(p.dinnerTime)} Dinner`);

  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}
