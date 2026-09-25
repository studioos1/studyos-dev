import { courseCode, findMatchingCourse } from "@/lib/courses";
import { t2m } from "@/lib/time";

// ── AI EXTRACTION SANITY CHECKS ──────────────────────────────────────────────
// The AI reads the PDF; it is generative and sometimes returns nonsense (a heading mistaken for
// a course, a date with the wrong year, a course name that's a whole sentence). These run on the
// parsed result BEFORE anything is shown for import, and surface anything that looks wrong so the
// student can re-upload (which re-calls the API) rather than silently saving a bad read. Purely
// deterministic — no second AI call. Each issue is { level: "error" | "warn", msg }.
//   error = almost certainly a misread — re-upload strongly suggested.
//   warn  = worth checking before importing.

// A real course code is a 2-6 letter department abbreviation next to a 1-4 digit number
// ("MATH 20C", "DSC10", "MMW 121"). The blocklist rejects the English phrases the model most
// often mistakes for one when it grabs a heading instead of a course ("Week 1", "Part 2",
// "Fall 2026", "Session 3").
const CODE_RE=/\b([A-Za-z]{2,6})\s*-?\s*\d{1,4}[A-Za-z]{0,2}\b/;
const NOT_CODE_WORDS=/^(week|part|unit|day|days|session|module|chapter|lecture|lab|fall|winter|spring|summer|autumn|quarter|semester|section|page|pages|room|building|hall|topic|note|notes|version|figure|table)$/i;
const hasCourseCode=s=>{const m=String(s||"").match(CODE_RE);return !!m&&!NOT_CODE_WORDS.test(m[1]);};
const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
const shiftISO=(d,days)=>{const x=new Date(d+"T00:00:00");if(isNaN(x))return d;x.setDate(x.getDate()+days);return x.toISOString().slice(0,10);};
const clip=s=>{s=String(s||"");return s.length>48?s.slice(0,45)+"…":s;};

// ── COMPLETENESS SIGNAL (recall-side safety net) ─────────────────────────────
// The checks above catch the AI extracting too much / wrong (a hallucinated item, a bad
// classification). This is the opposite direction: catching the AI silently dropping something
// real. Purely deterministic — a regex scan of the raw source text for a date sitting near
// graded-item language (quiz/exam/homework/due/%/etc.), cross-referenced against what actually
// got extracted. Approximate by design (a heuristic pattern match, not real language
// understanding) — every result is worded as "worth checking", never asserted as a confirmed miss.
const MONTHS_RE="January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec";
const MONTH_INDEX={january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,september:8,october:9,november:10,december:11,jan:0,feb:1,mar:2,apr:3,jun:5,jul:6,aug:7,sept:8,sep:8,oct:9,nov:10,dec:11};
const DATE_SIGNAL_RE=new RegExp(`\\b(${MONTHS_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`,"gi");
const ITEM_KEYWORD_RE=/\b(quiz|exam|midterm|final|homework|lab|project|assignment|problem\s*set|paper|presentation|due|deadline|submission|deliverable)\b/i;

// Turns a bare "Month Day" match into the most plausible ISO date near `refDate` (the term start,
// or today as a fallback) — tries the reference year, one before, and one after, picking whichever
// lands closest. Approximate on purpose: this only needs to be close enough to cross-reference
// against real extracted dates, not authoritative.
function nearestISO(month,day,refDate){
  const ref=new Date(refDate+"T00:00:00");
  if(isNaN(ref))return null;
  let best=null,bestDiff=Infinity;
  for(const y of[ref.getFullYear()-1,ref.getFullYear(),ref.getFullYear()+1]){
    const d=new Date(y,month,day);
    if(isNaN(d)||d.getMonth()!==month)continue; // rejects invalid dates like Feb 30
    const diff=Math.abs(d-ref);
    if(diff<bestDiff){bestDiff=diff;best=d;}
  }
  if(!best)return null;
  return`${best.getFullYear()}-${String(best.getMonth()+1).padStart(2,"0")}-${String(best.getDate()).padStart(2,"0")}`;
}

