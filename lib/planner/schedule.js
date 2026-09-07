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
// A project (a.type === "project") is schedulable the whole term, not just a few days before it's
// due — its whole point is steady early work. Big finite value, not Infinity, so it stays safe in
// arithmetic (preflight, priority) while effectively meaning "any day from today."
export const PROJECT_START_WINDOW_DAYS=180;
// Even-pace project scheduling aims to finish this fraction of the remaining timeline early (min
// 3 days), leaving slack for overruns and a final polish pass.
export const PROJECT_FINISH_BUFFER_FRAC=0.15;
export const PROJECT_FINISH_BUFFER_MIN_DAYS=3;
export function buildItemDemand(data){
  const items=[];
  data.assignments.filter(a=>a.status!=="done"&&a.dueDate&&ISO_DATE_RE.test(a.dueDate)).forEach(a=>{
    const course=data.courses.find(c=>c.id===a.courseId);
    const isProject=a.type==="project";
    items.push({
      id:`a_${a.id}`,rawId:a.id,kind:isProject?"project":"homework",courseId:a.courseId,
      courseName:course?course.name:courseNameFor(data.courses,a.courseId),
      title:a.title,dueDate:a.dueDate,weight:a.weight,forced:!!a.forced,
      effectiveDifficulty:a.userValue||a.estimatorValue||"Mid",
      remainingMinutes:Math.max(0,(a.userHours??a.aiHours??a.estimatedHours??2)*60),
      source:{type:"assignment",id:a.id},
      startWindowDays:isProject?PROJECT_START_WINDOW_DAYS:HOMEWORK_START_WINDOW_DAYS,
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

// ── Exam prep pre-pass ──────────────────────────────────────────────────────────────────────
// Exam prep is decided GLOBALLY before day-by-day planning, so it can be arranged in a way a
// greedy per-day pass can't. Each exam gets TWO dedicated single-exam days: an "eve" (D-1) and a
// "lead-in". In a finals cluster the lead-in days are the block of free days just before the
// earliest eve, handed out IN EXAM ORDER (soonest exam ⇒ earliest lead-in day), so the run-up
// reads MMW, MATH, DSC … then eves MMW, MATH, DSC. Outside a cluster the lead-in is just the day
// before the eve (two in a row). Both dedicated days are that exam's alone — no other course's
// prep, homework, project or regular study (planDayV2 enforces it). Time per exam comes from its
// estimated hours (already difficulty-driven), eve ~60%, capped per day; only a genuinely large
// demand spills onto earlier shared days. (F) never any study on an exam day; (E) a "finals
// stretch" span during which Tier-2 regular study is suppressed.
export const EXAM_DAILY_CAP=210;          // one exam's max minutes on an ordinary (spill) prep day (3.5h)
export const EXAM_EVE_CAP=420;            // …raised to 7h on each of the exam's two dedicated days
export const EXAM_RUN_IN_DAYS=2;          // dedicated days per exam: the eve + one lead-in
export const FINALS_STRETCH_MAX_SPAN=14;  // ≥2 exams within this many days of each other ⇒ finals stretch

function shiftDate(dateStr,n){
  const d=new Date(dateStr+"T12:00:00");
  d.setDate(d.getDate()+n);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

export function buildExamPrepPlan(dateStrs,itemState,gapsByDay){
  const dateSet=new Set(dateStrs);
  const DIFF_RANK={Low:1,Mid:2,High:3,"Very High":4};
  const exams=itemState
    .filter(it=>it.source?.type==="exam"&&it.remainingMinutes>0&&it.dueDate)
    .map(it=>({...it,_demand:it.remainingMinutes}))
    // Nearest deadline first (rule C); when two fall on the same day, the harder one goes first so
    // it claims the earlier run-in day and gets more lead time.
    .sort((a,b)=>a.dueDate.localeCompare(b.dueDate)
      ||(DIFF_RANK[b.effectiveDifficulty]||2)-(DIFF_RANK[a.effectiveDifficulty]||2)
      ||(+b.weight||0)-(+a.weight||0));

  const examDates=new Set(exams.map(e=>e.dueDate).filter(d=>dateSet.has(d)));

  // Group exams into CLUSTERS — chains where each exam is within FINALS_STRETCH_MAX_SPAN of the
  // next. A midterm week and a finals week are separate clusters; a lone exam is a cluster of one.
  const clusters=[];
  for(const ex of exams){
    const cur=clusters[clusters.length-1];
    if(cur&&daysFrom(cur[cur.length-1].dueDate,ex.dueDate)<=FINALS_STRETCH_MAX_SPAN)cur.push(ex);
    else clusters.push([ex]);
  }
  // The finals stretch (where Tier-2 regular study is suppressed) is the last multi-exam cluster.
  const lastCluster=clusters[clusters.length-1]||[];
  const finalsStretch=lastCluster.length>=2
    ?{start:shiftDate(lastCluster[0].dueDate,-1),end:lastCluster[lastCluster.length-1].dueDate}
    :null;

  const DAILY_CAP=300;
  const freeMin=d=>(gapsByDay[d]||[]).reduce((s,g)=>s+(g.e-g.s),0);
  const capLeft={};
  dateStrs.forEach(d=>{capLeft[d]=Math.min(freeMin(d),DAILY_CAP);});

  const byDate={};        // dateStr -> { examItemId: minutes }
  const shortfalls=[];

  // ── Reserve each exam's two dedicated days ─────────────────────────────────────────────────
  // The "eve": every exam's D-1 — closest free day before it, skipping exam days.
  // The "lead-in": for a cluster of ≥2 exams, one earlier day per exam handed out IN EXAM ORDER —
  //   the block of free days just before the cluster's earliest eve is split so the soonest exam
  //   gets the earliest of them (finals on 11/2, 11/4, 11/6 ⇒ lead-ins 10/29→first, 10/30→second,
  //   10/31→third). For a lone exam it's simply the calendar day before the eve (two in a row).
  // Both days are that exam's alone — no other course's prep, homework, project or regular study
  // lands there (planDayV2 enforces this via reservedExamDays).
  const used=new Set(examDates);
  const eveOf={},leadInOf={};
  const windowCapOf=ex=>ex.forced?Infinity:ex.startWindowDays;
  const inWindow=(ex,d)=>{const o=daysFrom(d,ex.dueDate);return o>=1&&o<=windowCapOf(ex);};
  // A lead-in day keeps the ordinary daily ceiling (not the eve's 7h) so there's still room on it
  // for homework that's genuinely due around then — the run-up isn't only exam prep (planDayV2
  // places due homework there too).
  const reserve=(exId,d)=>{leadInOf[exId]=d;used.add(d);};

  for(const ex of exams){
    const eve=dateStrs.filter(d=>!used.has(d)&&inWindow(ex,d)).sort((a,b)=>b.localeCompare(a))[0];
    if(!eve){shortfalls.push({id:ex.id,shortfallMin:ex._demand});continue;}
    eveOf[ex.id]=eve;used.add(eve);
    capLeft[eve]=Math.min(freeMin(eve),EXAM_EVE_CAP);
  }
  for(const cluster of clusters){
    const withEve=cluster.filter(ex=>eveOf[ex.id]);
    if(withEve.length>=2){
      const earliestEve=withEve.map(ex=>eveOf[ex.id]).sort()[0];
      const pool=[]; // free days just before the cluster's earliest eve, nearest-first
      for(let k=1;pool.length<withEve.length&&k<=withEve.length+5;k++){
        const d=shiftDate(earliestEve,-k);
        if(!dateSet.has(d))break;
        if(!used.has(d)&&freeMin(d)>=60)pool.push(d);
      }
      pool.reverse(); // earliest day first, so exam order maps to calendar order
      withEve.forEach((ex,i)=>{if(pool[i])reserve(ex.id,pool[i]);});
    }else if(withEve.length===1){
      const ex=withEve[0],prev=shiftDate(eveOf[ex.id],-1);
      if(dateSet.has(prev)&&!used.has(prev)&&inWindow(ex,prev)&&freeMin(prev)>=60)reserve(ex.id,prev);
    }
  }
  const examsWithEve=exams.filter(ex=>eveOf[ex.id]);

  // ── Allocate each exam's demand ───────────────────────────────────────────────────────────
  // The eve carries the bulk (~60%, up to EXAM_EVE_CAP / 7h). The lead-in day takes a lighter
  // slice (up to EXAM_DAILY_CAP / 3.5h) so homework due around then still fits on it. The eve
  // mops up any remainder, and only a genuinely large demand spills onto earlier shared days.
  const reservedExamDays={};  // EVES — exclusive: exam prep + only can't-wait homework, no Tier-2/projects
  const leadInExamDays={};    // LEAD-INS — exam prep gets its slice, then due homework fills the rest
  for(const ex of examsWithEve){
    const eve=eveOf[ex.id],leadIn=leadInOf[ex.id]||null;
    let remaining=ex._demand;
    const alloc={};
    const put=(d,want)=>{
      const take=Math.floor(Math.min(want,capLeft[d]-(alloc[d]||0),remaining)/15)*15;
      if(take>=15){alloc[d]=(alloc[d]||0)+take;remaining-=take;}
    };
    put(eve,Math.min(EXAM_EVE_CAP,Math.ceil(remaining*0.6/15)*15));
    if(leadIn)put(leadIn,EXAM_DAILY_CAP);
    if(remaining>=15)put(eve,EXAM_EVE_CAP-(alloc[eve]||0)); // eve soaks up the rest of its own capacity
    if(remaining>=15){
      const earlier=dateStrs
        .filter(d=>!used.has(d)&&!examDates.has(d)&&inWindow(ex,d))
        .sort((a,b)=>b.localeCompare(a));
      for(const d of earlier){
        if(remaining<15)break;
        put(d,EXAM_DAILY_CAP-(alloc[d]||0));
      }
    }
    if(remaining>=15)shortfalls.push({id:ex.id,shortfallMin:remaining});

    Object.entries(alloc).forEach(([d,m])=>{
      capLeft[d]-=m;
      byDate[d]=byDate[d]||{};
      byDate[d][ex.id]=(byDate[d][ex.id]||0)+m;
      if(m>=15){
        if(d===eve)reservedExamDays[d]=ex.id;
        else if(d===leadIn)leadInExamDays[d]=ex.id;
      }
    });
  }

  return{byDate,reservedExamDays,leadInExamDays,examDates,finalsStretch,shortfalls};
}

// Places up to `minutes` for ONE item into `gaps`, in presetLen chunks, respecting the energy-peak
// window order — the shared inner mechanic behind exam-prep placement and Tier-2 regular study.
// Mutates `gaps`. Returns { blocks, placed }.
function placeMinutes(gaps,minutes,presetLen,winOrder,winMap,meta,dateStr,seqRef,now){
  const blocks=[];
  let remaining=minutes,placed=0;
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
        blocks.push({id:`blk_${dateStr}_${Date.now()}_${seqRef.n++}`,courseId:meta.courseId,course:meta.courseName,
          source:meta.source,label:meta.label,description:"",s,e,kind:meta.kind,
          userEdited:false,completed:false,createdAt:now,editedAt:null,completedAt:null});
        const gi=gaps.findIndex(g=>g.s<=s&&g.e>=e);
        if(gi!==-1){
          const g=gaps[gi];const ng=[];
          if(g.s<s)ng.push({s:g.s,e:s});if(g.e>e)ng.push({s:e,e:g.e});
          gaps.splice(gi,1,...ng);
        }
        remaining-=chunk;placed+=chunk;cursor=e;
      }
    }
  }
  return{blocks,placed};
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
export function planDayV2(dateStr,itemState,data,gaps,seqRef,examPrep){
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

  // Exam-day = full rest (rule F). Nothing study-related is scheduled the day of an exam.
  if(examPrep?.examDates?.has(dateStr))return [];

  const reservedExamId=examPrep?.reservedExamDays?.[dateStr]||null; // this date is exam X's exclusive EVE (rule A)
  const leadInExamId=examPrep?.leadInExamDays?.[dateStr]||null;     // exam X's lead-in day — its prep, plus any due homework
  const inFinalsStretch=!!examPrep?.finalsStretch
    &&dateStr>=examPrep.finalsStretch.start&&dateStr<=examPrep.finalsStretch.end;

  // ── Exam prep — placed from the global pre-pass allocation (back-loaded, cross-exam
  //    prioritised). See buildExamPrepPlan. ──
  Object.entries(examPrep?.byDate?.[dateStr]||{}).forEach(([examId,minutes])=>{
    const it=itemState.find(x=>x.id===examId);
    if(!it||it.remainingMinutes<=0)return;
    const want=Math.min(minutes,it.remainingMinutes);
    const daysLeft=daysFrom(dateStr,it.dueDate);
    const label=daysLeft===1
      ?`${it.courseName} exam — final review`
      :`${it.courseName} exam prep (${daysLeft}d left)`;
    if(blocks.length)consumeTopicBuffer(gaps,blocks[blocks.length-1].e);
    const{blocks:exBlocks,placed}=placeMinutes(gaps,want,presetLen,winOrder,winMap,
      {courseId:it.courseId,courseName:it.courseName,source:it.source,kind:"study",label},dateStr,seqRef,now);
    blocks.push(...exBlocks);
    it.remainingMinutes-=placed;
    totalPlaced+=placed;
  });

  // ── Tier 1: HOMEWORK (exams are handled above by the pre-pass). ──
  // "Plan as late as needed, not as early as possible": a homework item within its eligible
  // window is only a REAL candidate today if today is actually needed to stay on pace for
  // finishing by due-2 — i.e. it has no slack left. On an exam's exclusive EVE, only homework
  // genuinely due within a day is allowed. On a lead-in day, normal homework runs — a due
  // assignment in the finals run-up must not be dropped for exam prep.
  const candidates=itemState.filter(it=>{
    if(it.kind!=="homework"||it.remainingMinutes<=0||!it.dueDate)return false;
    const daysOut=daysFrom(dateStr,it.dueDate);
    if(daysOut<STUDY_BUFFER_DAYS)return false; // never on/after the due date, forced or not
    if(reservedExamId)return daysOut<=1;        // exam eve — only can't-wait homework
    if(it.forced)return true;                   // pinned to "fill to 100%" — ignore window + slack
    if(daysOut>(it.startWindowDays??Infinity))return false;
    if(daysOut<PREFERRED_BUFFER_DAYS)return true;
    const remainingPreferredDays=daysOut-PREFERRED_BUFFER_DAYS+1;
    const roughDailyCapacity=DAILY_CAP*0.65;
    const daysNeededIfStartedNow=Math.ceil(it.remainingMinutes/roughDailyCapacity);
    return (remainingPreferredDays-daysNeededIfStartedNow)<=0; // no slack left — must start today
  });
  candidates.forEach(it=>{it.priority=it.forced?1e9:computePriorityScore(it.dueDate,it.effectiveDifficulty,it.weight,dateStr);});
  const byCourse={};
  candidates.forEach(it=>{
    if(!byCourse[it.courseId])byCourse[it.courseId]={courseId:it.courseId,courseName:it.courseName,items:[],priority:0};
    byCourse[it.courseId].items.push(it);
    byCourse[it.courseId].priority=Math.max(byCourse[it.courseId].priority,it.priority);
  });
  const courseList=Object.values(byCourse).sort((a,b)=>b.priority-a.priority);
  courseList.forEach(c=>{c.items.sort((a,b)=>b.priority-a.priority);});

  // On a lead-in day the exam prep already placed above shouldn't eat into homework's budget —
  // give homework its own full day's allowance on top (the day's real free gaps still bound it).
  const hwCeil=DAILY_CAP+(leadInExamId?totalPlaced:0);
  if(courseList.length&&totalPlaced<hwCeil){
    if(blocks.length)consumeTopicBuffer(gaps,blocks[blocks.length-1].e);
    const primary=courseList[0];
    const primaryBudget=Math.min(Math.round(DAILY_CAP*0.65),hwCeil-totalPlaced);
    const primaryBlocks=placeCourseBlocks(gaps,primary.items,primaryBudget,presetLen,winOrder,winMap,primary.courseId,primary.courseName,dateStr,seqRef,now);
    blocks.push(...primaryBlocks);
    totalPlaced+=primaryBlocks.reduce((s,b)=>s+(b.e-b.s),0);
    const secondary=courseList[1];
    if(secondary&&totalPlaced<hwCeil&&primaryBlocks.length){
      consumeTopicBuffer(gaps,primaryBlocks[primaryBlocks.length-1].e);
      const secondaryBlocks=placeCourseBlocks(gaps,secondary.items,hwCeil-totalPlaced,presetLen,winOrder,winMap,secondary.courseId,secondary.courseName,dateStr,seqRef,now);
      blocks.push(...secondaryBlocks);
      totalPlaced+=secondaryBlocks.reduce((s,b)=>s+(b.e-b.s),0);
    }
  }

  // ── Lead-in top-up: the pre-pass only pencils a light 3.5h of prep onto a lead-in day so
  //    homework fits. If that exam would otherwise come up SHORT — its remaining demand exceeds
  //    everything still planned for it on later days (its eve + any spill) — spend this day's
  //    leftover time (now that due homework has taken its share) on more of its prep rather than
  //    leave the evening idle. A fully-covered exam is left alone. ──
  if(leadInExamId){
    const it=itemState.find(x=>x.id===leadInExamId);
    const futureAlloc=Object.keys(examPrep.byDate||{})
      .filter(d=>d>dateStr)
      .reduce((s,d)=>s+(examPrep.byDate[d][leadInExamId]||0),0);
    const surplus=it?Math.min(it.remainingMinutes-futureAlloc,EXAM_EVE_CAP-totalPlaced):0;
    if(it&&surplus>=15){
      const daysLeft=daysFrom(dateStr,it.dueDate);
      if(blocks.length)consumeTopicBuffer(gaps,blocks[blocks.length-1].e);
      const{blocks:exBlocks,placed}=placeMinutes(gaps,surplus,presetLen,winOrder,winMap,
        {courseId:it.courseId,courseName:it.courseName,source:it.source,kind:"study",
         label:`${it.courseName} exam prep (${daysLeft}d left)`},dateStr,seqRef,now);
      blocks.push(...exBlocks);
      it.remainingMinutes-=placed;
      totalPlaced+=placed;
    }
  }

  // ── Projects: steady even-pace work, starting from the day they're assigned. ──
  // A project is NOT slack-deferred like homework — leaving a term paper to its last few days is
  // exactly the problem. Each day it takes remaining ÷ days-left-to-target (target = due minus a
  // ~15% finish buffer), a low, self-correcting rate: skip a day and the rate ticks up. Runs after
  // real near-term deadlines, before generic regular study, and keeps going through finals week
  // (a project due then still needs work) — but not on any of an exam's dedicated days (rule A).
  if(totalPlaced<DAILY_CAP&&!reservedExamId&&!leadInExamId){
    const projects=itemState.filter(it=>it.kind==="project"&&it.remainingMinutes>0&&it.dueDate)
      .sort((a,b)=>a.dueDate.localeCompare(b.dueDate)); // soonest-due project first
    for(const pr of projects){
      if(totalPlaced>=DAILY_CAP)break;
      const daysToDue=daysFrom(dateStr,pr.dueDate);
      if(daysToDue<STUDY_BUFFER_DAYS)continue; // never on/after the due date
      const buffer=Math.max(PROJECT_FINISH_BUFFER_MIN_DAYS,Math.round(daysToDue*PROJECT_FINISH_BUFFER_FRAC));
      const daysToTarget=Math.max(1,daysToDue-buffer); // in the buffer tail this is 1 ⇒ "place what's left"
      const dailyTarget=Math.ceil(pr.remainingMinutes/daysToTarget/15)*15;
      const budget=Math.min(dailyTarget,pr.remainingMinutes,DAILY_CAP-totalPlaced);
      if(budget<15)continue;
      if(blocks.length)consumeTopicBuffer(gaps,blocks[blocks.length-1].e);
      const label=`${pr.courseName.split("(")[0].trim()} — ${pr.title} (project)`;
      const{blocks:prBlocks,placed}=placeMinutes(gaps,budget,presetLen,winOrder,winMap,
        {courseId:pr.courseId,courseName:pr.courseName,source:pr.source,kind:"project",label},dateStr,seqRef,now);
      blocks.push(...prBlocks);
      pr.remainingMinutes-=placed;
      totalPlaced+=placed;
    }
  }

  // ── Tier 2: regular per-course study fills any leftover capacity — but NOT on any of an exam's
  //    dedicated days (rule A) and NOT anywhere inside the finals stretch (rule E). ──
  if(totalPlaced<DAILY_CAP&&!reservedExamId&&!leadInExamId&&!inFinalsStretch){
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
export function preflightRiskCheck(dateStrs,itemState,gapsByDay,examPrep){
  const STUDY_BUFFER_DAYS=1;
  const pool={};
  dateStrs.forEach(d=>{
    let free=(gapsByDay[d]||[]).reduce((sum,g)=>sum+(g.e-g.s),0);
    // Exam prep is already reserved by the pre-pass — that time isn't available to homework.
    if(examPrep)free-=Object.values(examPrep.byDate?.[d]||{}).reduce((s,m)=>s+m,0);
    pool[d]=Math.max(0,free);
  });
  // With a pre-pass, exams are its responsibility — only homework is greedily checked here.
  const sorted=itemState.filter(it=>it.remainingMinutes>0&&it.dueDate&&(!examPrep||it.source?.type!=="exam"))
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
  // Exam-prep shortfalls the pre-pass couldn't fit (window too tight, no free capacity) surface
  // through the same channel so they're never silent.
  (examPrep?.shortfalls||[]).forEach(sf=>{
    const it=itemState.find(x=>x.id===sf.id);
    risks.push({id:sf.id,rawId:it?.rawId,kind:it?.kind||"study",courseName:it?.courseName,
      title:it?.title||"Exam",shortfallMin:sf.shortfallMin,desiredMinutes:it?.remainingMinutes??sf.shortfallMin});
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
  // Exam prep is decided globally first (back-loaded toward each exam, prioritised across exams),
  // then day-by-day planning places those allocations and fills the rest around them.
  const examPrep=buildExamPrepPlan(dateStrs,itemState,gapsByDay);
  const risks=preflightRiskCheck(dateStrs,itemState,gapsByDay,examPrep);

  const blocksByDate={};
  dateStrs.forEach(dateStr=>{
    const gaps=gapsByDay[dateStr];
    const generated=planDayV2(dateStr,itemState,data,gaps,seqRef,examPrep);
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
