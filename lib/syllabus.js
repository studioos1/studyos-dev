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
    if((c.exams||[]).length>6)
      issues.push({level:"warn",msg:`${c.exams.length} exams for "${name}" — weekly quizzes may be mislabeled as exams.`});

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
  return{issues};
}

// Deterministic safety net, run on every AI extraction response before saving — the AI is
// generative and won't always classify items identically between calls (e.g. it has sometimes
// put weekly reading/lecture quizzes in "exams" instead of "assignments", even with prompt
// instructions saying not to). Rather than relying purely on the prompt to prevent this, this
// function re-checks every item the AI put in "exams" and moves anything that's clearly a quiz —
// not a Midterm or Final — into "assignments", guaranteeing correctness in code rather than
// hoping the model gets it right. Only fires on the specific quiz-vs-exam ambiguity; anything
// else the AI classified as an exam is trusted as-is.
export function reclassifyMisplacedQuizzes(courses){
  const isRealExam=title=>/\b(midterm|final)\b/i.test(title||"");
  const looksLikeQuiz=title=>/\bquiz(zes)?\b/i.test(title||"");
  let moved=0;
  const fixed=(courses||[]).map(c=>{
    const exams=c.exams||[];
    const assignments=c.assignments||[];
    const keepExams=[],demoted=[];
    exams.forEach(e=>{
      if(looksLikeQuiz(e.title)&&!isRealExam(e.title)){demoted.push(e);moved++;}
      else keepExams.push(e);
    });
    if(demoted.length===0)return c;
    return{
      ...c,
      exams:keepExams,
      assignments:[...assignments,...demoted.map(e=>({title:e.title,dueDate:e.date,estimatedHours:0.5,weight:e.weight??null}))],
    };
  });
  return{courses:fixed,moved};
}