// text = raw source text actually sent to the AI (all files, whatever was extracted from the
// PDF(s)). refDate = an ISO date to anchor bare "Month Day" mentions to. Returns one entry per
// distinct plausible date found near graded-item language, deduplicated by that resolved date.
export function scanForDatedItemSignals(text,refDate){
  if(!text)return[];
  const anchor=DATE_RE.test(refDate||"")?refDate:new Date().toISOString().slice(0,10);
  const out=[],seen=new Set();
  let m;
  DATE_SIGNAL_RE.lastIndex=0;
  while((m=DATE_SIGNAL_RE.exec(text))){
    const idx=m.index;
    const window=text.slice(Math.max(0,idx-100),idx+100);
    if(!ITEM_KEYWORD_RE.test(window))continue;
    const month=MONTH_INDEX[m[1].toLowerCase()];
    const day=+m[2];
    if(month==null||!day||day>31)continue;
    const isoDate=nearestISO(month,day,anchor);
    if(!isoDate||seen.has(isoDate))continue;
    seen.add(isoDate);
    out.push({date:isoDate,snippet:window.replace(/\s+/g," ").trim()});
  }
  return out;
}

// parsed = { courses: [{ name, code, days, startTime, endTime, format }] } from the schedule prompt.
export function checkScheduleExtraction(parsed){
  const issues=[];
  const courses=parsed?.courses||[];
  if(!courses.length){issues.push({level:"error",msg:"No classes were extracted from this PDF."});return{issues};}
  if(courses.length>12)issues.push({level:"warn",msg:`${courses.length} classes extracted — unusually many; check for duplicate or junk rows.`});

  const codeCounts={};
  courses.forEach(c=>{
    const label=clip(c.name||c.code||"(unnamed class)");
    const hay=`${c.code||""} ${c.name||""}`;
    if(!hasCourseCode(hay))
      issues.push({level:"error",msg:`"${label}" has no recognizable course code (like "MATH 20C") — likely a misread.`});
    else{
      const code=courseCode(hay);
      if(code)codeCounts[code]=(codeCounts[code]||0)+1;
    }
    if((c.name||"").length>45)
      issues.push({level:"warn",msg:`"${label}" — class name is very long; expected a short code.`});

    const isAsync=/async/i.test(c.format||"");
    if(!isAsync){
      const days=c.days;
      if(!Array.isArray(days)||!days.length||days.some(d=>!(d>=0&&d<=6)))
        issues.push({level:"warn",msg:`"${label}" has no valid class days.`});
      const tOk=s=>/^\d{1,2}:\d{2}$/.test(s||"");
      if(!tOk(c.startTime)||!tOk(c.endTime))
        issues.push({level:"warn",msg:`"${label}" has an unreadable class time.`});
      else if(t2m(c.endTime)<=t2m(c.startTime))
        issues.push({level:"warn",msg:`"${label}" ends before it starts (${c.startTime}–${c.endTime}).`});
    }
  });
  Object.entries(codeCounts).forEach(([code,n])=>{
    if(n>1)issues.push({level:"warn",msg:`${n} classes share the code ${code} — possible duplicate.`});
  });
  return{issues};
}

