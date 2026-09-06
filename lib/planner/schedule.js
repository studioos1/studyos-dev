import { t2m } from "@/lib/time";
import { courseNameFor } from "@/lib/courses";
import { ISO_DATE_RE, alignUp15, daysFrom, difficultyMultiplier } from "./core";
import { computePriorityScore } from "./estimate";

// ══════════════════════════════════════════════════════════════════════════════════════════
// PHASE 2 PLANNER — priority-driven, stateful across the whole planning horizon (not just one
// day in isolation). Implements every agreed rule together: session presets, real priority
// scoring, primary/secondary with minimize-switching, 15-min topic buffer, 1-day due-date
// buffer, energyPeak time-of-day placement, and a completion guarantee with early risk warnings
// — validated as a standalone prototype before this integration (see project history).
// ══════════════════════════════════════════════════════════════════════════════════════════

// Each preset is ONE placed block — study+break folded together internally, always a multiple
// of 15, sidestepping the sub-alignment problem a separately-shown break portion would create
// (e.g. a 25-min study-only chunk doesn't end on the 15-min grid, but a 30-min combined block
// always does).
export const SESSION_PRESETS={30:30,45:45,60:60};
export function dayWindows(profile){
  const wake=t2m(profile.wakeTime);
  let sleep=t2m(profile.sleepTime);
  if(sleep<=wake)sleep+=1440;
  return{morning:[wake,720],afternoon:[720,1020],evening:[1020,sleep]};
}
export function windowOrderFor(energyPeak){
  if(energyPeak==="afternoon")return["afternoon","evening","morning"];
  if(energyPeak==="evening")return["evening","afternoon","morning"];
  return["morning","afternoon","evening"];
}

// Builds the candidate list of deadline-driven items (assignments/exams) with everything the
// planner needs: remaining minutes (from estimatedHours, already computed by the Study
// Preferences flow), effective difficulty, and priority is computed fresh per-day by the caller
// (urgency depends on which day is being planned, not a single fixed "today").
// How many days before its due date an item is even eligible to start being scheduled — starting
// too early wastes limited near-term capacity on work that isn't actually urgent yet, and crowds
// out items that genuinely need that time now. Homework gets a fixed window; exams use their own
// per-exam prepDays field (already existed, already editable per-exam) — the bug fixed here is
// that the new planner was never actually consulting it, so every exam was "eligible" the moment
// it existed, regardless of how far out it was.
export const HOMEWORK_START_WINDOW_DAYS=5;
export function buildItemDemand(data){
  const items=[];
  data.assignments.filter(a=>a.status!=="done"&&a.dueDate&&ISO_DATE_RE.test(a.dueDate)).forEach(a=>{
    const course=data.courses.find(c=>c.id===a.courseId);
    items.push({
      id:`a_${a.id}`,rawId:a.id,kind:"homework",courseId:a.courseId,
      courseName:course?course.name:courseNameFor(data.courses,a.courseId),
      title:a.title,dueDate:a.dueDate,weight:a.weight,forced:!!a.forced,
      effectiveDifficulty:a.userValue||a.estimatorValue||"Mid",
      remainingMinutes:Math.max(0,(a.userHours??a.aiHours??a.estimatedHours??2)*60),
      source:{type:"assignment",id:a.id},startWindowDays:HOMEWORK_START_WINDOW_DAYS,
    });
  });
  data.exams.filter(e=>e.status!=="done"&&e.date&&ISO_DATE_RE.test(e.date)).forEach(e=>{
    const course=data.courses.find(c=>c.id===e.courseId);
    items.push({
      id:`e_${e.id}`,rawId:e.id,kind:"study",courseId:e.courseId,
      courseName:course?course.name:"(unknown course)",
      title:e.title||"Exam",dueDate:e.date,weight:e.weight,forced:!!e.forced,
      effectiveDifficulty:e.userValue||e.estimatorValue||"Mid",
      remainingMinutes:Math.max(0,(e.userHours??e.aiHours??e.estimatedHours??4)*60),
      source:{type:"exam",id:e.id},startWindowDays:+e.prepDays||7,
    });
  });
  return items;
}

