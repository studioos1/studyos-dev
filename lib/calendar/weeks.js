import { iso, m2t, t2m, du } from "@/lib/time";

// Sunday of the week containing dateStr, as an ISO date string — the key used throughout
// data.studyPlan.weeks. Matches how WeekGrid already computes its own week boundaries.
export function weekStartOf(dateStr){
  const d=new Date(dateStr+"T12:00:00");
  d.setDate(d.getDate()-d.getDay());
  return iso(d);
}

// Single source of truth for "what does the REAL plan say about this day" — reads directly from
// data.studyPlan.weeks (what refreshQuarterPlan/refreshWeekPlan actually persist), shaped into
// what buildBlocks()/Timeline expects. Anywhere that used to call planStudyBlocks() directly, or
// read from the disconnected AI-generated brief, should use this instead — otherwise different
// parts of the app can show different schedules for the same day, which is exactly what was
// happening before this fix.
export function realDayBlocks(data,dateStr){
  const ws=weekStartOf(dateStr);
  const stored=data.studyPlan?.weeks?.[ws]?.days?.[dateStr]||[];
  return stored.map(b=>({
    time:m2t(b.s),duration:b.e-b.s,task:b.label,kind:b.kind,
    id:b.id,courseId:b.courseId,course:b.course,userEdited:b.userEdited,completed:b.completed,source:b.source,
  }));
}
// Whether this date's WEEK has ever actually been planned at all — distinct from "planned but
// legitimately has zero blocks today" (e.g. a real rest day). Used to show an honest prompt
// instead of silently computing a fictional alternate schedule when nothing's been planned yet.
export function weekHasBeenPlanned(data,dateStr){
  return !!data.studyPlan?.weeks?.[weekStartOf(dateStr)];
}

// Whether a specific deadline-driven item (an assignment or exam, identified by the SAME source
// tag — {type,id} — the planner stamps on every block it places for that item, see schedule.js)
// has a scheduled block ANYWHERE in the plan, not just today. Today's Deadline Awareness used to
// check only today's blocks by course, which meant an item genuinely scheduled for tomorrow (or
// scheduled via a different item in the same course) still showed the wrong "planned"/"not yet"
// tag — this checks the actual item, on any day.
export function isItemScheduled(data,sourceType,sourceId){
  const weeks=data.studyPlan?.weeks||{};
  return Object.values(weeks).some(week=>
    Object.values(week.days||{}).some(blocks=>
      (blocks||[]).some(b=>b.source&&b.source.type===sourceType&&b.source.id===sourceId)
    )
  );
}

// Writes a block into data.studyPlan for a specific date, creating that week's entry if it
// doesn't exist yet (e.g. adding an activity to a week that's never been formally planned).
// Standalone (not component-local) so both WeekGrid and Today can share the exact same logic.
export function saveBlockToDay(data,upd,dateStr,block){
  // History is read-only. Days before today are frozen — replan/refresh/clear already leave them
  // alone; this backstops the manual edit path too. (Completing today's blocks goes through here
  // with dateStr = today, so it's unaffected.)
  if(dateStr<iso())return;
  const dWs=weekStartOf(dateStr);
  const existingWeek=data.studyPlan?.weeks?.[dWs];
  const existingDay=existingWeek?.days?.[dateStr]||[];
  const idx=existingDay.findIndex(b=>b.id===block.id);
  const newDay=idx===-1?[...existingDay,block]:existingDay.map((b,i)=>i===idx?block:b);
  const newWeek={
    generatedAt:existingWeek?.generatedAt||new Date().toISOString(),
    generatedFrom:existingWeek?.generatedFrom||{courseCount:data.courses.length,assignmentCount:data.assignments.length,examCount:data.exams.length,profileHash:""},
    days:{...(existingWeek?.days||{}),[dateStr]:newDay.sort((a,b)=>a.s-b.s)},
  };
  upd({studyPlan:{weeks:{...(data.studyPlan?.weeks||{}),[dWs]:newWeek}}});
}
export function deleteBlockFromDay(data,upd,dateStr,blockId){
  if(dateStr<iso())return; // history is read-only — see saveBlockToDay
  const dWs=weekStartOf(dateStr);
  const existingWeek=data.studyPlan?.weeks?.[dWs];
  if(!existingWeek)return;
  const newDay=(existingWeek.days?.[dateStr]||[]).filter(b=>b.id!==blockId);
  const newWeek={...existingWeek,days:{...existingWeek.days,[dateStr]:newDay}};
  upd({studyPlan:{weeks:{...(data.studyPlan?.weeks||{}),[dWs]:newWeek}}});
}
export function logCompletion(data,upd,entry){
  upd({completionLog:[...(data.completionLog||[]),entry]});
}

