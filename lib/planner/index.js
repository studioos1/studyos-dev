// Barrel — components/App.jsx (and later, tests) import the planner's public surface from
// here, never reaching into the individual files directly.
export {
  webDifficultySignal,
  estimateDifficulty,
  STUDY_HOURS_BASE,
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
  buildItemDemand,
  placeCourseBlocks,
  consumeTopicBuffer,
  planDayV2,
  preflightRiskCheck,
  planHorizon,
} from "./schedule";
export { ISO_DATE_RE, alignUp15, daysFrom, difficultyMultiplier } from "./core";