// The last graded date each course has on record — the later of its last exam and its last
// assignment due date (status doesn't matter: a done-early assignment still marks the window the
// course was active in). Courses with no dated items aren't in the map. Used to stop Tier 2
// "regular study" from inventing demand for a class once its final is over — no demand signal
// after that date means the planner places nothing.
export function lastDeadlineByCourse(data){
  const m={};
  const bump=(cid,date)=>{if(date&&ISO_DATE_RE.test(date)&&(!m[cid]||date>m[cid]))m[cid]=date;};
  (data.assignments||[]).forEach(a=>bump(a.courseId,a.dueDate));
  (data.exams||[]).forEach(e=>bump(e.courseId,e.date));
  return m;
}

// Places one course's block(s) for the day — may span multiple items within that course (highest
// priority covered first), placed as ONE continuous session group (back-to-back, same window
// preference) so switching between different ITEMS of the SAME course doesn't count as a topic
// switch. Mutates `gaps` (consumes time) and each item's `remainingMinutes` (depletes demand) in
// place. Returns the blocks placed.
export function placeCourseBlocks(gaps,courseItems,budgetCap,presetLen,windowOrderList,windowMap,courseId,courseName,dateStr,seqRef,now){
  // Pass 1 — DECIDE allocations in priority order (who deserves how many minutes today; this
  // part is unchanged). Nothing is placed into gaps yet.
  let budgetLeft=budgetCap;
  const allocations=[];
  for(const item of courseItems){
    if(budgetLeft<15||item.remainingMinutes<15)continue;
    const toPlace=Math.min(item.remainingMinutes,budgetLeft);
    if(toPlace<15)continue;
    allocations.push({item,minutes:toPlace});
    budgetLeft-=toPlace;
  }

  // Pass 2 — PLACE those allocations size-descending, not priority-descending. Without this
  // separation, a high-priority item left with only a small remainder (e.g. 15 min to finish)
  // would claim the day's earliest time slot just by virtue of being processed first, while a
  // lower-priority item with a much bigger chunk got pushed later — visually "15 > 30 > 30"
  // instead of the expected "30 > 30 > 15". Splitting allocation from placement order fixes this:
  // whoever has the MOST time today gets the earliest slot, and any small leftover naturally
  // lands last, while which item gets how much time is still entirely priority-driven.
  allocations.sort((a,b)=>b.minutes-a.minutes);

  const placed=[];
  for(const{item,minutes:toPlace}of allocations){
    let remaining=toPlace,actuallyPlaced=0;
    for(const winName of windowOrderList){
      if(remaining<15)break;
      const[winStart,winEnd]=windowMap[winName];
      for(const wg of gaps.map(g=>({s:Math.max(g.s,winStart),e:Math.min(g.e,winEnd)})).filter(g=>g.e-g.s>=15)){
        if(remaining<15)break;
        let cursor=alignUp15(wg.s);
        while(remaining>=15){
          const chunk=Math.min(presetLen,Math.round(remaining/15)*15);
          if(chunk<15||cursor+chunk>wg.e)break;
          const s=cursor,e=s+chunk;
          const label=item.kind==="homework"
            ?`${item.courseName} — ${item.title} (due ${daysFrom(dateStr,item.dueDate)===0?"today":`in ${daysFrom(dateStr,item.dueDate)}d`})`
            :`${item.courseName} exam prep (${daysFrom(dateStr,item.dueDate)===0?"today!":`${daysFrom(dateStr,item.dueDate)}d left`})`;
          placed.push({
            id:`blk_${dateStr}_${Date.now()}_${seqRef.n++}`,courseId,course:courseName,source:item.source,
            label,description:"",s,e,kind:item.kind,
            userEdited:false,completed:false,createdAt:now,editedAt:null,completedAt:null,
          });
          const gi=gaps.findIndex(g=>g.s<=s&&g.e>=e);
          if(gi!==-1){
            const g=gaps[gi];
            const newGaps=[];
            if(g.s<s)newGaps.push({s:g.s,e:s});
            if(g.e>e)newGaps.push({s:e,e:g.e});
            gaps.splice(gi,1,...newGaps);
          }
          remaining-=chunk;actuallyPlaced+=chunk;
          cursor=e; // back-to-back — same item's next chunk starts immediately after this one
        }
      }
    }
    item.remainingMinutes-=actuallyPlaced;
  }
  return placed;
}

