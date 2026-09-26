// Barrel — components/App.jsx imports the data layer's public surface from here.
export { STORE, GYM0, EP, ED, CHORE_PRESETS, uid, TERM_SCOPED_KEYS, TERM_DATA_DEFAULTS } from "./schema";
export { load, save } from "./store";
export { pushNotification, markAllNotificationsRead, appendNotification, urgentItems, PROJECT_COUNTDOWN_DAYS } from "./notifications";
export { nthWeekdayOfMonth, usFederalHolidays, federalHolidayName, getQ, isHol, isFin, getTermRange } from "./calendar";
export {
  computeTermStatuses,
  datesOverlap,
  canDeleteTerm,
  getActiveTermAndSchool,
  termScopedForPlanning,
  migrateLegacyTermIfNeeded,
  migrateTermStatusIfNeeded,
  backfillTermsInitializedIfNeeded,
  dedupeItemIdsIfNeeded,
  normalizeCourseNamesIfNeeded,
  repairTermLinkageIfNeeded,
  syncActiveTermToProfilePatch,
  applyTermScopedPatch,
  migrateTermDataIsolationIfNeeded,
} from "./terms";
