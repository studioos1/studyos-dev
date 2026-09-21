// Build version — bumped every time a new build is generated, so you can confirm which
// build is actually running (check Settings → bottom, or the browser console on load).
// Shared between components/App.jsx (top bar) and components/Today.jsx — NOT used for the daily
// brief cache anymore (see lib/time.js's briefPeriodStart) precisely so a version bump never
// invalidates it and fires an unnecessary paid AI call.
export const APP_VERSION="2.82.5";
export const APP_BUILD_DATE="2026-09-21";
export const APP_BUILD_TIME="Gym schedule's day checkboxes now form a clean vertical column — Friday's shorter label was pushing it off";