// Consumes a 15-min buffer immediately after the last-placed block, from whichever gap contains
// that point — guarantees adjacency between DIFFERENT topics always has the buffer, while
// same-topic sessions (handled inside placeCourseBlocks) stay genuinely back-to-back.
export function consumeTopicBuffer(gaps,lastEnd){
  const gi=gaps.findIndex(g=>g.s===lastEnd);
  if(gi===-1)return;
  const g=gaps[gi];
  const newStart=Math.min(g.e,lastEnd+15);
  if(newStart>=g.e)gaps.splice(gi,1);else gaps[gi]={s:newStart,e:g.e};
}

// One day's placement. itemState is the SHARED, MUTATED-IN-PLACE array from buildItemDemand —
// remainingMinutes gets depleted here so later days in the same horizon see reduced demand.
// Deadline-driven items (Tier 1) get primary/secondary treatment with the full rule set; any
// capacity left over after that gets filled with ongoing regular per-course study (Tier 2, no
// specific deadline) so idle time doesn't go to waste, but real deadline pressure always wins
// first. Returns the day's blocks.
export function planDayV2(dateStr,itemState,data,gaps,seqRef){
  const profile=data.profile;
  const presetLen=SESSION_PRESETS[profile.sessionPreset]||30;
  const STUDY_BUFFER_DAYS=1; // hard wall — never study on the due date itself
  const PREFERRED_BUFFER_DAYS=2; // soft target — prefer finishing by due-2; due-1 stays available
                                  // as a genuine emergency fallback, not a wall, so the completion
                                  // guarantee never gets weaker
  const DAILY_CAP=300;
  const now=new Date().toISOString();
  const winMap=dayWindows(profile);
  const winOrder=windowOrderFor(profile.energyPeak);
  const blocks=[];
  let totalPlaced=0;

  // ── Tier 1: deadline-driven items ──
  // "Plan as late as needed, not as early as possible": an item within its eligible window is
  // only a REAL candidate today if today is actually needed to stay on pace for finishing by
  // due-2 — i.e. it has no slack left. If it could still be fully covered by starting later
  // (even just tomorrow) while finishing by due-2, it's deferred, so a solo item with no real
  // competition doesn't front-load onto the very first eligible day just because nothing else
  // happened to need that day. An item that's already run out of slack even for due-1 (its last
  // possible day) still gets included — never silently dropped, matching the completion guarantee.
  const candidates=itemState.filter(it=>{
    if(it.remainingMinutes<=0||!it.dueDate)return false;
    const daysOut=daysFrom(dateStr,it.dueDate);
    if(daysOut<STUDY_BUFFER_DAYS)return false; // never on/after the due date, forced or not
    // Forced (student pinned it to "fill to 100%"): ignore the start-window ceiling and the
    // slack deferral — schedule it as early as today so the completion can actually be delivered.
    if(it.forced)return true;
    if(daysOut>(it.startWindowDays??Infinity))return false;
    // Remaining days from TODAY through the preferred (due-2) deadline, inclusive. If we're
    // already past the preferred deadline (daysOut < PREFERRED_BUFFER_DAYS, i.e. only due-1 is
    // left), there's no more slack to compute — it's unconditionally a candidate now.
    if(daysOut<PREFERRED_BUFFER_DAYS)return true;
    const remainingPreferredDays=daysOut-PREFERRED_BUFFER_DAYS+1;
    const roughDailyCapacity=DAILY_CAP*0.65; // same share a primary item could realistically claim in one day
    const daysNeededIfStartedNow=Math.ceil(it.remainingMinutes/roughDailyCapacity);
    const slack=remainingPreferredDays-daysNeededIfStartedNow;
    return slack<=0; // no room left to defer further and still finish by due-2 — must start today
  });
  // Forced items outrank everything so the planner covers them first (they "take time from" the
  // rest, which may then show as short — the intended trade-off).
  candidates.forEach(it=>{it.priority=it.forced?1e9:computePriorityScore(it.dueDate,it.effectiveDifficulty,it.weight,dateStr);});
  const byCourse={};
  candidates.forEach(it=>{
    if(!byCourse[it.courseId])byCourse[it.courseId]={courseId:it.courseId,courseName:it.courseName,items:[],priority:0};
    byCourse[it.courseId].items.push(it);
    byCourse[it.courseId].priority=Math.max(byCourse[it.courseId].priority,it.priority);
  });
  const courseList=Object.values(byCourse).sort((a,b)=>b.priority-a.priority);
  courseList.forEach(c=>{c.items.sort((a,b)=>b.priority-a.priority);});

  if(courseList.length){
    const primary=courseList[0];
    const primaryBlocks=placeCourseBlocks(gaps,primary.items,Math.round(DAILY_CAP*0.65),presetLen,winOrder,winMap,primary.courseId,primary.courseName,dateStr,seqRef,now);
    blocks.push(...primaryBlocks);
    totalPlaced+=primaryBlocks.reduce((s,b)=>s+(b.e-b.s),0);
    const secondary=courseList[1];
    if(secondary&&totalPlaced<DAILY_CAP&&primaryBlocks.length){
      consumeTopicBuffer(gaps,primaryBlocks[primaryBlocks.length-1].e);
      const secondaryBlocks=placeCourseBlocks(gaps,secondary.items,DAILY_CAP-totalPlaced,presetLen,winOrder,winMap,secondary.courseId,secondary.courseName,dateStr,seqRef,now);
      blocks.push(...secondaryBlocks);
      totalPlaced+=secondaryBlocks.reduce((s,b)=>s+(b.e-b.s),0);
    }
  }

  // ── Tier 2: regular per-course study (no specific deadline) fills any leftover capacity ──
  if(totalPlaced<DAILY_CAP){
    const num=(v,fallback)=>{const n=+v;return Number.isFinite(n)&&n>0?n:fallback;};
    const lastDeadline=lastDeadlineByCourse(data);
    data.courses.forEach(c=>{
      if(totalPlaced>=DAILY_CAP)return;
      // No demand after a course's last graded date — don't invent regular study past its final.
      // (A course with no dated items has no such date and keeps filling leftover time.)
      const cld=lastDeadline[c.id];
      if(cld&&dateStr>=cld)return;
      const mult=difficultyMultiplier(c.difficulty);
      const weeklyHours=num(c.weeklyHours,4);
      const dailyTarget=Math.round((weeklyHours*60)/7*mult);
      if(dailyTarget<15)return;
      const budget=Math.min(dailyTarget,DAILY_CAP-totalPlaced);
      if(blocks.length)consumeTopicBuffer(gaps,blocks[blocks.length-1].e);
      const fakeItem=[{remainingMinutes:budget,kind:"study",dueDate:null,title:null,courseName:c.name,
        source:null}];
      // Regular study has no due date, so it bypasses placeCourseBlocks' label logic — build its
      // own simple label/placement inline instead, reusing the same window/chunk mechanics.
      const label=`${c.name.split("(")[0].trim()} — regular study`;
      let remaining=budget;
      for(const winName of winOrder){
        if(remaining<15)break;
        const[winStart,winEnd]=winMap[winName];
        for(const wg of gaps.map(g=>({s:Math.max(g.s,winStart),e:Math.min(g.e,winEnd)})).filter(g=>g.e-g.s>=15)){
          if(remaining<15)break;
          let cursor=alignUp15(wg.s);
          while(remaining>=15){
            const chunk=Math.min(presetLen,Math.round(remaining/15)*15);
            if(chunk<15||cursor+chunk>wg.e)break;
            const s=cursor,e=s+chunk;
            blocks.push({id:`blk_${dateStr}_${Date.now()}_${seqRef.n++}`,courseId:c.id,course:c.name,source:null,
              label,description:"",s,e,kind:"study",userEdited:false,completed:false,
              createdAt:now,editedAt:null,completedAt:null});
            const gi=gaps.findIndex(g=>g.s<=s&&g.e>=e);
            if(gi!==-1){
              const g=gaps[gi];const newGaps=[];
              if(g.s<s)newGaps.push({s:g.s,e:s});if(g.e>e)newGaps.push({s:e,e:g.e});
              gaps.splice(gi,1,...newGaps);
            }
            remaining-=chunk;totalPlaced+=chunk;cursor=e;
          }
        }
      }
    });
  }

  blocks.sort((a,b)=>a.s-b.s);
  return blocks;
}

