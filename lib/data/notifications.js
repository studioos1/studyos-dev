// In-app notification log — a persistent history of the real alerts StudyOS has actually sent
// (daily priorities, Focus Time break/study signals), shown via the bell icon in App.jsx's top
// bar. Deliberately NOT a place routine toasts (Saved!, Check-in saved!) get logged — those stay
// transient, this is only for the same events that also fire a browser Notification.
import { uid } from "./schema";
import { du } from "@/lib/time";
import { courseNameFor } from "@/lib/courses";

const MAX_LOG = 50; // bounded so this never grows unbounded in a long-lived account

// The actual entry shape, factored out so both the client push below AND the server-side cron
// (app/api/cron/notify-urgent-items — writes straight into a user's row via the service-role
// client, no `upd` callback to call) build the exact same shape from one definition, not two that
// could quietly drift apart.
export function appendNotification(notifications, { title, body, priority }) {
  const entry = { id: uid(), title, body, priority, createdAt: new Date().toISOString(), read: false };
  return [entry, ...(notifications || [])].slice(0, MAX_LOG);
}

// priority is optional and only ever "high" right now — set by the one call site (App.jsx's
// daily-priorities effect, and its server-side equivalent) that's built entirely from
// urgentItems() (an upcoming exam within 5 days, an assignment due within 2, or a prep-start day),
// so it's always true for that whole notification, not something read back out of title/body text
// after the fact. Every other call site (Focus Time's break/study signals, scheduled session
// reminders) omits it and renders as a normal-priority entry.
export function pushNotification(data, upd, { title, body, priority }) {
  upd({ notifications: appendNotification(data.notifications, { title, body, priority }) });
}

// Real requested change: exams surface starting 5 days out, not just 2 — assignments stay at 2
// (both explicit thresholds, not derived from each other). Every item this can produce is by
// construction high-priority, which is what lets the one notification built from it tag itself
// priority:"high" wholesale. Shared by the client effect (App.jsx) and its server-side cron
// equivalent (app/api/cron/notify-urgent-items) — one definition, not two.
//
// PROJECT_COUNTDOWN_DAYS: a type:"project" assignment (components/Acad.jsx's own distinction —
// same field the planner already treats differently, lib/planner/schedule.js's
// PROJECT_START_WINDOW_DAYS) gets the same wider heads-up window as an exam instead of a regular
// 2-day homework window — real gap found and closed: the SMS toggle and this bell-log feed are
// both named "Exam / project countdown," but until now only exams actually got a countdown; a
// project just fell into the generic 2-day-out assignment bucket like any other homework. One
// fixed universal default (not a per-item custom field, which would be its own real feature) — a
// deliberately simple choice, matching EXAM_COUNTDOWN_DAYS below rather than inventing a second
// number, so both "the bigger things you should be thinking ahead about" get the same lead time.
// Exported so lib/sms/dailySummary.js's own project-countdown line uses the exact same window
// rather than a second hardcoded number that could quietly drift from this one.
export const PROJECT_COUNTDOWN_DAYS = 5;
const EXAM_COUNTDOWN_DAYS = 5;
const ASSIGNMENT_DUE_DAYS = 2;
export function urgentItems(data) {
  // data.courses || [] on both calls below — courseNameFor's own implementation does
  // courses.find(...) with no internal guard, so a missing (not just empty) courses field would
  // throw here otherwise.
  const items = [];
  (data.assignments || []).filter(a => a.status !== "done" && a.dueDate).forEach(a => {
    const d = du(a.dueDate);
    const window = a.type === "project" ? PROJECT_COUNTDOWN_DAYS : ASSIGNMENT_DUE_DAYS;
    if (d >= 0 && d <= window) items.push(`${a.title} (${courseNameFor(data.courses || [], a.courseId)}) — due ${d === 0 ? "today" : `in ${d}d`}${a.type === "project" ? " [Project]" : ""}`);
  });
  (data.exams || []).forEach(e => {
    const d = du(e.date);
    const cn = courseNameFor(data.courses || [], e.courseId);
    if (d >= 0 && d <= EXAM_COUNTDOWN_DAYS) items.push(`${cn} exam — ${d === 0 ? "today" : `in ${d}d`}`);
    if (d === e.prepDays) items.push(`Start prep for ${cn} exam`);
  });
  return items;
}

// Opening the bell panel marks everything currently in the log read, in one pass — no per-item
// click needed.
export function markAllNotificationsRead(data, upd) {
  if (!(data.notifications || []).some((n) => !n.read)) return; // nothing to do — skip a needless upd()
  upd({ notifications: data.notifications.map((n) => ({ ...n, read: true })) });
}

// Server-side batch equivalent of the client-side "today's priorities" effect in App.jsx — writes
// the SAME urgentItems()-built entry straight into a user's row via a service-role client, so the
// bell log is accurate the next time the app is opened even if the computer itself was
// asleep/fully closed when it would have run client-side. Deliberately does NOT touch a real
// desktop Notification() — that's inherently client-only — this only ever writes into
// data.notifications, nothing more. Called from app/api/cron/daily-summary (same trigger, not its
// own separate schedule — see that route's comment for why) and independently exposed via
// app/api/cron/notify-urgent-items for manual testing. A plain lib function, not exported from a
// route.js file — Next.js route files are only allowed to export HTTP method handlers plus a
// handful of special config values, not arbitrary shared functions.
export async function runNotifyUrgentItems(supabase, rows, today) {
  const results = [];
  for (const row of rows || []) {
    const d = row.data;
    const p = d?.profile;
    if (!d?.onboarded || !p || p.browserNotifsEnabled === false || p.notifyBrowserPriorities === false) { results.push({ user: row.user_id, skipped: "not eligible" }); continue; }
    if (p.lastUrgentItemsNotifiedDate === today) { results.push({ user: row.user_id, skipped: "already ran today" }); continue; }

    try {
      const items = urgentItems(d);
      const patch = { profile: { ...p, lastUrgentItemsNotifiedDate: today } };
      if (items.length) {
        patch.notifications = appendNotification(d.notifications, {
          title: "StudyOS — today's priorities",
          body: items.slice(0, 3).join("\n"),
          priority: "high",
        });
      }
      await supabase.from("user_data").update({ data: { ...d, ...patch } }).eq("user_id", row.user_id);
      results.push({ user: row.user_id, logged: items.length > 0, itemCount: items.length });
    } catch (err) {
      results.push({ user: row.user_id, error: err.message });
    }
  }
  return results;
}
