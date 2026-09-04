import { iso } from "@/lib/time";

// ── US federal holidays — rule-based (nth-weekday/fixed-date + weekend observance), not
// hardcoded per-year, so this never goes stale. Serves as the ALWAYS-ON baseline "no school at
// minimum" — a specific college's actual calendar (fetched separately, see collegeCalendar below)
// can add school-specific closures on top of this, but this baseline never depends on that fetch
// having succeeded.
export function nthWeekdayOfMonth(year,month,weekday,n){
  const d=new Date(year,month,1);let count=0;
  while(true){if(d.getDay()===weekday){count++;if(count===n)return d.toISOString().split("T")[0];}d.setDate(d.getDate()+1);}
}
function lastWeekdayOfMonth(year,month,weekday){
  const d=new Date(year,month+1,0);while(d.getDay()!==weekday)d.setDate(d.getDate()-1);return d.toISOString().split("T")[0];
}
function observedFixedDate(year,month,day){
  const d=new Date(year,month,day);const dow=d.getDay();
  if(dow===6)d.setDate(d.getDate()-1);if(dow===0)d.setDate(d.getDate()+1);
  return d.toISOString().split("T")[0];
}
export function usFederalHolidays(year){
  return{
    [observedFixedDate(year,0,1)]:"New Year's Day",
    [nthWeekdayOfMonth(year,0,1,3)]:"Martin Luther King Jr. Day",
    [nthWeekdayOfMonth(year,1,1,3)]:"Presidents' Day",
    [lastWeekdayOfMonth(year,4,1)]:"Memorial Day",
    [observedFixedDate(year,5,19)]:"Juneteenth",
    [observedFixedDate(year,6,4)]:"Independence Day",
    [nthWeekdayOfMonth(year,8,1,1)]:"Labor Day",
    [nthWeekdayOfMonth(year,10,4,4)]:"Thanksgiving",
    [observedFixedDate(year,11,25)]:"Christmas Day",
  };
}
const _federalHolidayCache={};
export function federalHolidayName(dateStr){
  const year=+dateStr.slice(0,4);
  if(!_federalHolidayCache[year])_federalHolidayCache[year]=usFederalHolidays(year);
  return _federalHolidayCache[year][dateStr]||null;
}

// Generic term/holiday lookups — work for ANY college, not just De Anza. p.collegeCalendar has
// the same {quarters:[{name,start,end,finals:{start,end}}],
// holidays:[{name,date}|{name,start,end}]}), populated by the college-calendar fetch flow once
// the student picks their school. Until that's populated, term range falls back to manually-set
// termStart/termEnd exactly as before — but federal holidays apply either way, unconditionally,
// as the "no school at minimum" baseline this doesn't depend on any fetch having succeeded.
export function getQ(p){
  const cal=p?.collegeCalendar;
  if(!cal?.quarters?.length)return null;
  const n=iso();
  return cal.quarters.find(q=>n>=q.start&&n<=q.end)||null;
}
export function isHol(d,p){
  if(federalHolidayName(d))return true;
  const cal=p?.collegeCalendar;
  if(!cal?.holidays?.length)return false;
  return cal.holidays.some(h=>h.date===d||(h.start&&d>=h.start&&d<=h.end));
}
export function isFin(d,p){
  const cal=p?.collegeCalendar;
  if(!cal?.quarters?.length)return false;
  return cal.quarters.some(q=>q.finals&&d>=q.finals.start&&d<=q.finals.end);
}
// Returns {start,end} (iso strings) for the active term, or null if unknown.
// Students with a fetched collegeCalendar get it automatically; everyone else sets it manually
// in Settings (or hasn't picked a college / the fetch failed yet).
export function getTermRange(p){
  const cal=p?.collegeCalendar;
  if(cal?.quarters?.length){
    const active=getQ(p);
    if(active)return{start:active.start,end:active.end};
    // No quarter active right now (e.g. break) — fall back to whichever quarter is nearest today.
    const today=iso();
    let best=null,bestDiff=Infinity;
    cal.quarters.forEach(q=>{
      const diff=Math.abs(new Date(q.start)-new Date(today));
      if(diff<bestDiff){bestDiff=diff;best=q;}
    });
    if(best)return{start:best.start,end:best.end};
  }
  if(p?.termStart&&p?.termEnd)return{start:p.termStart,end:p.termEnd};
  return null;
}
