// Ceiling on how much of one PDF's extracted text gets sent to the AI extraction prompt
// (Onboard's parseSyl, Acad's syncSyl/rawExtract all slice to this). This is a safety valve
// against a truly degenerate document (e.g. garbage OCR text from a scanned/image-only PDF),
// NOT a real content limit — Claude's context window comfortably fits far more than this as
// input. Confirmed too low once already at the old 16,000: a real 23-page UCSD syllabus (a
// Notion-style "Course Info" page — long policy/logistics prose before the schedule) extracted
// to 40,616 characters, and 16,000 landed mid-page-9, before the Exams/Quizzes section, the
// Weekly Schedule, and the Grades weight table ever reached the model — the exact shape of a
// real, reported bug ("the doc we uploaded... include only few HW, no tests"). Sized with
// generous headroom above any real syllabus seen so far, not tuned to that one document.
export const MAX_SYLLABUS_CHARS=120000;

// Extracts plain text from a PDF file using pdf.js (loaded globally via next/script in
// app/layout.jsx). Used by both Onboard (schedule/syllabus upload) and Academics' syllabus sync.
export async function PDF(file){
  if(!window.pdfjsLib)pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const buf=await file.arrayBuffer();const pdf=await pdfjsLib.getDocument({data:buf}).promise;
  let t="";for(let i=1;i<=pdf.numPages;i++){const p=await pdf.getPage(i);const c=await p.getTextContent();t+="\n"+c.items.map(x=>x.str).join(" ");}
  return t.trim();
}