// parsed = { courses: [{ courseName, assignments:[{title,dueDate,weight}], exams:[{title,date,weight}] }] }
// opts   = { courses (imported), termStart, termEnd } — all optional.
export function checkSyllabusExtraction(parsed,opts={}){
  const {courses=[],termStart,termEnd}=opts;
  const issues=[];
  const list=parsed?.courses||[];
  if(!list.length){issues.push({level:"error",msg:"Nothing was extracted from the syllabus."});return{issues};}

  const lo=termStart&&DATE_RE.test(termStart)?shiftISO(termStart,-14):null;
  const hi=termEnd&&DATE_RE.test(termEnd)?shiftISO(termEnd,14):null;
  let badDates=0,outOfTerm=0;

  list.forEach(c=>{
    const name=clip(c.courseName||"(unnamed course)");
    if(!hasCourseCode(c.courseName))
      issues.push({level:"error",msg:`"${name}" is not a recognizable course code — likely a misread.`});
    if(courses.length&&c.courseName&&!findMatchingCourse(courses,c.courseName))
      issues.push({level:"warn",msg:`"${name}" isn't one of your imported classes — its items would be skipped. Import your schedule first, or fix the name.`});

    const items=[
      ...(c.assignments||[]).map(a=>({t:a.title,d:a.dueDate,w:a.weight})),
      ...(c.exams||[]).map(e=>({t:e.title,d:e.date,w:e.weight})),
    ];
    if(!items.length)
      issues.push({level:"warn",msg:`No assignments or exams were found for "${name}".`});
    // Hallucination guard: several items that look like a numbered/recurring series (same base
    // title, e.g. "Homework 1"/"Homework 2") sharing the IDENTICAL due date. A real weekly series
    // should have different dates week to week — when a syllabus describes a recurring category in
    // general terms without ever stating individual dates (a real, seen shape: "Labs due weekly,
    // see the course website for the exact schedule"), the extraction prompt's "extract every /
    // count them" instructions can still pressure the model into inventing a full dated schedule
    // rather than correctly returning none — and a degenerate way to satisfy "return N entries"
    // without real per-item dates to draw on is to reuse one guessed date for all of them. This
    // catches that shape deterministically rather than trusting the prompt alone to avoid it.
    const baseTitle=s=>String(s||"").replace(/\s*#?\d+\s*$/,"").trim().toLowerCase();
    const seriesByDate={};
    items.forEach(it=>{
      if(!DATE_RE.test(it.d||""))return;
      const b=baseTitle(it.t);
      if(!b)return;
      const key=`${b}|${it.d}`;
      (seriesByDate[key]=seriesByDate[key]||[]).push(it.t);
    });
    Object.entries(seriesByDate).forEach(([key,titles])=>{
      if(titles.length<3)return;
      const [base,date]=key.split("|");
      issues.push({level:"error",msg:`"${name}": ${titles.length} items named like "${base} N" all share the same date (${date}) — likely a guessed schedule, not real dates from the document. Re-upload, or check the source for a separate calendar page with the real per-item dates.`});
    });
    // "exams" now legitimately includes quizzes alongside Midterms/Finals (see
    // reclassifyQuizzesAsExams) — a course with 4+ quizzes plus 2 real exams routinely clears 6,
    // so this is a generous sanity ceiling against genuine over-extraction (e.g. every weekly
    // homework misclassified as an exam), not a "quizzes shouldn't be here" flag.
    if((c.exams||[]).length>15)
      issues.push({level:"warn",msg:`${c.exams.length} exams for "${name}" (quizzes included) — worth a quick check that nothing's double-counted.`});

    let wSum=0;
    items.forEach(it=>{
      if(!DATE_RE.test(it.d||""))badDates++;
      else if(lo&&hi&&(it.d<lo||it.d>hi))outOfTerm++;
      if(it.w!=null&&Number.isFinite(+it.w)){
        if(it.w<0||it.w>100)issues.push({level:"warn",msg:`"${name}": "${clip(it.t||"untitled")}" has an out-of-range weight (${it.w}%).`});
        wSum+=+it.w;
      }
    });
    if(wSum>135)
      issues.push({level:"warn",msg:`Grade weights for "${name}" add up to ${Math.round(wSum)}% — check for double-counted items.`});
  });

  if(badDates)
    issues.push({level:"warn",msg:`${badDates} item${badDates>1?"s have":" has"} an unreadable date.`});
  if(outOfTerm)
    issues.push({level:"warn",msg:`${outOfTerm} due date${outOfTerm>1?"s fall":" falls"} outside your term${termStart&&termEnd?` (${termStart} – ${termEnd})`:""} — check the year.`});

  // Recall-side completeness check (see scanForDatedItemSignals above) — spans the whole document,
  // not one course at a time, since sourceText isn't split per course. Every extracted due date
  // across every course counts toward "already covered"; anything the scan finds that isn't
  // covered gets one issue each (capped, like other multi-item summaries in this app), naming the
  // actual date and a snippet so it's something the student can go verify, not just a raw count.
  if(opts.sourceText){
    const covered=new Set();
    list.forEach(c=>{
      (c.assignments||[]).forEach(a=>{if(DATE_RE.test(a.dueDate||""))covered.add(a.dueDate);});
      (c.exams||[]).forEach(e=>{if(DATE_RE.test(e.date||""))covered.add(e.date);});
    });
    const signals=scanForDatedItemSignals(opts.sourceText,termStart);
    const missed=signals.filter(s=>!covered.has(s.date));
    missed.slice(0,5).forEach(s=>{
      issues.push({level:"warn",msg:`The source mentions "${s.snippet}" — ${s.date} doesn't match any extracted item's date. Worth a quick check it wasn't missed (or is just phrased/dated differently than expected).`});
    });
    if(missed.length>5)
      issues.push({level:"warn",msg:`+${missed.length-5} more date${missed.length-5>1?"s":""} mentioned near assignment/exam language that don't match an extracted item.`});
  }
  return{issues};
}

// Deterministic safety net, run on every AI extraction response before saving — the AI is
// generative and won't always classify items identically between calls. Quizzes are graded,
// timed, in-class assessments (same category as Midterms/Finals), so they belong in "exams" —
// "assignments" is reserved for take-home coursework: problem sets, homework, labs, projects.
// Real request that set this direction: "it classified 'Quiz' as Homework, shall be an exam."
// (Earlier in the project this ran the opposite way, demoting quiz-titled "exams" down into
// "assignments" — reversed for the same reason, on direct instruction.) Rather than relying
// purely on the prompt to get this right, this function re-checks every item the AI put in
// "assignments" and promotes anything that's clearly a quiz — not a Problem Set, Homework, Lab,
// or Project — into "exams", guaranteeing correctness in code rather than hoping the model gets
// it right. Only fires on the specific quiz-vs-coursework ambiguity; anything else the AI
// classified as an assignment is trusted as-is. A promoted quiz gets a short prepDays (3) rather
// than a Midterm/Final's — it's a low-stakes, low-prep in-class check, not a major exam.
export function reclassifyQuizzesAsExams(courses){
  const looksLikeQuiz=title=>/\bquiz(zes)?\b/i.test(title||"");
  let moved=0;
  const fixed=(courses||[]).map(c=>{
    const assignments=c.assignments||[];
    const exams=c.exams||[];
    const keepAssignments=[],promoted=[];
    assignments.forEach(a=>{
      if(looksLikeQuiz(a.title)){promoted.push(a);moved++;}
      else keepAssignments.push(a);
    });
    if(promoted.length===0)return c;
    return{
      ...c,
      assignments:keepAssignments,
      exams:[...exams,...promoted.map(a=>({title:a.title,date:a.dueDate,topics:"",prepDays:3,weight:a.weight??null}))],
    };
  });
  return{courses:fixed,moved};
}

// ── RECURRING SERIES EXPANSION ────────────────────────────────────────────────
// A real, common syllabus shape this app has to handle correctly: "Labs are due weekly on
// Tuesdays" / "Homeworks are due weekly on Thursdays" — a real, explicitly stated PATTERN (which
// weekday, what the category is worth in total), just without individual calendar dates for each
// occurrence. That is NOT the same situation the anti-hallucination rule (rule 9 in the extraction
// prompt, and the same-date-series guard above) protects against — inventing a plausible-looking
// date is a guess; the weekday itself is not a guess, it's what the document says. So this doesn't
// belong to the AI to fill in (still no per-item dates to draw on, same risk of it just repeating
// one guessed date) OR to silently drop (the student's real answer: "let's make sure we're setting
// them"). It's a job for deterministic date math instead, exactly like this app already treats
// every other date-derived thing (planningRange, scrubTermSchedule, etc.) — walk the real term
// calendar and place one instance on each matching weekday.
//
// series = {title, dayOfWeek (0-6), weightTotal, category} from the AI's own "recurringSeries"
// field (extraction prompt rule 11) — never a date, only the recurring pattern.
// bounds  = {termStart, lastDeadline} — ISO dates. Generation begins at the first occurrence of
// dayOfWeek that's at least MIN_LEAD_DAYS after termStart (nothing can realistically be due before
// the course has even released material for it) and ends strictly before lastDeadline (nothing
// routine is normally due on or after the course's own last real exam/deadline — falls back to
// termStart+119 days, ~17 weeks, i.e. a generous full-term ceiling, only if no deadline is known at
// all). Generalized — no course-specific tuning; every constant here is a stated, defensible
// default, not something inferred from this one syllabus.
const MIN_LEAD_DAYS=6;

export function expandRecurringSeries(series,bounds={}){
  const{termStart,lastDeadline}=bounds;
  if(!DATE_RE.test(termStart||""))return[];
  const start=new Date(termStart+"T00:00:00");
  const end=lastDeadline&&DATE_RE.test(lastDeadline)?new Date(lastDeadline+"T00:00:00"):new Date(start.getTime()+119*864e5);
  const out=[];
  (series||[]).forEach(s=>{
    const day=s.dayOfWeek;
    if(!Number.isInteger(day)||day<0||day>6)return;
    // First candidate: the earliest occurrence of `day` on/after termStart.
    const first=new Date(start);
    first.setDate(first.getDate()+((day-first.getDay()+7)%7));
    // Skip it if it lands inside the lead-in window — move to the following week instead.
    if((first-start)/864e5<MIN_LEAD_DAYS)first.setDate(first.getDate()+7);
    const dates=[];
    for(const d=new Date(first);d<end;d.setDate(d.getDate()+7))dates.push(new Date(d));
    if(!dates.length)return;
    const weight=Number.isFinite(+s.weightTotal)?+s.weightTotal/dates.length:null;
    dates.forEach((d,i)=>{
      out.push({
        title:`${s.title} ${i+1}`,
        dueDate:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`,
        weight:weight!=null?Math.round(weight*10)/10:null,
        generated:true, // flagged for the verify screen — never persisted past that step
      });
    });
  });
  return out;
}

// Applies expandRecurringSeries across a whole parsed courses[] array (the AI's "recurringSeries"
// field on each course), merging the generated items into that course's own "assignments" and
// dropping the now-consumed "recurringSeries" field — the same shape-in, shape-out pattern as
// reclassifyQuizzesAsExams above, so every call site treats this as one more deterministic
// post-processing pass over the same courses[] structure. termEnd is the fallback bound when a
// course has no exams of its own to anchor the end date to.
export function applyRecurringSeries(courses,{termStart,termEnd}={}){
  let generated=0;
  const fixed=(courses||[]).map(c=>{
    const series=c.recurringSeries;
    if(!series||!series.length)return{...c,recurringSeries:undefined};
    const lastDeadline=(c.exams||[]).map(e=>e.date).filter(d=>DATE_RE.test(d||"")).sort().pop()||termEnd;
    const items=expandRecurringSeries(series,{termStart,lastDeadline});
    generated+=items.length;
    return{...c,assignments:[...(c.assignments||[]),...items],recurringSeries:undefined};
  });
  return{courses:fixed,generated};
}

// ── DUPLICATE DETECTION ──────────────────────────────────────────────────────
// Re-uploading a syllabus (the same one twice, or a revised version) is common, and Acad.jsx's
// finalizeSync already has an exact title+date match to skip true duplicates — but that misses
// real duplicates whenever the AI's extraction wording drifts even slightly between two separate
// parses of the same PDF ("Problem Set 5" vs "Problem Set #5", a date reformatted a day off).
// This is a looser, still-fully-deterministic match used to FLAG probable duplicates for the
// student to resolve in ExtractionVerifyModal (keep both / keep the new one / skip it) —
// visibility and a real choice was the actual ask, not a different auto-skip.

// Strips everything but letters/digits so formatting differences ("Problem Set #5" vs "Problem
// Set 5") don't defeat the match. Exported for tests.
export function coreNorm(s){return String(s||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();}

function datesCloseOrEqual(a,b,maxDays){
  if(!a||!b)return false;
  if(a===b)return true;
  const diff=Math.abs((new Date(a+"T00:00:00")-new Date(b+"T00:00:00"))/864e5);
  return Number.isFinite(diff)&&diff<=maxDays;
}

// existingList: data.assignments or data.exams — NOT pre-filtered by course, this checks
// courseId itself. dateField is "dueDate" for assignments, "date" for exams (the two lists use
// different field names for the same concept). Returns the matching existing item, or null.
// Deliberately conservative — a false "probable duplicate" costs the student one extra click to
// dismiss it; a missed one is exactly the bug being fixed, so title-anchored rules only (no
// date-only matching, which is how the OLD exam dedup could conflate two unrelated exams that
// happened to land on the same day).
export function findProbableDuplicate(existingList,courseId,title,date,dateField){
  const ct=coreNorm(title);
  if(!ct||!date)return null;
  return (existingList||[]).find(x=>{
    if(x.courseId!==courseId)return false;
    const xDate=x[dateField];
    if(!xDate)return false;
    const xt=coreNorm(x.title);
    if(!xt)return false;
    // Same title (formatting aside) with a due date within a few days — a syllabus revision that
    // shifted a deadline slightly, or a date reformatted a day off.
    if(xt===ct&&datesCloseOrEqual(xDate,date,3))return true;
    // Exact same date with one title clearly containing the other — wording drift on
    // re-extraction ("Problem Set 5" vs "Problem Set 5 (Ch 3-4)").
    if(xDate===date&&(xt.includes(ct)||ct.includes(xt)))return true;
    return false;
  })||null;
}
