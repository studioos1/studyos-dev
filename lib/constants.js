// UI/domain constants shared across components — day labels, the course-color palette, and
// the background/foreground color pairing for each activity type.
export const DS=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
export const DF=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
export const CC=[
  {block:"#0e243c",border:"#7ab4cc",text:"#7ab4cc"},
  {block:"#0c2418",border:"#78b888",text:"#78b888"},
  {block:"#1c1030",border:"#9080c0",text:"#9080c0"},
  {block:"#281c08",border:"#c8a860",text:"#c8a860"},
  {block:"#281808",border:"#c87860",text:"#c87860"},
  {block:"#0c2428",border:"#68b8a8",text:"#68b8a8"},
  {block:"#182808",border:"#90b060",text:"#90b060"},
  {block:"#282008",border:"#c8b060",text:"#c8b060"},
];
export const ACT={
  class:    {bg:"var(--a-class)",  fg:"var(--a-class-t)"},
  study:    {bg:"var(--a-study)",  fg:"var(--a-study-t)"},
  breakfast:{bg:"var(--a-bfast)",  fg:"var(--a-bfast-t)"},
  lunch:    {bg:"var(--a-lunch)",  fg:"var(--a-lunch-t)"},
  dinner:   {bg:"var(--a-dinr)",   fg:"var(--a-dinr-t)"},
  gym:      {bg:"var(--a-gym)",    fg:"var(--a-gym-t)"},
  stretch:  {bg:"var(--a-study)",  fg:"var(--a-study-t)"},
  commute:  {bg:"var(--a-comm)",   fg:"var(--a-comm-t)"},
  sleep:    {bg:"var(--a-sleep)",  fg:"var(--a-sleep-t)"},
  chore:    {bg:"var(--a-chore)",  fg:"var(--a-chore-t)"},
  fun:      {bg:"var(--a-fun)",    fg:"var(--a-fun-t)"},
  exam:     {bg:"var(--a-exam)",   fg:"var(--a-exam-t)"},
  deadline: {bg:"var(--a-comm)",   fg:"var(--a-comm-t)"},
  default:  {bg:"var(--card2)",    fg:"var(--t2)"},
};
