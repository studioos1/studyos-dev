// Display-name lookup for an assignment/exam by its courseId — the single place every UI/planner
// read site should go through, instead of trusting a re-typed course string.
export function courseNameFor(courses,courseId){
  const c=courses.find(x=>x.id===courseId);
  return c?c.name:"(unknown course)";
}
