// Build version — bumped every time a new build is generated, so you can confirm which
// build is actually running (check Settings → bottom, or the browser console on load).
// Shared between components/App.jsx (top bar) and components/Today.jsx — NOT used for the daily
// brief cache anymore (see lib/time.js's briefPeriodStart) precisely so a version bump never
// invalidates it and fires an unnecessary paid AI call.
export const APP_VERSION="2.94.3";
export const APP_BUILD_DATE="2026-10-17";
export const APP_BUILD_TIME="Fix: scheduled SMS reminders were landing 2-7+ hours late (GitHub Actions' schedule trigger is best-effort, not on-time) — the real trigger now runs on Supabase pg_cron instead; this workflow file is kept only for manual re-trigger/testing";
