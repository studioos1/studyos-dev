// Canonical date/time primitives — kept dependency-free so both the app shell
// (components/App.jsx) and the planner module (lib/planner/) can import from
// here without a circular import between the two.

export function iso(d){
  const dt=d?new Date(d):new Date();
  // Local date components, NOT toISOString() (which converts to UTC) — for any timezone behind
  // UTC, evening local time is already the next calendar day in UTC, so the old implementation
  // silently returned tomorrow's date for a large part of every day. This was the root cause of
  // Weekly showing a different "today" than Today's own page header, which correctly used
  // toLocaleDateString() (local-time based) instead of this function.
  const y=dt.getFullYear(),m=(dt.getMonth()+1).toString().padStart(2,"0"),day=dt.getDate().toString().padStart(2,"0");
  return`${y}-${m}-${day}`;
}
export function t2m(t){if(!t)return 0;const[h,m]=String(t).split(":").map(Number);if(!Number.isFinite(h)||!Number.isFinite(m))return 0;return h*60+m;}
