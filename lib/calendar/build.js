import { t2m } from "@/lib/time";
import { courseNameFor } from "@/lib/courses";
import { GYM0, termScopedForPlanning } from "@/lib/data";

// Shifts a movable [s,e) block forward past any (buffered) fixed academic interval it overlaps,
// preserving its original duration. Leaves the block untouched if no room exists before midnight.
export function resolveConflict(s,e,fixedIntervals,bufferMins){
  const dur=e-s;
  let ns=s,ne=e,moved=false,changed=true,guard=0;
  const sorted=[...fixedIntervals].sort((a,b)=>a.s-b.s);
  while(changed&&guard<12){
    changed=false;guard++;
    for(const f of sorted){
      const fs=f.s-bufferMins,fe=f.e+bufferMins;
      if(ns<fe&&ne>fs){ns=fe;ne=ns+dur;moved=true;changed=true;}
    }
  }
  if(ne>1439)return{s,e,moved:false}; // no room before midnight — keep original rather than push it off-screen
  return{s:ns,e:ne,moved};
}

export function buildBlocks(dateStr,data,studyBlocks=[]){
  data=termScopedForPlanning(data); // otherwise a completed term's old course/exam would still show as "happening" on its usual weekday forever — buildBlocks has no date-range awareness of its own, just a weekday pattern
  const p=data.profile,di=new Date(dateStr+"T12:00:00").getDay(),bl=[];
  const wm=t2m(p.wakeTime);if(wm>0)bl.push({type:"sleep",label:"Sleep",s:0,e:wm});

  // ── Classes: sorted by start time. Commute blocks are only drawn at the edges of a same-day
  // cluster (before the first class, after the last) — not between back-to-back/closely-spaced
  // classes, since the student stays on campus rather than driving home and back. ──
  const dayCourses=data.courses.filter(c=>(c.days||[]).includes(di))
    .map(c=>({...c,cs:t2m(c.startTime),ce:t2m(c.endTime)}))
    .sort((a,b)=>a.cs-b.cs);
  const busyRaw=[]; // {s,e} for every class + real commute block actually drawn, merged below into the protected zone
  dayCourses.forEach((c,idx)=>{
    const prev=dayCourses[idx-1],next=dayCourses[idx+1];
    const gapBefore=prev?c.cs-prev.ce:Infinity;
    const gapAfter=next?next.cs-c.ce:Infinity;
    if(gapBefore>=p.commuteMins*2){
      bl.push({type:"commute",label:`Drive → ${c.name.split("(")[0].trim().split(" ").slice(0,2).join(" ")}`,s:c.cs-p.commuteMins,e:c.cs});
      busyRaw.push({s:c.cs-p.commuteMins,e:c.cs});
    }
    bl.push({type:"class",label:c.name.split("(")[0].trim(),s:c.cs,e:c.ce,color:c.color});
    busyRaw.push({s:c.cs,e:c.ce});
    if(gapAfter>=p.commuteMins*2){
      bl.push({type:"commute",label:"Drive home",s:c.ce,e:c.ce+p.commuteMins});
      busyRaw.push({s:c.ce,e:c.ce+p.commuteMins});
    }
  });
  data.exams.filter(e=>e.date===dateStr).forEach(e=>{
    bl.push({type:"exam",label:`EXAM: ${courseNameFor(data.courses,e.courseId)}`,s:540,e:660});
    busyRaw.push({s:540,e:660});
  });
  // Merge into the actual protected "academic" zone — guarantees it matches exactly what's drawn, no divergence.
  const fixedAcademic=busyRaw.sort((a,b)=>a.s-b.s).reduce((merged,iv)=>{
    if(merged.length&&iv.s<=merged[merged.length-1].e)merged[merged.length-1].e=Math.max(merged[merged.length-1].e,iv.e);
    else merged.push({...iv});
    return merged;
  },[]);

  const WALK_BUFFER=10; // minutes of breathing room kept clear when repositioning meals/gym/chores

  // ── Movable: meals, gym, chores — each resolved against academics AND everything already placed
  // before it (in that order), so they never collide with each other either. ──
  const occupied=[...fixedAcademic];

  const bfDur=parseInt(p.breakfastDur)||30;
  const luDur=parseInt(p.lunchDur)||30;
  const diDur=parseInt(p.dinnerDur)||30;
  [["breakfast","Breakfast",t2m(p.breakfastTime),bfDur],
   ["lunch","Lunch",t2m(p.lunchTime),luDur],
   ["dinner","Dinner",t2m(p.dinnerTime),diDur]].forEach(([type,label,start,dur])=>{
    const r=resolveConflict(start,start+dur,occupied,WALK_BUFFER);
    bl.push({type,label,s:r.s,e:r.e,autoMoved:r.moved});
    occupied.push({s:r.s,e:r.e});
  });

  // ── Movable: gym — resolve the WHOLE outing (stretch + commute + session + commute) as one
  // atomic unit against everything so far, then shift all four sub-blocks by the same amount. ──
  const gd=(p.gymDays||GYM0).find(g=>g.day===di&&g.on);
  if(gd){
    const gs0=t2m(gd.s),ge0=t2m(gd.e);
    if(ge0>gs0){
      const st=parseInt(p.gymStretch)||30;
      const dr=parseInt(p.gymDrive)||10;
      const outingStart0=gs0-st-dr,outingEnd0=ge0+dr;
      const r=resolveConflict(outingStart0,outingEnd0,occupied,WALK_BUFFER);
      const shift=r.s-outingStart0;
      const gs=gs0+shift,ge=ge0+shift;
      bl.push({type:"stretch",label:"Stretch / prep",s:gs-st-dr,e:gs-dr});
      bl.push({type:"commute",label:"Drive to gym",s:gs-dr,e:gs});
      bl.push({type:"gym",label:"Gym",s:gs,e:ge,autoMoved:r.moved});
      bl.push({type:"commute",label:"Drive home",s:ge,e:ge+dr});
      occupied.push({s:gs-st-dr,e:ge+dr}); // reserve the whole gym outing, including its own stretch/commute
    }
  }

  // AI-generated study blocks — placed via placeCourseBlocks()/planHorizon() into real free gaps,
  // so these never need conflict resolution here; they're guaranteed clear by construction.
  (studyBlocks||[]).forEach(b=>{
    const s=t2m(b.time),e=s+(b.duration||25);
    bl.push({type:b.kind||"study",label:b.task||"Study",s,e,id:b.id,courseId:b.courseId,userEdited:b.userEdited,completed:b.completed,source:b.source});
  });

  // ── Movable: chores ──
  (p.chores||[]).filter(c=>c.days?.includes(di)&&c.time).forEach(c=>{
    const start=t2m(c.time),dur=c.dur||30;
    const r=resolveConflict(start,start+dur,occupied,WALK_BUFFER);
    bl.push({type:"chore",label:`${c.e||"📋"} ${c.n}`,s:r.s,e:r.e,autoMoved:r.moved});
    occupied.push({s:r.s,e:r.e});
  });

  (data.adhoc||[]).filter(e=>e.date===dateStr&&e.time).forEach(e=>bl.push({type:"fun",label:e.title,s:t2m(e.time),e:t2m(e.time)+e.dur}));
  // Assignment deadlines — shown as a milestone marker, not a range. Most syllabi don't state
  // a specific due time (just a date), so we assume a conventional end-of-day deadline (11:59pm)
  // and place the marker 1 hour before that, at 10:59pm. If a specific due time is ever added to
  // the schema, use that instead.
  data.assignments.filter(a=>a.dueDate===dateStr&&a.status!=="done").forEach(a=>{
    const dueMin=1439; // 11:59pm default due time
    const markerMin=dueMin-60; // 1 hour before due
    bl.push({type:"deadline",label:`Due: ${a.title}`,s:markerMin,e:markerMin+1,courseId:a.courseId,title:a.title,dueMin});
  });
  bl.push({type:"sleep",label:"Sleep",s:t2m(p.sleepTime),e:1440});
  return bl.filter(b=>b.s<b.e&&b.s>=0&&b.e<=1500).sort((a,b)=>a.s-b.s);
}

