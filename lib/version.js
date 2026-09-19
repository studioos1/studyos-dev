// Build version — bumped every time a new build is generated, so you can confirm which
// build is actually running (check Settings → bottom, or the browser console on load).
// Shared between components/App.jsx (top bar) and components/Today.jsx — NOT used for the daily
// brief cache anymore (see lib/time.js's briefPeriodStart) precisely so a version bump never
// invalidates it and fires an unnecessary paid AI call.
export const APP_VERSION="2.79.6";
export const APP_BUILD_DATE="2026-09-18";
export const APP_BUILD_TIME="Phone field: fixed +1 shown outside the input, blur = Confirm Number with a live valid/invalid message; fixed a validity-check bug where a number missing its last digit was silently accepted as valid";
