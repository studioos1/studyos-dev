// Build version — bumped every time a new build is generated, so you can confirm which
// build is actually running (check Settings → bottom, or the browser console on load).
// Shared between components/App.jsx (top bar) and components/Today.jsx — NOT used for the daily
// brief cache anymore (see lib/time.js's briefPeriodStart) precisely so a version bump never
// invalidates it and fires an unnecessary paid AI call.
export const APP_VERSION="2.80.4";
export const APP_BUILD_DATE="2026-09-18";
export const APP_BUILD_TIME="Daily Schedule fields moved to ~40% from the left (was 50%); mobile label-to-field spacing tightened to 6px, with 16px separating one field group from the next";
