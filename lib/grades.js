// ── Grades / GPA ────────────────────────────────────────────────────────────
export function letterFromPct(pct){
  if(pct===null||pct===undefined||pct==="")return{letter:"—",points:null};
  const n=parseFloat(pct);if(isNaN(n))return{letter:"—",points:null};
  if(n>=93)return{letter:"A", points:4.0};
  if(n>=90)return{letter:"A-",points:3.7};
  if(n>=87)return{letter:"B+",points:3.3};
  if(n>=83)return{letter:"B", points:3.0};
  if(n>=80)return{letter:"B-",points:2.7};
  if(n>=77)return{letter:"C+",points:2.3};
  if(n>=73)return{letter:"C", points:2.0};
  if(n>=70)return{letter:"C-",points:1.7};
  if(n>=60)return{letter:"D", points:1.0};
  return{letter:"F",points:0};
}
export function calcGPA(courses){
  const graded=(courses||[]).filter(c=>c.grade!==null&&c.grade!==undefined&&c.grade!=="");
  if(!graded.length)return null;
  let pts=0,cr=0;
  graded.forEach(c=>{
    const{points}=letterFromPct(c.grade);
    const units=parseFloat(c.credits)||4;
    if(points!==null){pts+=points*units;cr+=units;}
  });
  return cr?pts/cr:null;
}
