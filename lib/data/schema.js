// Default shapes and the localStorage key — the schema the app's single data blob follows.

export const STORE="studyos_v6";

// Collision-proof id for a newly created record. A plain Date.now() (and the old
// Date.now()+i+random(0..999)) collides when several records are made close together — syllabus
// sync creates dozens — and colliding ids make "edit" / "mark done" / "prioritise" hit EVERY
// record that shares the id. Date.now()*1000 stays inside Number.MAX_SAFE_INTEGER; the per-call
// counter guarantees uniqueness even within one millisecond.
let _uidSeq=0;
export function uid(){_uidSeq=(_uidSeq+1)%1000;return Date.now()*1000+_uidSeq;}

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
  focusMins:25,breakMins:5,energyPeakTime:"09:00",commuteMins:20,
  funWD:1.5,funWE:4,gymDays:GYM0,gymStretch:30,gymDrive:10,chores:[],
  // remindersOn: superseded by the three per-type toggles below (kept only so store.js's migrate()
  // has the old value to carry forward once for anyone who'd explicitly turned it off — nothing
  // else reads this field anymore). New/unaffected accounts should treat it as gone.
  remindersOn:true,termName:"",termStart:"",termEnd:"",
  // Resume point for the onboarding wizard — persisted so "Save & Continue Later" (and just
  // closing the tab mid-setup) picks back up on the same step instead of restarting at Welcome.
  onboardStep:0,
  // Set true the moment the user completes the Term step. migrateLegacyTermIfNeeded waits for
  // this before synthesising schools[]/terms[], so a school-autocomplete auto-fill can't lock in
  // an unconfirmed term. (Already-onboarded legacy accounts don't have it and migrate on load.)
  onboardTermSaved:false,
  // Default grade-weight assumptions, used only when a course's syllabus doesn't state a weight
  // for an item — visible and editable in Settings so the student can correct them per their
  // actual courses. examsTotal + hwTotal should add to 100.
  defaultWeights:{examsTotal:60,hwTotal:40,finalShare:35}, // finalShare = the Final's cut of examsTotal; remaining exams split the rest evenly
  // Browser notifications. browserNotifsEnabled is the app-level master switch — the Preferences
  // banner's "Turn off"/"Turn on", same idea as SMS's smsEnabled below, kept as its own flag
  // instead of reusing the three per-type toggles' "all off at once" because that's a genuinely
  // different action from "I don't want session-start nudges but do want the daily summary" (each
  // per-type toggle keeps its own choice remembered under the hood while the master is off, same
  // as smsEnabled doesn't touch notifyDailySummary/etc). Distinct from actual browser PERMISSION
  // (the OS-level grant, tracked live via Notification.permission, not stored here at all) — this
  // only controls whether the app WANTS to notify, for a user who's granted permission but wants a
  // quick way to pause everything without hunting down three switches individually. Every
  // notification call site checks both: permission granted (client-side calls only — the server
  // cron has no notion of browser permission) AND browserNotifsEnabled!==false AND its own
  // specific per-type toggle — browserNotifsEnabled itself is a plain preference, not permission,
  // so it reads the same everywhere including server-side. notifyBrowserPriorities: the once-a-day
  // "today's priorities" notification (due dates within 2 days, exams within 5) — has a
  // server-side counterpart too (app/api/cron/notify-urgent-items) that writes the same content
  // into the bell log even if the browser was never open, gated on both this toggle AND
  // browserNotifsEnabled — turning the master off is meant to pause everything the Browser
  // Notifications section covers, bell log included, not just the desktop popup.
  // notifyBrowserSessions: "time to start studying" nudges at each planned session's actual clock
  // time. notifyBrowserBreaks: break start/end nudges — covers BOTH the passive schedule-driven
  // check and Today's own Focus Timer chime (components/Today.jsx), which used to ignore
  // remindersOn entirely; unified under one toggle so "turn off break reminders" actually turns
  // off every break reminder.
  browserNotifsEnabled:true,
  notifyBrowserPriorities:true,
  notifyBrowserSessions:true,
  notifyBrowserBreaks:true,
  // SMS reminders (B-11). Master switch + per-type toggles (default ON once enabled — a student
  // who turns SMS on presumably wants both; they opt individual ones back out). phone (above)
  // doubles as the SMS destination. customReminders holds one-off "remind me about X at HH:MM"
  // entries the student adds themselves; each fires once then is marked sent, not deleted, so the
  // list still shows history until the student clears it.
  //
  // There used to be a third toggle here, notifyExamCountdown, for a standalone "Exam / project
  // countdown" SMS — removed (not just left off) once the decision was made to fold that content
  // into notifyDailySummary's own message instead of building a whole separate scheduled send
  // (lib/sms/dailySummary.js now includes both an exam AND a project countdown line — projects
  // didn't even have one before, despite the toggle's own name promising it). Keeping a toggle
  // around for a feature that isn't being built as its own send would violate this codebase's own
  // "UI copy must never describe behavior the code doesn't have yet" rule indefinitely, not just
  // temporarily — removing it was the more honest move than leaving a permanent "coming soon."
  smsEnabled:false,
  smsConsentAt:null, // ISO timestamp of the moment the consent checkbox+submit was used — evidence of opt-in, not just the toggle state
  smsVerifiedPhone:null, // the exact phone number a test text has actually been confirmed delivered to — entering/changing the number always needs its own fresh confirmation before it's trusted
  notifyDailySummary:true,
  notifyPastDueNudge:true,
  // Idempotency markers written by the scheduled SMS cron routes (app/api/cron/*,
  // lib/sms/cronSend.js) — an ISO date string, so a re-trigger (a manual re-run, a Vercel retry)
  // on the SAME real-world day never sends that day's text twice. null (never sent) for every
  // account until its first scheduled send actually goes out.
  lastDailySummarySentDate:null,
  lastEveningCheckinSentDate:null,
  // Same idempotency pattern, for app/api/cron/notify-urgent-items — this one writes straight
  // into the bell log (data.notifications) rather than sending anything, so the log is accurate
  // the next time the app is opened even if the computer itself was asleep/closed when an exam or
  // due date crossed its threshold. Not gated on SMS opt-in at all (unlike the two above) — every
  // onboarded account with notifyBrowserPriorities on gets this, whether or not they use SMS.
  lastUrgentItemsNotifiedDate:null,
  customReminders:[], // [{id,text,date,time,sent:false}]
};
export const ED={profile:EP,schools:[],terms:[],courses:[],assignments:[],exams:[],adhoc:[],gymLogs:[],dailyLogs:[],pomodoroLogs:[],history:[],briefCache:null,briefPeriod:null,quarterPlan:null,studyPlan:{weeks:{}},completionLog:[],notifications:[],onboarded:false,planStale:false};

export const CHORE_PRESETS=[
  {e:"🧺",n:"Laundry"},{e:"🗑",n:"Trash"},{e:"🍳",n:"Meal Prep"},
  {e:"🛒",n:"Food Shop"},{e:"🧹",n:"Clean"},{e:"🍽",n:"Dishes"}
];
