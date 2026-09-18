// In-app notification log — a persistent history of the real alerts StudyOS has actually sent
// (daily priorities, Focus Time break/study signals), shown via the bell icon in App.jsx's top
// bar. Deliberately NOT a place routine toasts (Saved!, Check-in saved!) get logged — those stay
// transient, this is only for the same events that also fire a browser Notification.
import { uid } from "./schema";

const MAX_LOG = 50; // bounded so this never grows unbounded in a long-lived account

export function pushNotification(data, upd, { title, body }) {
  const entry = { id: uid(), title, body, createdAt: new Date().toISOString(), read: false };
  upd({ notifications: [entry, ...(data.notifications || [])].slice(0, MAX_LOG) });
}

// Opening the bell panel marks everything currently in the log read, in one pass — no per-item
// click needed.
export function markAllNotificationsRead(data, upd) {
  if (!(data.notifications || []).some((n) => !n.read)) return; // nothing to do — skip a needless upd()
  upd({ notifications: data.notifications.map((n) => ({ ...n, read: true })) });
}
