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
export function du(ds){return Math.ceil((new Date(ds)-new Date(iso()))/(864e5));}
export function m2t(m){return`${Math.floor(m/60).toString().padStart(2,"0")}:${(m%60).toString().padStart(2,"0")}`;}
export function f12(t){if(!t)return"";const m=t2m(t);const h=Math.floor(m/60)%12||12;const mn=(m%60).toString().padStart(2,"0");return`${h}:${mn}${Math.floor(m/60)>=12?"pm":"am"}`;}
// Formats a raw minute count as "1h 30m" (or just "45m" under an hour) — used anywhere a total
// duration is shown, instead of a raw minute count that gets hard to read past ~60.
export function fmtDur(totalMin){
  const h=Math.floor(totalMin/60),m=totalMin%60;
  if(h<=0)return`${m}m`;
  if(m===0)return`${h}h`;
  return`${h}h ${m}m`;
}
