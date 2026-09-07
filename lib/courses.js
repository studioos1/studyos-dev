// The ONE canonical display form for a course: its department code, e.g. "MATH 180A". Every
// account — old or freshly extracted — resolves to the same short string, so tables never blow
// out on a 35-char AI title like "Introduction to Probability (MATH 180A)". Falls back to the
// name as-is only when there's genuinely no code pattern in it.
export function prettyCourseCode(name){
  const s=String(name||"").trim();
  if(!s)return s;
  const m=s.match(/\(([A-Za-z]{2,6})\s*-?\s*(\d{1,4})([A-Za-z]{0,2})\)/)   // "Title (MATH 180A)"
       || s.match(/^([A-Za-z]{2,6})\s*-?\s*(\d{1,4})([A-Za-z]{0,2})\b/);   // "MATH 180A …"
  return m?`${m[1].toUpperCase()} ${m[2]}${m[3].toUpperCase()}`:s;
}

// Display-name lookup for an assignment/exam by its courseId — the single place every UI/planner
// read site should go through, instead of trusting a re-typed course string.
export function courseNameFor(courses,courseId){
  const c=courses.find(x=>x.id===courseId);
  return c?prettyCourseCode(c.name):"(unknown course)";
}

// Normalizes text for fuzzy-safe duplicate comparisons (case/whitespace-insensitive).
export function norm(s){return(s||"").toLowerCase().trim().replace(/\s+/g," ");}
// Extracts a stable course code (e.g. "DSC10", "MMW122", "MATH180A") from a free-text course name,
// so course matching survives AI wording variance ("DSC 10" vs "DSC 10 — Principles of Data Science"
// vs "Data Science (DSC 10)"). This is the actual identity key — full display names are not stable
// across separate AI extraction calls, but the department+number code is.
export function courseCode(name){
  if(!name)return"";
  const m=String(name).match(/([A-Za-z]{2,6})\s*-?\s*(\d{1,3})\s*([A-Za-z]?)/);
  if(!m)return norm(name); // fallback: no recognizable code pattern, use normalized full name
  return (m[1]+m[2]+m[3]).toUpperCase().replace(/\s+/g,"");
}
// Find an existing course matching this extracted name/code, or null if genuinely new.
export function findMatchingCourse(courses,extractedName){
  const code=courseCode(extractedName);
  return courses.find(c=>courseCode(c.name)===code)||null;
}