// Catch-up window: how many days back a forgotten study session can still be marked complete.
// Deliberately separate from saveBlockToDay's hard "history is read-only" guard just above —
// that guard exists to stop the PLANNER's regeneration path from clobbering history; this only
// ever flips a completed flag on a block the user is explicitly confirming happened, never moves
// or regenerates anything, so it's a different risk profile and gets its own narrower, explicit
// bound. Bounded rather than unlimited so Study Pace still means something.
export const CATCHUP_DAYS = 3;

// Days within the catch-up window (yesterday back CATCHUP_DAYS days) that still have unmarked
// study blocks — the list the Progress tab's Catch Up section shows. Newest first (yesterday's
// forgotten session is more top-of-mind than three days ago).
export function catchUpDays(data){
  const today=iso();
  const out=[];
  for(let i=1;i<=CATCHUP_DAYS;i++){
    const d=new Date(today+"T00:00:00"); d.setDate(d.getDate()-i);
    const ds=iso(d);
    const blocks=realDayBlocks(data,ds).filter(b=>!b.completed);
    if(blocks.length)out.push({date:ds,blocks});
  }
  return out;
}

// Today's own scheduled blocks that have ALREADY ENDED (by clock time) and aren't marked
// complete yet — the real, per-session equivalent of catchUpDays() but for today specifically.
// Real reported bug this fixes: Evening Check-in previously showed one summary row per exam
// ("Study for X exam"), not the actual N scheduled sessions, and nothing stopped checking off a
// session scheduled for later today before it had even happened. Same {date,blocks} shape as
// catchUpDays() so Prog.jsx can render both lists identically.
// `now` is an optional override (tests only) — same pattern as lib/time.js's briefPeriodStart.
export function todayPassedBlocks(data,now){
  const today=iso();
  const d=now?new Date(now):new Date();
  const nowMin=d.getHours()*60+d.getMinutes();
  // realDayBlocks() returns display-shaped blocks (time:"HH:MM", duration:mins), not the raw
  // stored s/e-in-minutes fields — end time has to be derived from those instead.
  const blocks=realDayBlocks(data,today).filter(b=>!b.completed&&t2m(b.time)+b.duration<=nowMin);
  return blocks.length?[{date:today,blocks}]:[];
}

// Cheap boolean version of "is there anything for Progress's Evening Check-in to show right
// now" — same conditions as Prog.jsx's own `tasks`/`catchDays`/`todayPassedBlocks`, but without
// building the display-formatted lists. Used to gate the evening report-complete nudge (App.jsx):
// the nudge should never fire on a day with genuinely nothing to report.
export function hasCheckInWork(data){
  const dueOrOverdue=(data.assignments||[]).some(a=>a.status!=="done"&&a.dueDate&&du(a.dueDate)<=2);
  return dueOrOverdue||catchUpDays(data).length>0||todayPassedBlocks(data).length>0;
}

// items: [{date,blockId}] — applied in ONE pass / one upd() call, not a loop of separate
// catchUpMarkComplete-per-item calls. Looping would silently lose all but the last item: each
// call would compute its patch from the same stale `data` closure, and upd()'s merge
// ({...prev,...p} in App.jsx) fully replaces the studyPlan key per call rather than deep-merging
// across calls — the same class of bug already worked around elsewhere in this codebase.
// `date` may be today (a session whose time has already passed — see todayPassedBlocks) or any
// day within the catch-up window; future dates are always rejected regardless of caller.
export function catchUpMarkComplete(data,upd,items){
  const today=iso();
  const cutoff=new Date(today+"T00:00:00"); cutoff.setDate(cutoff.getDate()-CATCHUP_DAYS);
  const weeks={...(data.studyPlan?.weeks||{})};
  const now=new Date().toISOString();
  let changed=false;
  items.forEach(({date,blockId})=>{
    if(date>today||new Date(date+"T00:00:00")<cutoff)return; // future, or outside the catch-up window
    const ws=weekStartOf(date);
    const week=weeks[ws]; if(!week)return;
    const day=week.days?.[date]||[];
    const idx=day.findIndex(b=>b.id===blockId); if(idx===-1)return;
    const nowStamp=now;
    const newDay=day.map((b,i)=>i===idx?{...b,completed:true,completedAt:b.completedAt||nowStamp}:b);
    weeks[ws]={...week,days:{...week.days,[date]:newDay}};
    changed=true;
  });
  if(changed)upd({studyPlan:{weeks}});
}
// BlockEditModal/completion logic needs the RAW stored block shape (createdAt/editedAt/etc),
// not the display-shaped output of realDayBlocks()/buildBlocks(). Shared so every place that
// needs to mutate a real block (Timeline's double-click edit, Focus Time's per-row controls)
// looks it up the same way.
export function findRawDayBlock(data,dateStr,blockId){
  const ws=weekStartOf(dateStr);
  return (data.studyPlan?.weeks?.[ws]?.days?.[dateStr]||[]).find(b=>b.id===blockId)||null;
}
