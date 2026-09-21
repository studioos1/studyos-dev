// Getting Started checklist status — components/shared/HelpDrawer.jsx's data layer. Real, derived
// progress signals rather than a manual "did I do this" list the student has to maintain by hand.
// Deliberately conservative: only marks an item done when there's a real, unambiguous signal the
// student actually did the thing, never just "the default value happens to already satisfy it" —
// notifyBrowser*/browserNotifsEnabled all default true for every account (see lib/data/schema.js),
// so "notifications on" can't be read off those; Notification.permission==="granted" requires a
// real one-time browser prompt + click, and smsEnabled requires an explicit opt-in + a verified
// phone number, so those are the two real signals used instead. There is no "set your daily
// schedule" entry here on purpose — every schedule field already has a sane default whether or not
// the student ever opened Preferences, so there's no honest way to detect it from data alone; that
// one item stays a manual checkbox in the drawer itself (see HelpDrawer's own state).
export function gettingStartedStatus(data) {
  const p = data?.profile || {};
  return {
    school: (data?.schools || []).length > 0,
    syllabus: (data?.courses || []).length > 0,
    notifications:
      (typeof Notification !== "undefined" && Notification.permission === "granted") ||
      p.smsEnabled === true,
    replan: !!data?.quarterPlan,
    focusTime: (data?.completionLog || []).length > 0 || (data?.pomodoroLogs || []).length > 0,
  };
}
