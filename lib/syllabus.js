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
