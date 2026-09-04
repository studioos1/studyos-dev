// Barrel — components/App.jsx imports the calendar layer's public surface from here.
export { resolveConflict, buildBlocks, freeSlots } from "./build";
export {
  weekStartOf,
  realDayBlocks,
  weekHasBeenPlanned,
  saveBlockToDay,
  deleteBlockFromDay,
  logCompletion,
  findRawDayBlock,
} from "./weeks";
export { TIMELINE_COLORS, tc, assignLanesClustered } from "./render";
