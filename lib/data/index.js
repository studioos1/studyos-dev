// Barrel — components/App.jsx imports the data layer's public surface from here.
export { STORE, GYM0, EP, ED, CHORE_PRESETS, uid } from "./schema";
export { load, save } from "./store";
export { nthWeekdayOfMonth, usFederalHolidays, federalHolidayName, getQ, isHol, isFin, getTermRange } from "./calendar";
export {
  computeTermStatuses,
  getActiveTermAndSchool,
  termScopedForPlanning,
  migrateLegacyTermIfNeeded,
  dedupeItemIdsIfNeeded,
  normalizeCourseNamesIfNeeded,
  repairTermLinkageIfNeeded,
  syncActiveTermToProfilePatch,
} from "./terms";