// Returns sorted free {s,e} gaps within the student's wake-sleep window, given the day's
// already-resolved fixed/personal schedule (classes, exams, meals, gym, chores, adhoc events).
export function freeSlots(dateStr,data,userEditedBlocks=[]){
  const p=data.profile;
  const dayStart=t2m(p.wakeTime);
  let dayEnd=t2m(p.sleepTime);
  if(!Number.isFinite(dayStart)||!Number.isFinite(dayEnd))return[];
  // Sleep time is usually after midnight (e.g. wake 08:00, sleep 00:00 = midnight, or 01:00 = 1am).
  // When the sleep clock-time is <= wake clock-time, it means "past midnight" — add 24h so the
  // day window is wake→(midnight+sleepTime) instead of collapsing to zero.
  if(dayEnd<=dayStart)dayEnd+=1440;
  const fixed=buildBlocks(dateStr,data,[]) // no AI study blocks yet — that's what we're solving for
    .filter(b=>b.type!=="sleep"&&b.type!=="deadline")
    .concat(userEditedBlocks) // student's own manually-placed/edited blocks are also occupied time —
                              // the planner must work around them, never overlap or replace them
    .map(b=>({s:Math.max(b.s,dayStart),e:Math.min(b.e,dayEnd)}))
    .filter(b=>b.s<b.e)
    .sort((a,b)=>a.s-b.s);
  const gaps=[];
  let cursor=dayStart;
  fixed.forEach(b=>{if(b.s>cursor)gaps.push({s:cursor,e:b.s});cursor=Math.max(cursor,b.e);});
  if(cursor<dayEnd)gaps.push({s:cursor,e:dayEnd});
  return gaps.filter(g=>g.e-g.s>=10);
}
