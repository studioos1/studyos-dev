// In-app notification log — a persistent history of the real alerts StudyOS has actually sent
// (daily priorities, Focus Time break/study signals), shown via the bell icon in App.jsx's top
// bar. Deliberately NOT a place routine toasts (Saved!, Check-in saved!) get logged — those stay
// transient, this is only for the same events that also fire a browser Notification.
import { uid } from "./schema";

const MAX_LOG = 50; // bounded so this never grows unbounded in a long-lived account

// priority is optional and only ever "high" right now — set by the one call site (App.jsx's
// daily-priorities effect) that's built entirely from urgentItems() (an upcoming exam within 5
// days, an assignment due within 2, or a prep-start day), so it's always true for that whole
// notification, not something read back out of title/body text after the fact. Every other call
// site (Focus Time's break/study signals, scheduled session reminders) omits it and renders as a
// normal-priority entry.
export function pushNotification(data, upd, { title, body, priority }) {
  const entry = { id: uid(), title, body, priority, createdAt: new Date().toISOString(), read: false };
  upd({ notifications: [entry, ...(data.notifications || [])].slice(0, MAX_LOG) });
}

// Opening the bell panel marks everything currently in the log read, in one pass — no per-item
// click needed.
export function markAllNotificationsRead(data, upd) {
  if (!(data.notifications || []).some((n) => !n.read)) return; // nothing to do — skip a needless upd()
  upd({ notifications: data.notifications.map((n) => ({ ...n, read: true })) });
}
