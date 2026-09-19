// Build version — bumped every time a new build is generated, so you can confirm which
// build is actually running (check Settings → bottom, or the browser console on load).
// Shared between components/App.jsx (top bar) and components/Today.jsx — NOT used for the daily
// brief cache anymore (see lib/time.js's briefPeriodStart) precisely so a version bump never
// invalidates it and fires an unnecessary paid AI call.
export const APP_VERSION="2.80.3";
export const APP_BUILD_DATE="2026-09-18";
export const APP_BUILD_TIME="Daily Schedule fields now truly start at the card's center line (equal label/field column widths, not just the block centered as a lopsided unit) — measured live: 7px off center (half the gap), identical across all 3 cards";
