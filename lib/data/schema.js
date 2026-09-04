// Default shapes and the localStorage key — the schema the app's single data blob follows.

export const STORE="studyos_v6";

export const GYM0=[
  {day:0,on:false,s:"09:00",e:"10:00"},{day:1,on:true,s:"19:00",e:"20:00"},
  {day:2,on:false,s:"19:00",e:"20:00"},{day:3,on:true,s:"19:00",e:"20:00"},
  {day:4,on:false,s:"19:00",e:"20:00"},{day:5,on:false,s:"19:00",e:"20:00"},
  {day:6,on:true,s:"12:00",e:"13:00"}
];
export const EP={
  name:"",lastName:"",phone:"",email:"",username:"",password:"",homeAddress:"",schoolName:"",schoolAddress:"",schoolType:"quarter",
  collegeCalendar:null,wakeTime:"07:00",sleepTime:"23:00",
  breakfastTime:"07:30",breakfastDur:30,lunchTime:"12:00",lunchDur:30,dinnerTime:"18:30",dinnerDur:30,
  focusMins:25,breakMins:5,sessionPreset:30,energyPeak:"morning",commuteMins:20,
  funWD:1.5,funWE:4,gymDays:GYM0,gymStretch:30,gymDrive:10,chores:[],remindersOn:true,termStart:"",termEnd:"",
  // Default grade-weight assumptions, used only when a course's syllabus doesn't state a weight
  // for an item — visible and editable in Settings so the student can correct them per their
  // actual courses. examsTotal + hwTotal should add to 100.
  defaultWeights:{examsTotal:60,hwTotal:40,finalShare:35}, // finalShare = the Final's cut of examsTotal; remaining exams split the rest evenly
};
export const ED={profile:EP,schools:[],terms:[],courses:[],assignments:[],exams:[],adhoc:[],gymLogs:[],dailyLogs:[],pomodoroLogs:[],history:[],briefCache:null,briefDate:null,quarterPlan:null,studyPlan:{weeks:{}},completionLog:[],onboarded:false,planStale:false};

export const CHORE_PRESETS=[
  {e:"🧺",n:"Laundry"},{e:"🗑",n:"Trash"},{e:"🍳",n:"Meal Prep"},
  {e:"🛒",n:"Food Shop"},{e:"🧹",n:"Clean"},{e:"🍽",n:"Dishes"}
];
