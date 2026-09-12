// Barrel — components/App.jsx (and later, tests) import the planner's public surface from
// here, never reaching into the individual files directly.
export {
  estimateDifficulty,
  DIFFICULTY_BANDS,
  STUDY_HOURS_BY_RATING,
  estimateStudyHours,
  urgencyFactor,
  DIFFICULTY_WEIGHT,
  computePriorityScore,
  computeEstimateFields,
} from "./estimate";
export {
  SESSION_PRESETS,
  dayWindows,
  windowOrderFor,
  HOMEWORK_START_WINDOW_DAYS,
  PROJECT_START_WINDOW_DAYS,
  PROJECT_FINISH_BUFFER_FRAC,
  PROJECT_FINISH_BUFFER_MIN_DAYS,
  buildItemDemand,
  lastDeadlineByCourse,
  EXAM_DAILY_CAP,
  EXAM_EVE_CAP,
  EXAM_RUN_IN_DAYS,
  FINALS_STRETCH_MAX_SPAN,
  buildExamPrepPlan,
  placeCourseBlocks,
  consumeTopicBuffer,
  planDayV2,
  preflightRiskCheck,
  planHorizon,
} from "./schedule";
export { ISO_DATE_RE, alignUp15, daysFrom, difficultyMultiplier } from "./core";