// Pre-flight feasibility check — run ONCE before any real placement, using REAL per-day capacity
// (actual free-gap minutes for each day, from freeSlots), not a guess. Greedily reserves capacity
// for items in due-date order (earliest deadline claims scarce shared days first, tiebroken by
// priority) — whatever's left unclaimed is a genuine, mathematically-confirmed at-risk item,
// found before planning even starts, not discovered after the fact.
export function preflightRiskCheck(dateStrs,itemState,gapsByDay){
  const STUDY_BUFFER_DAYS=1;
  const pool={};
  dateStrs.forEach(d=>{pool[d]=(gapsByDay[d]||[]).reduce((sum,g)=>sum+(g.e-g.s),0);});
  const sorted=itemState.filter(it=>it.remainingMinutes>0&&it.dueDate)
    .map(it=>({...it,priority:computePriorityScore(it.dueDate,it.effectiveDifficulty,it.weight,dateStrs[0])}))
    .sort((a,b)=>{
      const dueDiff=new Date(a.dueDate)-new Date(b.dueDate);
      if(dueDiff!==0)return dueDiff;
      return b.priority-a.priority;
    });
  const risks=[];
  sorted.forEach(it=>{
    let need=it.remainingMinutes;
    const validDays=dateStrs.filter(d=>{
      const daysOut=daysFrom(d,it.dueDate);
      if(daysOut<STUDY_BUFFER_DAYS)return false;
      return it.forced||daysOut<=(it.startWindowDays??Infinity); // forced items may start today
    });
    for(const d of validDays){
      if(need<=0)break;
      const take=Math.min(pool[d],need);
      pool[d]-=take;need-=take;
    }
    if(need>0)risks.push({id:it.id,rawId:it.rawId,kind:it.kind,courseName:it.courseName,title:it.title,
      shortfallMin:need,desiredMinutes:it.remainingMinutes});
  });
  return risks;
}

