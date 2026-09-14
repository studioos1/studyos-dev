// Barrel — components/App.jsx imports the calendar layer's public surface from here.
export { resolveConflict, buildBlocks, freeSlots } from "./build";
export {
  weekStartOf,
  realDayBlocks,
  weekHasBeenPlanned,
  isItemScheduled,
  saveBlockToDay,
  deleteBlockFromDay,
  logCompletion,
  findRawDayBlock,
  CATCHUP_DAYS,
  catchUpDays,
  catchUpMarkComplete,
} from "./weeks";
export { TIMELINE_COLORS, tc, assignLanesClustered } from "./render";
