// College search + calendar lookup — the pure/network half of the college-picking flow.
// The presentational half (the autocomplete input itself) lives in
// components/shared/CollegeAutocomplete.jsx and imports generateAcronym/searchColleges from here.

const COLLEGE_STOPWORDS=new Set(["of","the","and","at","in","for"]);
export function generateAcronym(name){
  // Strip parenthetical/comma suffixes but keep the words themselves — the acronym students
  // actually type ("UCSD") comes from the FULL name including "San Diego", not just
  // "University of California".
  return name
    .replace(/[,()]/g," ")
    .split(/\s+/)
    .filter(w=>w&&!COLLEGE_STOPWORDS.has(w.toLowerCase()))
    .map(w=>w[0])
    .join("")
    .toLowerCase();
}
// colleges: [{name, domain}], pre-indexed with acronym once by the caller (see
// CollegeAutocomplete's useEffect) — not recomputed per keystroke.
export function searchColleges(indexed,query,limit=8){
  const q=query.trim().toLowerCase();
  if(!q)return[];
  const acronymMatch=[],starts=[],contains=[];
  for(const c of indexed){
    const name=c.name.toLowerCase();
    if(c.acronym===q)acronymMatch.push(c);
    else if(name.startsWith(q))starts.push(c);
    else if(name.includes(q))contains.push(c);
  }
  acronymMatch.sort((a,b)=>a.name.localeCompare(b.name));
  starts.sort((a,b)=>a.name.localeCompare(b.name));
  contains.sort((a,b)=>a.name.localeCompare(b.name));
  return[...acronymMatch,...starts,...contains].slice(0,limit);
}

// Calls the server's web-search-backed college calendar lookup. Used wherever a college gets
// selected (onboarding, Settings) — one shared function so both call sites stay in sync.
export async function fetchCollegeCalendar(schoolName){
  const res=await fetch("/api/college-calendar",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({schoolName}),
  });
  if(!res.ok){
    const err=await res.json().catch(()=>({}));
    throw new Error(err.error||"Lookup failed");
  }
  return await res.json();
}
// Applies a fetchCollegeCalendar() result to the profile — shared so onboarding and Settings
// populate fields identically. Only fills in what actually came back; leaves anything the lookup
// couldn't find (null) untouched rather than overwriting a field with nothing.
export function applyCollegeCalendarResult(result,updP){
  const patch={};
  if(result.address)patch.schoolAddress=result.address;
  if(result.scheduleType==="quarter"||result.scheduleType==="semester")patch.schoolType=result.scheduleType;
  if(result.termStart)patch.termStart=result.termStart;
  if(result.termEnd)patch.termEnd=result.termEnd;
  if(result.termStart&&result.termEnd){
    patch.collegeCalendar={
      quarters:[{name:result.termName||"Current term",start:result.termStart,end:result.termEnd}],
      holidays:Array.isArray(result.holidays)?result.holidays:[],
      source:result.sourceUrl||null,fetchedAt:new Date().toISOString(),
    };
  }
  updP(patch);
}