// Runs the whole multi-day horizon: pre-flight risk check, then day-by-day placement with real
// cross-day depletion tracking (an item planned on Monday correctly has less remaining demand by
// Wednesday) — this is what actually implements "the plan shall not miss completion," not just a
// per-day heuristic re-run independently every day with no memory of what came before.
// gapsByDayFn(dateStr, userEditedBlocks) must return that day's free gaps, matching freeSlots().
export function planHorizon(dateStrs,data,gapsByDayFn,userEditedByDate){
  const itemState=buildItemDemand(data);
  const seqRef={n:0};
  // Pre-flight needs real gaps for every day up front — compute once, reused both for the risk
  // check and (mutated further) as actual placement proceeds.
  const gapsByDay={};
  dateStrs.forEach(d=>{gapsByDay[d]=gapsByDayFn(d,userEditedByDate[d]||[]);});
  const risks=preflightRiskCheck(dateStrs,itemState,gapsByDay);

  const blocksByDate={};
  dateStrs.forEach(dateStr=>{
    const gaps=gapsByDay[dateStr];
    const generated=planDayV2(dateStr,itemState,data,gaps,seqRef);
    blocksByDate[dateStr]=[...(userEditedByDate[dateStr]||[]),...generated];
  });

  // Summary: what actually got planned vs. what was originally desired, per item — for the
  // post-refresh message so a shortage is never silent.
  const original=buildItemDemand(data);
  const summaryItems=original.map(orig=>{
    const final=itemState.find(it=>it.id===orig.id);
    const desiredMin=orig.remainingMinutes;
    const plannedMin=desiredMin-(final?final.remainingMinutes:desiredMin);
    return{id:orig.id,title:orig.title,courseName:orig.courseName,
      desiredHours:Math.round(desiredMin/60*10)/10,plannedHours:Math.round(plannedMin/60*10)/10,
      shortfallHours:Math.round((desiredMin-plannedMin)/60*10)/10,
      fullyCovered:plannedMin>=desiredMin-0.5};
  });
  const shortfalls=summaryItems.filter(it=>!it.fullyCovered).sort((a,b)=>b.shortfallHours-a.shortfallHours);

  return{blocksByDate,risks,shortfalls,summaryItems};
}
