# StudyOS Changelog

## v2.45.1 — 2026-09-11

**SMS opt-in compliance (A2P 10DLC) + Terms of Service / Privacy Policy pages**

Twilio's Campaign registration requires the "Web Form" opt-in to include specific elements. The SMS Reminders card in Preferences now has them:

- A **consent checkbox** ("I agree to receive SMS text messages from StudyOS at the number above"), unchecked by default — required before the phone number can be enabled.
- Message-type description, **frequency** disclosure, **"message and data rates may apply"**, **STOP/HELP** instructions, and links to the new Terms of Service / Privacy Policy pages — all shown before the consent checkbox.
- A clear-language submit action ("Yes, text me reminders") replaces the old bare On/Off toggle as the enabling step; once on, the card switches to a status view with a "Turn off" action and the existing per-type toggles.
- New `smsConsentAt` profile field — timestamps the moment consent was actually given, separate from the `smsEnabled` state.
- **`/terms`** and **`/privacy`** — new public, unauthenticated pages (plain Terms of Service and Privacy Policy, StudyOS-specific, covering SMS/email use and the third-party services involved: Supabase, Twilio, Resend, Anthropic).

Since the opt-in itself lives behind login (Twilio can't crawl it), take a screenshot of the checked-consent state and host it somewhere public (Google Drive/OneDrive, link-sharing on) for the Campaign's Message Flow field.

**Validation:** 73 tests pass, `npm run build` clean (`/terms`, `/privacy` build as static pages), full flow browser-tested against the real account (checkbox → enable → sub-toggles → turn off; verified both new pages load without auth) and reverted afterward.

## v2.45.0 — 2026-09-11

**SMS reminders — Phase 1 (B-11): send pipe + Preferences UI**

First half of SMS notifications (Twilio). This phase proves the delivery pipe end-to-end and gets the profile/UI in place; the scheduled 8:30/12:00/6:00 sends are Phase 2.

- **`/api/sms/send`**: server-side Twilio sender. Requires a valid Supabase session (verified server-side against the auth token) — this is a paid, abusable action (arbitrary phone + message), so unlike `/api/ai` it's never left open to anonymous callers. Validates phone format and message length before calling Twilio.
- **Preferences → Notifications** now has an **SMS Reminders** card: phone number (reuses `profile.phone`), a master On/Off, three sub-toggles — **Daily summary** (8:30am), **Past-due nudge** (6:00pm), **Exam/project countdown** (12:00pm, starting 7 days out) — default **ON**, and a **"Send me a test text"** button that exercises the real pipe right now.
- **Custom reminders**: a small add/list UI — "remind me about X" at a date + time, sorted, shows sent/pending state, deletable. Not yet wired into a scheduler (Phase 3).
- New profile fields: `smsEnabled`, `notifyDailySummary`, `notifyPastDueNudge`, `notifyExamCountdown`, `customReminders[]`.
- `.env.template` documents the three server-only Twilio vars (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`) — not set yet, so the test button currently (correctly) reports "SMS isn't configured on the server yet."

**Validation:** 73 tests pass, `npm run build` clean, full UI flow browser-tested (toggle on/off, add/delete custom reminder, test-send reaches Twilio's config check).

## v2.44.4 — 2026-09-11

**Normalize manually-typed course names too**

`prettyCourseCode()` collapses a long course title to its short code ("MATH 180A") and was already applied to every AI-imported course, but not to the two manual "Add class" forms (onboarding and Academics → Courses). A hand-typed long name could still overflow the table the same way the original AI-title bug did. Now applied at both manual-entry points.

## v2.44.3 — 2026-09-10

**Login: show/hide password toggle**

Every password field on the auth screen (log in, sign up, set-new-password ×2) now has an eye icon to reveal the typed value. Implemented as a module-scope `PasswordInput` so it keeps a stable identity across renders (a component defined in `Login`'s body would remount the input on each keystroke and drop focus).

## v2.44.2 — 2026-09-09

**Assignments tab: Active and Completed tables now line up**

The two tables had different column orders (Completed put the title before the class, and had no Weight column) and no shared widths, so nothing aligned between them. Both now use one shared `<colgroup>` + `table-layout: fixed`: **Class · Assignment · Due · Weight · Grade · actions**, identical widths in both. The action-icon column shrank from 170px to ~88px and is right-aligned, so the edit/delete/restore icons sit at the card edge instead of floating with a big empty gap — the freed width goes to the Assignment column.

## v2.44.1 — 2026-09-07

**Fix: Account modal reappeared right after logging back in**

`Sign out` now lives inside the Account modal, and `App` (the root component) never unmounts — the render gates just swap in `<Login/>`. So `showAccount` stayed `true` through the sign-out, and the modal was already open the instant the next login rendered the app. Now forced shut whenever there's no session.

## v2.44.0 — 2026-09-07

**Sanity checks on AI-extracted PDFs**

The AI that reads a schedule or syllabus PDF is generative and occasionally returns nonsense — a section heading mistaken for a course, a due date with the wrong year, a course "name" that's a whole sentence. Two additions so a bad read gets caught instead of silently saved:

- **Upload-time note.** Every PDF drop zone now carries a line: *"We read this with AI, which can misread a PDF. Check the extracted results on the next screen — if something's off, re-upload to run it again."*
- **Deterministic checks** (`checkScheduleExtraction` / `checkSyllabusExtraction` in `lib/syllabus.js`, no second AI call) run on the parsed result before import and surface findings in the review step:
  - **error** (re-upload strongly suggested): nothing extracted; a course with no recognizable code (`MATH 20C`-style), rejecting headings like "Week 1" / "Fall 2026".
  - **warn** (check before importing): reversed/unreadable class times, missing class days, duplicate course codes, a syllabus course not among your imported classes, due dates outside the term (wrong year), unreadable dates, grade weights summing well over 100%, a course with more "exams" than makes sense (quizzes mislabeled), out-of-range weights.
- Findings render as an `ExtractionIssues` panel in both onboarding review steps and the Academics **Verify What We Found** modal, each with a **Re-upload & run again** button that clears the files so you can drop the PDF again.

Complements the existing `reclassifyMisplacedQuizzes` safety net. **73 tests pass** (16 new in `lib/syllabus.test.js`), `npm run build` clean.

## v2.43.0 — 2026-09-07

**Onboarding: School and Term are separate steps (B-17 group 3)**

- The old combined step is split into **Select your school** (school name required) and **Select your term** — with a new mandatory **Term name** field alongside start and end. Everything in the app is scoped to the active term, so the term now gets its own deliberate step.
- **Every step advance persists a resume point** (`profile.onboardStep`). Close the tab mid-setup — or hit the new **Save & Continue Later** button on the School / Term steps — and you come back to the same step instead of restarting at Welcome.
- Wizard steps are keyed by name internally, so inserting the Term step didn't mean renumbering every navigation call.
- `migrateLegacyTermIfNeeded` now waits for the Term step to be **saved** (`profile.onboardTermSaved`) before synthesising `schools[]`/`terms[]`, so a school-autocomplete auto-fill can't lock in a term the user hasn't confirmed. Already-onboarded legacy accounts still migrate on load. The synthesised term uses `profile.termName`; `syncActiveTermToProfilePatch` mirrors the active term's name back to the profile.
- Picking a school from the list now also pre-fills **Term name** on the next step (via `applyCollegeCalendarResult`).
- Existing users add a new term the same way as before — **School Info → Add term** (already has its own Term name / dates form).

**Validation:** 57 tests pass (9 in `terms.test.js`, incl. new coverage for the onboarding-save gate), `npm run build` clean.

## v2.42.1 — 2026-09-07

**Login layout polish**

- **StudyOS** wordmark now sits on top, tagline ("Get things done, on time" / "A personal assistant for students") beneath it; the whole block is nudged higher up the page.
- The view heading ("Log in to your account" / "Create your account" / …) moved **inside the card** as its title, so the card stays put between the log-in and sign-up states.
- The **"Don't have an account? Sign up"** switch row is right-aligned under the card, with more space between the prompt text and the button.

## v2.42.0 — 2026-09-07

**Login / signup / account cleanup (B-17 group 4)**

- **Login screen** is now the standard pattern: email + password + **Log in**, a **Forgot your password?** link, and a **Sign up** switch beneath the form (no separate "landing" step).
- **Sign up** collects mandatory **full name** and **mobile phone** alongside email + password; these go into the Supabase user's metadata and are seeded into `profile.name` / `profile.phone` the first time that account's data loads.
- **Forgot password**: enter your email → `supabase.auth.resetPasswordForEmail` → neutral confirmation ("if an account exists, a link is on its way"). Reliable delivery still depends on B-11 (transactional email provider); the flow is in place.
- **Set new password**: after following the reset link, `App.jsx` catches the `PASSWORD_RECOVERY` auth event and renders `<Login recoveryMode>` (new password + confirm → `supabase.auth.updateUser`).
- **One account icon**: the standalone sign-out button is gone from the header; **Sign out** (with the signed-in email) now lives at the bottom of the Account modal.

Field markup is inline per view, so inputs don't remount / drop focus on each keystroke.

**Validation:** 53 tests pass, `npm run build` clean. Browser-verified on localhost: log in → app loads; Sign-up shows the name/phone fields; the header has a single icon and the Account modal has Sign out.

## v2.41.0 — 2026-09-07

**Project-type assignments + two-day exam run-ins**

*Projects.* An assignment can now be typed as a **Project** (Homework⇄Project toggle in Study Preferences; syllabus sync guesses from the title). A project is planned differently from homework:
- Schedulable the whole term (`PROJECT_START_WINDOW_DAYS`), not just its last 5 days.
- Steady **even-pace** work: each day it takes `remaining ÷ days-to-(due − ~15% finish buffer)`, a low self-correcting rate — skip a day and the rate ticks up.
- Aims to finish a few days early (min 3), leaving the tail clear for polish/overrun.
- Runs after near-term homework/exam prep, before generic regular study, and keeps going through finals week (unlike regular study, which is suppressed there) — but not on an exam's reserved run-in day.
- Its own indigo block colour + "Project" legend entry; a `PROJECT` badge and row tint in the Study Preferences table.

*Exam run-ins.* Each exam gets two dedicated days — an **eve** (D-1) and a **lead-in**. Exams are grouped into clusters (chains within `FINALS_STRETCH_MAX_SPAN` of each other), so a midterm week and finals week are handled separately. Within a cluster of ≥2 exams the lead-in days are the block of free days before the cluster's earliest eve, handed out **in exam order** — soonest exam gets the earliest lead-in day. So a MMW 11/2 / MATH 11/4 / DSC 11/6 cluster produces: 10/29 MMW, 10/30 MATH, 10/31 DSC (lead-ins), then 11/1 MMW, 11/3 MATH, 11/5 DSC (eves), exam days and 11/7 clear. A lone exam gets its eve plus the day before it.

The **eve** is exclusive — that exam's prep plus only can't-wait homework, no projects, no regular study. The **lead-in** is lighter (exam prep pencilled in at 3.5h, not 7h) and **still takes homework that's due around then** — a Problem Set due the week of finals is no longer dropped to make room for exam prep. Only projects and Tier-2 regular study are held off the lead-in. Time per exam is its estimated (difficulty-driven) hours: the eve carries ~60%, capped at 7h; only a genuinely large demand spills onto earlier shared days at 3.5h.

If an exam would still come up short after all that, its lead-in day's leftover time (after due homework) is filled with more of its own prep rather than left idle — up to a full 7h day. A fully-covered exam's lead-in stays light.

*Study Preferences table.* "AI Estimate"/"Student Estimate" → "AI Planning"/"Student Planning" (two-line headers); Due, Weight and both planning columns are centred; the Student Planning dropdown is narrowed to roughly match the AI column; a "Type" column carries the Homework⇄Project toggle; exam rows show an `EXAM` badge with a red row tint.

**Validation:** 43 unit tests pass (`projects.test.js` adds 4; `examPrepass.test.js` covers the eve + lead-in structure, lead-ins in exam order, two dedicated days with spill only when large, a lone midterm's exclusive eve, and homework not dropped on a lead-in). `npm run build` succeeds. Browser-verified against the Fall 2026 finals: the run-up reads 10/29 MMW, 10/30 MATH, 10/31 DSC, 11/1 MMW, 11/3 MATH, 11/5 DSC — each day one course, prep filling the evenings while the finals are short, due homework alongside — exam days and 11/7 clear. Plan-status shortfall fell from 22.6h to 5.9h across these two refinements.

## v2.40.0 — 2026-09-07

**Study-hours estimate is now driven by the difficulty band — changing the rating moves the hours**

The old `estimateStudyHours` looked only at the course's numeric difficulty (1–10) and grade weight — it never consulted the item's Low/Mid/High rating. So overriding an item M→H in Study Preferences left the suggested hours (and the plan) unchanged, which is exactly backwards from what the control implies.

- **`estimateStudyHours(item, course, kind, rating)`** is now a plain lookup: `STUDY_HOURS_BY_RATING[kind][rating] × a ±30% weight nudge`, rounded to the half-hour. The table (`lib/planner/estimate.js`, marked "TUNE HERE"): homework 1.5 / 3 / 5 / 7h, exam 4 / 7 / 11 / 16h for Low / Mid / High / Very High. No double-count — the band already folds in course difficulty (that's what `estimateDifficulty` does), so the course multiplier is gone from the hours formula.
- **New "Very High" band** for cumulative finals and capstone projects — deliberately rare (a heavy item in a genuinely hard course). Added to `estimateDifficulty`'s bucketing, `DIFFICULTY_WEIGHT` (→ priority), the exam pre-pass `highStakes` test (→ 3-day spread), the `DiffPill`, and the Study Preferences dropdown.
- **Study Preferences table**: changing an item's band recomputes the suggested hours on the spot (no Save needed). A number you typed yourself still wins for planning; a "↺ Nh" chip next to the field drops your override back to the suggestion. On tab open, every item's hours suggestion is refreshed from its effective rating and cached back, so the planner reads current numbers.
- Not touched: research-backed difficulty (`webDifficultySignal`, still a stub) and the personalization loop (learning from your edits) — both remain the next steps.

**Validation:** 37 unit tests pass (`estimate.test.js` rewritten for the band-driven model + `computeEstimateFields` consistency; planner/prepass/range suites unchanged). `npm run build` succeeds. Browser-verified: a DSC exam at Mid shows 7h; switching it to High moves it to 11h and its priority 30→45 live; the ↺ chip restores the suggestion.

## v2.39.0 — 2026-09-07

**Exam-prep pre-pass — final-week study is decided globally, back-loaded, and de-conflicted (rules A–H)**

The old per-day planner scheduled exam prep too early and let it split across subjects the night before a final (e.g. Math prep on the eve of the MMW final). Exam prep is now decided in a single global pass (`buildExamPrepPlan` in `lib/planner/schedule.js`) *before* day-by-day placement, so it can pack toward each exam and be prioritised across exams — things a greedy per-day pass can't do.

- **B — back-loaded fill.** Prep packs from the eve (D-1) backward. The eve is filled as full as the day allows (`EXAM_EVE_CAP` = 7h), every earlier prep day stays capped at `EXAM_DAILY_CAP` = 3.5h.
- **A — exclusive eve.** The day before exam X carries only X's prep (plus fixed events and genuinely can't-wait, due-tomorrow homework). The nearest exam claims its eve first (`claimedEves`), so a later exam can't spill onto it.
- **C — nearest deadline wins scarce days.** Exams are processed soonest-first and share a running per-day capacity budget, so the closest exam gets first call on tight near-term time; contention surfaces as the *later* exam's shortfall.
- **D / G — spacing by stakes.** Each exam is spread over ≥2 distinct days, ≥3 when it's high-stakes (grade weight ≥25% or difficulty "High").
- **E — no regular study in the finals stretch.** When ≥2 exams fall within 14 days, Tier-2 per-course "regular study" is suppressed from the first exam's eve through the last exam.
- **F — exam day = rest.** No study of any kind is scheduled on a day an exam falls on.
- **H — eve label.** D-1 sessions read "<course> exam — final review" instead of "exam prep (Nd left)".

`planDayV2`, `preflightRiskCheck`, and `planHorizon` take an optional `examPrep` argument; exam-prep shortfalls flow through the same risk channel as everything else, so nothing is silently dropped. Builds on the earlier "no study demand after a course's last deadline" (D1) and "anchor the horizon on the last real deadline, not the typed term-end" (D2) planner changes in this same branch.

**Validation:** 30 unit tests pass (`lib/planner/examPrepass.test.js` adds 8 covering rules A/B/C/E/F/H and the multi-exam eve de-confliction; the 22 existing planner/range tests still pass). `npm run build` succeeds. Browser-verified against the real Fall 2026 finals cluster (MMW 11/2, MATH 11/4, DSC 11/6): each eve carries only its own exam's prep, exam days and the post-term day are clear, and no regular study appears in the stretch.

## v2.38.0 — 2026-09-04

**Migrated to Next.js — build tooling replaced, app logic untouched (roadmap step A4)**

First structural step of the prototype-to-product roadmap. The single-file CDN build (React + `@babel/standalone` loaded from a CDN, no build step) is replaced with a real Next.js (App Router, JavaScript) toolchain. **No application logic changed.**

- `public/app.js` → `components/App.jsx` — same 6,094 lines, now an ES module: `"use client"` + `import React, { useState, useEffect, useRef }` at the top, `export default App` at the bottom, the `ReactDOM.createRoot(...)` mount line removed (Next mounts it).
- `public/index.html` → split: `<head>` (fonts, pdf.js via `next/script`) into `app/layout.jsx`; the entire `<style>` block copied verbatim into `app/globals.css`.
- `app/page.jsx` renders `<App/>` via `next/dynamic` with `ssr:false` — the app reads `localStorage` in a `useState` initializer, so it stays client-only and runtime behavior is identical to the old CDN build.
- `server.js`'s four endpoints → Next route handlers under `app/api/*/route.js` (`ai`, `course-info`, `college-calendar`, `health`), ported verbatim; `node-fetch` → native `fetch`. The hard-coded "De Anza College" string in `course-info` is preserved as-is — that fix is roadmap step C4.
- `server.js` kept but unused, and its deps (express/cors/node-fetch/dotenv) left installed for one commit, per the "don't delete superseded code in the same pass" rule. Removed in the follow-up cleanup.
- Scripts: `npm run dev` / `npm run build` / `npm start` are Next now; `npm run legacy-server` still runs the old Express server. Same port 3000.
- `eslint.ignoreDuringBuilds` enabled — the 6k-line `App.jsx` won't pass a strict lint yet; lint cleanup is a later phase.

**Validation:** `npm run build` succeeds and `next dev` serves the app; `/api/health` returns `hasApiKey: true`. Full 7-tab click-through is the dev-machine gate for A4.

## v2.37.3 — 2026-09-02

**Focus Time right column — corrected the actual grouping, not just the order**

The previous fix (v2.37.2) spread three items evenly, but the reference image shows two groups, not three evenly-spaced items: [Play button + Duration] sit close together as a tight pair, then a clearly larger gap, then [Time range] alone at the far right. Restructured to match: button+duration wrapped as one fixed-width group, time range as a separate fixed-width group pinned to the right edge, with `justify-content:space-between` applied across just these two groups — producing the tight-pair-then-large-gap pattern in the image, not even three-way spacing. Fixed widths on both groups also guarantee they land at the same horizontal position on every row regardless of that row's task text length.

## v2.37.2 — 2026-09-02

**Focus Time right column reordered to match the approved reference design exactly**

Same three-element space-between structure from v2.37.1, reordered left-to-right: Play button → Duration ("1h") → Time range (amber, rightmost) — matching the provided reference image precisely, element for element. Applied the same order to the running state (Pause/Complete buttons → countdown) for consistency.

## v2.37.1 — 2026-09-02

**Focus Time right column — actual redesign this time, not another reposition**

v2.37.0 was still wrong: it centered the time+duration+button as one clustered group within the available space, which just moved the cluster — it didn't spread the individual pieces, which was the actual request.

**Real fix:** time range, duration, and the button are now three genuinely separate flex children (previously time+duration were stacked together as one sub-block) inside a `justify-content:space-between` container. This is unambiguous, well-defined CSS behavior: the first element pins to the start of the available space, the last pins to the true right edge, and the middle one sits between them — an actual spread across the row's width, not a group that happens to be centered.

**Verified:** confirmed via the app's actual JSX structure that all three elements are direct children of the space-between container (React fragments don't introduce wrapper DOM nodes, so this is structurally guaranteed, not just visually hoped-for), and confirmed the old clustered-block wrapper from every previous attempt is completely gone from the served code, not just hidden behind it.

## v2.37.0 — 2026-09-02

**Two real layout fixes, from actual screenshots this time**

1. **Add Activity's date picker moved out of the cramped header** into its own proper field in the body — a "Date" label + full-width dropdown, matching the same pattern as Type/Description/Start/End, appearing above Type when there's more than one day to choose from. Modal widened slightly (420px → 460px) to give it room. Previously it was squeezed inline next to the "Add Activity" title itself.
2. **Focus Time's right-side content actually redistributed, not just given a wider minimum.** The previous attempt (v2.35.0) widened the right column's minimum width but left the task column as unbounded `flex:1`, which still absorbed all the leftover space — so the right content stayed visually clustered at the true right edge with a large empty gap before it, exactly as shown in the screenshot. Real fix: capped the task column at a fixed max (`flex:"0 1 340px"`) instead of letting it grow indefinitely, and made the right column `flex:1` — it's now what actually claims the leftover space, with its content centered within that space instead of pinned to the far edge.

**Verified:** real running-server smoke test confirming all four specific style values are present and correctly deployed in the served code.

## v2.36.0 — 2026-09-02

**Critical fix, confirmed: Refresh Plan was overwriting history that Clear Plan had just protected**

The user's hypothesis was exactly right. `refreshQuarterPlan`'s planning range started from `sundayOf(new Date())` — the *current week's Sunday* — not from today. `refreshWeekPlan` was worse: it unconditionally planned all 7 days of a given week with no fallback at all. Both meant that any day before today but within the current week (e.g. Sunday–Tuesday if today is Wednesday) got silently regenerated and overwritten — including completed/historical data that `Clear Plan` had correctly left untouched moments earlier.

**Fixed in both:**
- `refreshQuarterPlan`: planning now starts from today exactly (`iso()`), never rounded back to the week's Sunday. The existing write-back loop already correctly falls back to the prior day's data when a date wasn't actually planned — so this one change was enough to fix everything downstream.
- `refreshWeekPlan`: now filters to today-forward before calling the planner, and explicitly preserves each day's existing data for anything before today, instead of wholesale-replacing the week's `days` object with the fresh planner result.

**Verified:** simulated the exact reported scenario (mid-week Wednesday, completed history sitting on Sunday/Monday/Tuesday) against the precise merge logic now in place — confirmed history survives untouched and today-forward correctly gets the fresh plan.

**On the other two reports (Add Activity date picker, Focus Time layout):** re-verified both end-to-end in the code — button → state → modal render → prop destructuring → conditional rendering — and found everything correctly wired, matching what shipped in v2.35.0. No logic bug found on review. This points to a deployment or browser-cache issue rather than a code defect — worth confirming the v2.36.0 build is actually deployed and trying a hard refresh before further investigation.

## v2.35.0 — 2026-09-02

**Two fixes; one issue investigated with findings reported, not silently claimed fixed**

1. **Add Activity now supports picking a day** — previously hardcoded to today only. `BlockEditModal` gained an optional `weekDates` prop (only passed from Weekly's own "+" button); when adding a new activity with more than one selectable day, the static date text becomes a real dropdown. Filtered to today-forward within the currently-viewed week, matching the explicit ask — deliberately not extended to Timeline's own single-day block-editing, which is out of scope for this request. Editing an *existing* block still always stays on the day it's actually placed — no date-switching there.
2. **Focus Time's right column widened** — previously `flexShrink:0` with no explicit width, so it only ever claimed exactly its own content size, getting pushed to the true right edge by the flexible task-name column. Now has a `minWidth:220` floor, claiming real center-right space.
3. **Clear Plan reportedly wiped history (days before today) — investigated thoroughly, root cause not confirmed.** Reviewed both `Clear Plan`'s own logic and `refreshQuarterPlan`'s week-merging logic in detail; both are structurally correct on inspection (`refreshQuarterPlan` spreads existing weeks before only overwriting the ones it actually touches; `Clear Plan` correctly skips any `dateStr<today`). No code-level bug found through review alone. Flagged directly to the user with specific diagnostic questions rather than guessing at a fix or claiming this is resolved.

## v2.34.0 — 2026-09-02

**Critical fix: `iso()`, the canonical "what's today" function, was silently off by a day every evening**

Root cause traced from a single report: Weekly showed "today" as Thursday while Today's own header correctly said Wednesday. The two disagreed because they used different methods — Today's header used `toLocaleDateString()` (correct, local-time based), while `WeekGrid`'s `todayStr=iso()` called the actual bug directly.

`iso()` used `.toISOString()`, which converts to **UTC**. For any timezone behind UTC (all of the Americas), evening local time is already tomorrow in UTC — so for a huge part of every day, `iso()` was silently returning the wrong date. This function is the canonical date source used pervasively throughout the app: term status derivation, the planner's day-by-day scheduling, the legacy migration, syllabus sync, `weekStartOf()` — not just Weekly's "today" highlight.

**Fixed** by switching to local date components (`getFullYear()`/`getMonth()`/`getDate()`) instead of `toISOString()`. Checked every call site in the file first — confirmed exhaustively that all ~35 usages always pass an actual `Date` object, never a raw string, so there's no risk of the separate (and different) UTC-midnight string-parsing gotcha affecting any existing caller.

**Testing required real care here**, since the sandbox environment itself runs in UTC — a naive test wouldn't have exercised the bug at all, since "local time" and "UTC time" are the same thing in a UTC-timezone sandbox. Verified properly by explicitly running tests with `TZ=America/Los_Angeles`, matching a real user's browser: confirmed the *old* implementation genuinely fails (returns tomorrow's date at 8:30pm Pacific), and the *new* implementation genuinely passes across evening, late-night, and morning scenarios. Re-ran the full existing regression suite (term status, planner completion/alignment/overlaps, `weekStartOf`) under the same real Pacific timezone to confirm nothing already-working broke.

## v2.33.1 — 2026-09-02

**School Info restyled for real design consistency with the rest of the app**

Previously used ad-hoc custom card styling (amber-tinted background box, custom badge placement) that didn't match how every other tab presents its items. Rebuilt to use the exact same `BOX`/`TITLE_ROW`/`TITLE_LEFT`/`TITLE_ICON`/`TITLE_TEXT`/`DIVIDER`/`INNER` pattern that Academics, Today, and Preferences all already share — added the same style constants locally to `SchoolInfo`, matching how each of those components defines them.

- Each term is now a real card matching how a course card looks: a colored status dot in the title row (mirroring a course's color dot) instead of a full-card amber tint, status badge and edit button in the title row, dates/type as body content below a divider — not the previous single flat block of mixed-weight text.
- School header restyled to match the app's icon + uppercase-label section-header convention (used elsewhere for things like "ACTIVE — 33 REMAINING") instead of plain bold text.

**Verified:** real running-server smoke test confirming the style constants and the term cards' `TITLE_ROW` structure are correctly present in the served code.

## v2.33.0 — 2026-08-31

**School Info: term editing added — this was the real fix behind "I don't see the term name"**

The visibility issue from the last two releases wasn't styling — it was that the migrated term genuinely has no real name (falls back to a generic "Current term" placeholder, since the old single-term data never had one), and there was no way to correct it. Not intentional; a genuine gap.

- Added edit capability: a pencil icon on each term card opens an edit modal pre-filled with that term's current name/type/start/end. Deliberately scoped to typo correction only — not which school the term belongs to, since reassigning a term to a different school is a much bigger structural move.
- Saves back by updating the existing term in place (`data.terms.map(...)`), not creating a duplicate.
- Since this flows through the existing mirror-sync (which watches `data.terms` for changes), renaming a term also correctly updates everywhere else that reflects it — including the top-bar quarter badge, with no additional wiring needed.
- Increased text size on "Current school" (12px → 13px) and "Quarter"/"Semester" (12px → 13px), per feedback that they were too small to read comfortably.

**Verified:** real running-server smoke test confirming the edit function, save function, modal, and pencil icon are all present and correctly wired.

## v2.32.3 — 2026-08-31

**School Info: dates strengthened to genuinely stand out**

Previous attempt (v2.32.2) used semi-bold + muted secondary color, which per screenshot feedback didn't read as visually "highlighted" against the type line below it. Now full bold (700) at the same bright color as the term name, so it's unambiguous.

## v2.32.2 — 2026-08-31

**School Info: start/end dates also made prominent**

Dates moved to their own bold line (13px/600) directly under the term name, instead of being combined with the type on the muted secondary line. Type and the "starts once current term ends" note remain as smaller, muted detail below.

## v2.32.1 — 2026-08-31

**School Info: term name now visually bold, separated from secondary details**

Term name is now its own bold, prominent line (15px, weight 700). Type and dates moved together onto the secondary muted line below, instead of being combined with the name on one medium-weight line.

## v2.32.0 — 2026-08-31

**Critical fix: the planner and calendar display never actually respected term boundaries**

While completing the Account save-button follow-up, checked whether the *planner itself* — not just the Academics UI — respected the new term system. It didn't, in two separate places:

1. **The planner** (`buildItemDemand` for deadline-driven scheduling, and Tier 2's regular-study fallback) iterated `data.assignments`/`data.exams`/`data.courses` completely unfiltered by term. The moment any historical course data exists — which the "keep forever" archiving design specifically encourages — the planner would try to schedule real study time today for years-old completed courses, or for an upcoming term prepped in advance before it's even started. `freeSlots()` had the same exposure for class-time blocking, since it reads the same `data` reference.
2. **`buildBlocks()`** (used by `Timeline` for both Today's calendar and Weekly's day-detail view) independently read unfiltered `data.courses`/`data.exams` to render "what's happening today" — with no date-range awareness of its own, just a weekday pattern. A completed term's old course would show as "happening" on its usual class day forever, matching the exact motivating scenario for this whole feature (De Anza → UCSD).

**Fixed with one new function, `termScopedForPlanning()`**, applied at every point data enters term-sensitive logic:
- Both `planHorizon()` call sites (`refreshQuarterPlan`, `refreshWeekPlan`), which also covers `freeSlots()` since `gapsByDayFn` shares the same scoped `data` reference.
- Inside `buildBlocks()` itself, so every caller (present and future) gets correctly-scoped data automatically rather than needing to remember to scope it at each call site.
- At the top of `Today`, fixing the same bug in Deadline Awareness and Today's Classes — confirmed safe first: `Today` never writes directly to courses/assignments/exams, only to `studyPlan`/`completionLog`/`pomodoroLogs`, so there's no risk of the scoped copy overwriting other terms' data on save.
- Falls back to unscoped data if no term exists yet, so a fresh or pre-migration install doesn't break.

**Verified:** isolated-tested `termScopedForPlanning()` against the exact De Anza (completed) + UCSD (current) scenario that motivated this feature — confirmed the old school's course/assignment/exam are excluded and the current one is included. Re-ran the full existing planner regression suite (priority completion, zero shortfalls, alignment, zero overlaps) with term-scoping now in the pipeline, confirming nothing already-working broke. Real running-server smoke test confirming all four fix points are present and correctly wired.

## v2.31.1 — 2026-08-31

**Account now requires an explicit Save — no more auto-save on every keystroke**

Every other field in the app auto-saves immediately, but Account holds sensitive personal data (now including username/password placeholders) and should be intentionally committed, not silently persisted character-by-character as you type.

- Extracted a separate `AccountModal` component specifically so its draft state resets fresh every time the modal opens, rather than persisting stale edits across opens (a plain inline `useState` wouldn't reset on toggle, since `App` itself never remounts).
- Fields now edit local draft state only; nothing reaches `data.profile` until Save is clicked. The Save button is disabled and reads "No changes to save" until something's actually different from what's stored.
- **Closing with unsaved changes now asks for confirmation** ("Discard unsaved changes?") rather than silently dropping them — protecting this data from accidental loss, not just accidental premature saving, in both directions.

**Verified:** real running-server smoke test confirming the new component, the dirty-gated Save button, the discard-confirmation flow, and the updated call site are all present and correctly wired.

## v2.31.0 — 2026-08-31

**Multi-school, multi-term system — the full build, across several design conversations**

This replaces the single school/single term model with real support for transfers (e.g. De Anza → UCSD) and planning an upcoming term while the current one is still running, isolated from it.

**Data model (mirror pattern, as designed):**
- New `schools[]`/`terms[]` — the real source of truth. `profile.termStart/termEnd/schoolName/schoolAddress/schoolType/collegeCalendar` stay in place, auto-synced to whichever term is Current, so every existing consumer (the planner, `getTermRange`, `isFin`/`isHol`, WeekGrid) keeps working completely unchanged.
- `computeTermStatuses()` — status is always derived from real dates, never stored: **Completed** once the end date passes, **Current** is the earliest non-completed term (even before its own start date, once the previous one ends), everything else **Upcoming**. Isolated-tested against both the mid-term and between-terms scenarios.
- One-time legacy migration synthesizes a school+term entry from existing profile fields — **and backfills `termId` onto any existing untagged course**, without which real existing data would have silently vanished from every term-filtered view. Isolated-tested against both cases.
- Added `email`/`username`/`password` as placeholder profile fields (per explicit instruction) — data capture only, no verification/login logic, deferred to the WhatsApp/notifications infrastructure phase.

**Academics — full term isolation:**
- New `viewingTermId` state, defaulting to Current, switchable via a new term-picker pill in the header (shows every term with its status, grouped implicitly by recency).
- Every course-creation site (onboarding's syllabus import, onboarding's manual add, syllabus sync, Academics' manual add) now tags new courses with the correct term.
- Syllabus sync's course-matching is scoped to the viewing term only — retaking a course in a new term no longer risks merging into the old term's course.
- Term-scoped read-only lists (`termCourses`/`termAssignments`/`termExams`) applied consistently across the assignments view, exams view, courses view, GPA (calc, caption, and table), all four course-picker dropdowns, all four edit/add-save course-matching calls, and Study Preferences' item list.
- **Every save/delete operation deliberately continues operating on the full unfiltered arrays** — replacing them with a term-filtered subset would have silently dropped every other term's data on the next save. This distinction was maintained carefully throughout.
- "Reset academic data" rescoped to the viewing term only — previously it would have wiped every term's data in one action, a real data-loss risk once multiple terms coexist.

**New School Info tab:**
- Schools grouped with their terms nested underneath; the current school shows expanded, others collapse to a single summary row (e.g. "De Anza College · 4 terms, 4 completed").
- "Add term" — one unified flow for both cases: typing an existing school just adds a term under it (type pre-filled from that school's most recent term, as an editable default); typing a new school creates it and tries the same auto-fill lookup already used elsewhere, falling back to manual entry.

**Account relocated:**
- Moved from a top-level tab to a small corner icon in the top bar, opening a modal with personal info only (name, last name, phone, email, home address, plus the new username/password placeholders) — no save-state UI at all, since every field here already auto-saves on change and none of it is ever plan-relevant.
- The old `Account` tab-component (which briefly held both personal *and* school info, from the previous iteration of this work) is fully removed now that School Info has its own tab.

**Verified:** isolated tests for every new core function (term-status derivation across both transition scenarios, the legacy migration including the course-backfill case, and the mirror-sync no-op behavior once already synced), syntax validation after every meaningful stage, and real-server smoke tests confirming the term switcher, School Info tab, Add Term flow, and the new Account modal are all present and correctly wired in the served code.

## v2.30.0 — 2026-08-31

**Settings restructured: new Account tab, renamed to Preferences, and a real dirty-tracking bug fixed**

1. **New "Account" top-level tab** — Personal Info and School Info moved out of Settings into their own tab, with their own contextual Save & Replan action instead of sharing Settings' global one.
2. **"Settings" renamed to "Preferences"** — now contains only Daily Schedule, Gym & Fun, Chores, and Notifications.
3. **Added Last Name field** to Personal Info, alongside First Name.
4. **School Address auto-populate — confirmed already implemented, not new.** Traced the code: selecting a school via the autocomplete already calls `fetchCollegeCalendar()` → `applyCollegeCalendarResult()`, which sets `schoolAddress` automatically. This connects to a previously-flagged backlog item — the underlying web-search quality has never been verified end-to-end with a live key, so if this isn't working reliably in practice, that's where to look, not the wiring.

**Real bug found and fixed while implementing #1**, not just a UI reorganization: `dirty` was being computed by comparing the *entire* profile object, not just the plan-relevant fields — so editing something as irrelevant as a phone number incorrectly lit up "plan not yet refreshed," even though `saveReplan()`'s own internal check already knew better and would silently no-op the replan for exactly those changes. Fixed by computing `dirty` the same way `saveReplan()` already determined relevance — the indicator and the real behavior now agree. Applied in both the new `Account` component (scoped to `termStart`/`termEnd`/`collegeCalendar`, since school selection genuinely can affect scheduling) and the existing `Preferences` component (scoped to its own remaining plan-relevant fields, now with `termStart`/`termEnd`/`collegeCalendar` removed from its list since those fields no longer live there).

**Verified:** confirmed every existing usage of `p.name` throughout the app already treats it as a first name (not a full name), so adding `lastName` alongside required no other changes. Isolated-tested the dirty-computation fix directly — confirmed a plan-irrelevant edit no longer trips the indicator while a plan-relevant one still does. Real running-server smoke test confirming the new tab, component, renamed label, and new field are all present and correctly wired.

## v2.29.0 — 2026-08-31

**Cleanup pass: removed four superseded functions and the diagnostics panel built on them**

Deleted, each confirmed via comprehensive search to have zero remaining callers before removal:
- `generateWeekPlan()` — superseded by `planHorizon()`.
- `studyTargets()` + `planStudyBlocks()` — superseded by `buildItemDemand()`/`placeCourseBlocks()`/`planHorizon()`. Also removed their exclusive dependencies `rampMinutes()` and `HOMEWORK_WINDOW`. Carefully preserved `ISO_DATE_RE` and `alignUp15` — both confirmed genuinely shared with the live planner, not exclusive to the old code.
- `Pomo()` — superseded by Focus Time's per-row timers (v2.28.0). Also removed its exclusive dependencies `todaysStudySessions()`, `currentOrNextSession()`, and `PRESET_BREAKDOWN`.

**"Planner diagnostics" panel replaced with a much smaller "Plan status" panel** — kept only the part that was still accurate (Refresh Plan history: last generated time, last error), removed everything built on the old functions' now-invalid model (per-item inclusion tracing, phase-by-phase target computation) rather than trying to patch it forward to match the new planner's different concepts (slack-based deferral, priority scores) in the same pass.

**Fixed two stale comments** found during the cleanup sweep: one still credited the deleted `planStudyBlocks()` with placing blocks (now correctly references `placeCourseBlocks()`/`planHorizon()`).

**Caught a real mistake mid-edit**: the first attempt at simplifying the diagnostics panel left ~65 lines of orphaned JSX between two conditional blocks — broken structure, not just dead code. Caught immediately via syntax validation, traced, and fixed before proceeding further.

**Verified:** syntax validation after every step; comprehensive grep sweep confirming zero remaining call sites for all four deleted functions; a functional smoke test confirming both the preserved shared utilities (`alignUp15`, `ISO_DATE_RE`) and the real planner (`planHorizon`) still work correctly end-to-end after the deletions; and a real running-server check confirming the served code matches.

## v2.28.0 — 2026-08-31

**Focus Time redesigned to per-row timers; calendar split into three columns**

**Focus Time:** removed the single global timer control row (Plan/General toggle, one "current session" selector) entirely. Each session in the list is now its own timer trigger — minimal design per the request: idle rows show a Play button; the running row shows a live countdown plus Pause/Resume and Complete (no Skip — not needed anymore, since picking a different session is just clicking Play on a different row). Only one row runs at a time; starting a different one simply switches, no confirmation needed since nothing destructive happens to the one left behind.
- `completeSession()` reuses the exact same shared functions and `completionLog` entry shape as `BlockEditModal` and the prior Pomodoro completion logic, so tracking stays one consistent system regardless of which UI triggered it.
- Extracted `findRawDayBlock()` as a shared top-level function — previously duplicated inline inside `Timeline`; now used by both `Timeline` and Focus Time's per-row Complete action.
- Added a small "logged today" indicator to the section header (from `pomodoroLogs`), preserving visibility of actual focused time that the old global control row used to show via its flame badge.
- `Pomo` is now fully superseded — left defined but unused, matching how earlier superseded functions (`planStudyBlocks`) were handled, rather than deleting in the same pass as a big structural change.

**Calendar:** split from two side-by-side columns into three — Morning (7am–12pm), Afternoon (12pm–5pm), Evening (5pm–midnight) — each with a header label, based on a reference layout. `renderColumn()` was already parameterized by hour range from the earlier two-column work, so this was a low-risk change: just three ranges instead of two, plus a new label header per column.

**Verified:** real running-server smoke test confirming the three-column render calls, the per-row Start/Complete controls, and that no orphaned `<Pomo>` usage remains anywhere in the served code.

## v2.27.1 — 2026-08-31

**WhatsApp message also moved on-demand; header buttons now icon-only with tooltips**

- WhatsApp Morning Message moved out of the inline page flow into its own modal, same on-demand pattern as the calendar from v2.27.0. Only shown once the briefing has actually generated something to preview (`brief?.whatsAppLines?.length>0`).
- Both trigger buttons (calendar, WhatsApp) converted from text-labeled buttons to minimal circular icon buttons with `data-tt` tooltips — "View day calendar" / "View WhatsApp message" — keeping the header compact instead of accumulating text-labeled buttons as more get moved on-demand.
- Content in both modals is unchanged — same Timeline rendering, same phone-width WhatsApp bubble as before, just relocated.

**Verified:** real running-server smoke test confirming both icon buttons, the WhatsApp modal, and the state wiring are all present, plus confirmed the inline WhatsApp section title now appears exactly once (the modal's own title) rather than being duplicated inline and in the modal.

## v2.27.0 — 2026-08-30

**Today page restructured: reordered, merged, and the calendar moved on-demand**

1. **"Top Things To Keep In Mind" is now the first content block** — moved from third position (after Deadline Awareness and the Focus Session timer) to immediately after the page header.
2. **Focus Session timer folded into "Today's Focus Time"** — renamed to just "Focus Time," now one merged section: the timer control row sits at the top, the list of today's sessions below it, sharing one card/title instead of two separate ones. `Pomo` gained an `embedded` prop so it can render just its control row (no own card/title) when nested like this — it's still used standalone elsewhere the same way as before.
   - Caught a real regression while merging: the combined section was initially gated on `todayRealBlocks.length>0`, which would have hidden the timer entirely on any day with nothing scheduled — but the timer works fine standalone via "General study" mode with zero real blocks. Fixed: the section always renders; only the total-time badge and the list-vs-empty-state depend on whether anything's actually scheduled.
3. **The daily calendar (Timeline) moved out of the inline page flow into an on-demand modal**, opened via a new "View day calendar" button in the header. Content is unchanged for now (same Timeline component, same "week not planned yet" fallback) — the actual day-view visual redesign is explicitly parked as a separate, parallel effort, not part of this change.

**Verified:** real running-server smoke test confirming the header button, the merged Focus Time title, the embedded Pomo usage, and the calendar modal are all present and correctly wired; confirmed via search that `Pomo` is rendered exactly once now (no duplicate/orphaned standalone instance left over from the merge).

## v2.26.0 — 2026-08-30

**Layout redesign: Timeline goes two-column, WhatsApp message becomes a real phone-style preview**

1. **Focus Session's time range moved to the same line** as the task label (was on its own row below).
2. **Timeline redesigned as two side-by-side columns** (7am–3pm and 3pm–midnight), instead of one long single-column strip. This addresses the "too long + right side empty" complaint directly — those are really the same underlying issue, solved together by using real page width instead of one narrow vertical strip. Extracted a shared `renderColumn()` so both columns use identical rendering logic (hour axis, blocks, now-line, deadline markers), just scoped to different hour ranges. Isolated-tested the split logic itself: confirmed no block is ever duplicated across columns or silently dropped.
3. **WhatsApp message redesigned from a flowing paragraph to a real phone-style preview.** Two changes together: the AI prompt now requests structured content (`whatsAppGreeting`/`whatsAppLines`/`whatsAppClosing` — an array of short, single-topic lines, not one 100-word paragraph), and the rendering shows it in a narrow (320px), phone-width bubble with genuine line-by-line spacing — matching how an actual text message reads, not a wall of prose stretched across a desktop-wide card.
4. **Not directly fixed — the reported "black line" artifact.** Investigated but couldn't conclusively pin down a specific cause from the screenshots alone; the Timeline restructuring in this release is a strong candidate to have resolved it as a side effect, since the whole layout approach changed. Flagged for a follow-up check rather than claimed as fixed without evidence.

**Verified:** the column-split logic was isolated-tested with a realistic day's worth of blocks — confirmed clean separation with no overlap or loss between columns — plus a real running-server smoke test confirming all pieces are present and correctly wired.

## v2.25.1 — 2026-08-30

**Four tuning fixes from continued Today-page feedback**

1. **Duration totals now show "1h 30m" instead of raw minutes.** New shared `fmtDur()` helper — used for the Focus Time total (confirmed against the exact reported value: 270min → "4h 30m") and each session's own duration in the list.
2. **Deadline diamond marker had no visible label** — only a hover tooltip, so it communicated nothing without interaction. Added inline visible text ("Due 11:00pm — MATH 180A: Problem Set 4") next to the marker.
3. **Focus Session now shows the session's actual time range** (e.g. "10:30pm–11:00pm") beneath the task label, not just hidden in a tooltip.
4. **Fixed a real 12h/24h formatting inconsistency**, confirmed in two places: Focus Session's time-range tooltip was using raw `m2t()` (24-hour) while the rest of the app uses `f12()` (12-hour, am/pm) — found and fixed both the Focus Session instance and a second one in Today's Focus Time list, which was also silently showing 24-hour times.
5. **WhatsApp message bubble widened** — confirmed root cause: `.wapp` CSS had a hardcoded `max-width:400px`, a deliberate narrow chat-bubble look that read as wasted space on a full-width card. Widened to use the available width.

**Not yet addressed — needs a direct look at the calendar itself:** the reported Timeline/calendar half-width issue. Code review shows blocks are positioned via `left:4, right:4` (absolute positioning that should force full-width regardless of content), so this doesn't match an obvious bug in the block-width logic itself — flagged for a follow-up with an actual screenshot of the calendar (not just Focus Session) before making a change here, rather than guessing.

## v2.25.0 — 2026-08-30

**Six fixes from real-usage feedback on the Today page**

1. **Focus Session showed a stale session from hours ago.** Root cause: `sessionIndex` only initialized once (on mount/mode-switch) and otherwise only advanced via explicit Skip or a completed cycle — with zero interaction, it never re-checked what's actually current. Fixed with a periodic re-sync (every 60s) that keeps the display honest while idle, freezing automatically the moment a session actually starts running so an in-progress session never gets yanked out from under you.
2. **Deadline Awareness's "no block" label read like a bug when it was working as designed.** Items outside their study-window (per the "plan as late as needed" completion-guarantee logic) correctly have no study time yet — but the label didn't explain that. Changed to "not yet" with a tooltip explaining it's intentional, not a gap.
3. **No prompt to create a study plan after syllabus sync.** `SyncResultModal` now shows a real "Create study plan" action (distinct from just closing) whenever new items were actually added — wired directly to `refreshQuarterPlan()`.
4. **Timeline's blocks didn't visually represent duration at all — a real bug, not just a style preference.** The duration-proportional height (`lineH`) was being *computed* but never actually applied to anything; every block rendered at a fixed 8px regardless of whether it was 15 minutes or 2 hours. Rebuilt as genuine calendar-style blocks: a tinted background fill + colored left-border accent spans the block's real start-to-end time range, with the time and label rendered inside the bar. Verified the height math is now truly proportional (a 2-hour block renders exactly 4× the height of a 30-minute one). Colors are unchanged — confirmed `WeekGrid` and `Timeline` already shared the same `tc()`/`TIMELINE_COLORS` function, so this was a structural fix, not a recoloring.
5. **Timeline had its own nested scrollbar**, redundant with Today's page-level scroll. Removed.
6. **"Verify What We Found" had a border under every row**, which read as noisy across 40 items. Removed row borders, kept the header divider as the only structural line.

**Verified:** isolated math check confirming block heights are now genuinely duration-proportional, plus a real running-server smoke test confirming all six fixes are present and correctly wired in the served code.

## v2.24.1 — 2026-08-30

**Fixed the top-priority gap from the Today assessment: Pomodoro completion now marks the real block complete**

Previously, finishing a Focus Session only appended to `pomodoroLogs` — it never touched the underlying block's `completed` field in `data.studyPlan`. So a session finishing on the timer and a session marked complete via double-clicking the Timeline were two disconnected records; the calendar could still show something as incomplete even after actually running it via the timer.

- When a Focus Session finishes and it's following a real scheduled session (not freeform "General study"), it now also calls `saveBlockToDay()` to mark that block `completed:true`, and `logCompletion()` to append a `completionLog` entry — the exact same functions and entry shape `BlockEditModal` already uses, so completion tracking is one consistent system regardless of which UI actually triggered it.
- Guards against double-logging: only appends to `completionLog` on the genuine false→true transition, matching `BlockEditModal`'s own logic exactly.
- Verified `upd()` uses a functional state update (`setD(prev=>...)`), confirming it's safe to call it multiple times in one handler (once for the pomodoro log, once for the block, once for the completion log) without one call's patch overwriting another's.
- **Isolated-tested** the full sequence: block correctly flips to completed with a timestamp, the `completionLog` entry exactly matches `BlockEditModal`'s shape, and re-completing an already-completed session doesn't create a duplicate log entry.

**Still open from the same assessment** (not part of this fix): the "Today's Focus Time" list view still has no completion display or click interactivity of its own (only the Timeline visualization and now the Pomodoro timer can mark things complete); the "planner diagnostics" panel still tests the old superseded functions.

## v2.24.0 — 2026-08-30

**Today tab: re-hooked to the real plan throughout. This was a genuinely deep disconnect, not a display bug.**

Root cause: `gen()` (which builds everything on Today) called `planStudyBlocks()` — the old, superseded single-day algorithm — directly, completely bypassing `data.studyPlan.weeks` (the real, persisted plan `refreshQuarterPlan`/`refreshWeekPlan` actually produce). **Today's Schedule and Weekly view could show two different schedules for the same day.** The AI was then asked to invent elaborate task descriptions for these fictional slots, which is where the disconnected-sounding text ("Review Python fundamentals - practice writing functions...") came from.

**Found the same bug in three more places** while tracing this:
- Weekly's own day-detail view — called `planStudyBlocks()` fresh again, using `quarterPlan.tasksByDate` for enrichment (which is always empty — that AI call was removed in an earlier session).
- The week-balance summary (study/homework hour totals) — recomputed via the old algorithm instead of reading the real calendar, so its totals could disagree with what's actually scheduled.
- `WeekGrid`'s own "week not planned yet" fallback — silently computed a fictional schedule via the old algorithm instead of showing an honest empty state.
- **A regression I introduced mid-fix**: "Today's Focus Time" reads `brief.studyBlocks`, which `gen()`'s rewrite removed — caught via a careful post-edit sweep, fixed before shipping.

**New shared source of truth:**
- `realDayBlocks(data, dateStr)` — reads directly from the real persisted plan, shaped for `Timeline`/`buildBlocks`. Every place that render a day's schedule now uses this same function — Today's Schedule, Today's Focus Time, Weekly's day-detail view, Deadline Awareness's "planned" checks.
- `weekHasBeenPlanned(data, dateStr)` — distinguishes "never planned" from "planned, legitimately empty" (a real rest day), used for honest prompt states instead of silently substituting a fictional schedule.

**`gen()` rewritten — AI scoped to commentary only:**
- No longer computes any blocks itself. The real plan is given as **read-only context**; the AI is asked only for `oneFocus`/`urgencyAlert`/`gymNudge`/`encouragement`/`whatsAppMessage` — never asked to invent or rewrite task text again.

**New: real tracking mechanism (the other half of "reliable and useful"):**
- Extracted `saveBlockToDay`/`deleteBlockFromDay`/`logCompletion` out of `WeekGrid` into standalone shared functions.
- `Timeline` is now genuinely interactive (opt-in via an `upd` prop): double-clicking a real block opens `BlockEditModal` — including Mark Complete — from Today's Schedule and Weekly's day-detail view, neither of which supported this before at all.

**Known remaining gap, left out of scope for this pass:** the collapsed "Planner diagnostics" panel still tests the old superseded functions directly (`studyTargets`/`freeSlots`/`planStudyBlocks`), so its numbers won't match the real plan. It's a hidden, opt-in dev tool, not part of the main student-facing flow — flagged here rather than silently left stale.

**Verified:** isolated tests of both new core functions (`weekHasBeenPlanned` across planned/unplanned, `realDayBlocks`' exact shape and field mapping, empty-day handling), a comprehensive post-edit sweep for every remaining reference to the old disconnected patterns (which is what caught the regression above), and a real running-server smoke test confirming every new function and call site is correctly wired.

## v2.23.2 — 2026-08-30

**Focus Session: real Plan/General toggle, display-only session text, and Skip that actually skips ahead**

- Replaced the full session-picker dropdown (which listed every individual session today) with a genuine two-option toggle: **Plan** / **General** — matching the request that this be a toggle, not a list.
- The area that used to be a `<select>` is now plain text showing the current session — either the plan-driven one or "General study" — not something you pick from.
- **Skip now means "skip to the next planned session,"** not "flip focus/break." In Plan mode, Skip (and natural completion of a study+break cycle) walks forward through today's session list by index — deterministic and sequential, not re-derived from live wall-clock time on every tick. General mode keeps the old focus/break flip, since there's no "next session" concept in freeform mode.
- Switching to General resets the plan-tracking index; switching back to Plan re-initializes fresh from whatever the live current/next session actually is at that moment — so you don't end up stuck on a stale session from before you switched away.
- **Verified thoroughly** given the state-machine complexity: isolated tests covering initialization from live time, sequential Skip-advance, clamping at the end of today's list, and the switch-away-then-back-to-Plan re-initialization — all four behave correctly. Followed by a real running-server smoke test confirming the new toggle, advance function, and Skip tooltip are all present in the served code.

## v2.23.1 — 2026-08-30

**Focus Session: title restored, matching the other cards' visual style**

- Added a compact title row ("Focus Session" / "Break Time", switching with the timer's actual mode) using the same `sec-title` visual language as every other card on Today (icon + uppercase label) — but without the full `SecHead`'s heavier margin/padding/border, to stay close to the compact footprint from v2.23.0.
- Removed a redundancy this introduced: the mode icon was appearing twice (once in the new title, once in the button row) — removed the duplicate from the row, since the title now carries it.
- New estimated height ≈ 66px vs. the original ~262px (≈25%), right at the originally requested target even with the title restored.

## v2.23.0 — 2026-08-29

**Focus Session: now follows the real plan, compressed to ~17% of its original height**

Previously a large, disconnected utility — its task dropdown listed every open assignment app-wide (not even exams), with no awareness of the actual schedule, and it took up a big stack of the Today screen for a low-value manual picker.

**Logic — now plan-driven by default:**
- New `todaysStudySessions()`/`currentOrNextSession()` helpers — reads today's real scheduled study/homework blocks and picks whichever is active right now, or the soonest upcoming one.
- The timer defaults to *following the plan live*: task label, course, and duration all come from the actual scheduled session, not a manual pick.
- New `PRESET_BREAKDOWN` — when a session's duration exactly matches a preset (30/45/60), the timer runs its real internal study/break split (e.g. 30 → 25 study + 5 break) instead of one flat block. The calendar shows one merged unit by design (see the earlier clock-alignment work); the timer is where that split actually gets guided in real time.
- **Auto-advances** to the next scheduled session once a full study+break cycle completes — not via explicit chaining logic, but because the "current/next" lookup is re-derived live from real time on every render; once break ends and time has passed, the next session's identity naturally flows through.
- Manual override still available via the dropdown — a specific session, or freeform "General study" (falls back to the classic configurable focus/break minutes).

**UI — compressed to one row:**
- Collapsed from 5-6 stacked rows (header, dropdown, 44px timer, progress bar, three full-width buttons, caption) into a single compact row: mode icon → session dropdown → timer (20px) → thin inline progress bar → three icon-only buttons → a small flame badge for today's total (tooltip for the full detail).
- Estimated at ~17% of the original height (44px vs. ~262px), comfortably under the requested 25%.

**Logged for later, not built now:** WhatsApp notification hook (Task backlog / project memory) — the intent is to eventually push a reminder when a session is starting, mentioned as a future direction, out of scope for this pass.

**Verified:** isolated tests of the session-filtering and time-based selection logic (including exact preset-boundary matching), plus a real running-server smoke test confirming the new component and helpers are present and the app serves without errors.

## v2.22.8 — 2026-08-29

**Fixed: Save & Replan stayed gray/disabled even when a replan was actually needed**

Real functional bug, not just a color issue: the button's color and `disabled` state were both based only on `diffDirty` (unsaved form edits). After a plain Save, `diffDirty` resets to false — so once `planStale` (v2.22.7) was introduced, the button went gray *and disabled*, meaning there was no way to click it to resolve the very warning it's meant to fix.

- Both the color and `disabled` logic now check `diffDirty || data.planStale` — amber and clickable whenever either unsaved edits exist OR the plan is stale from a prior plain Save.
- Safe to enable in the stale-only case: `saveDifficultyAndReplan()` calls `saveDifficulty()` first regardless, which is a harmless no-op re-save when nothing's actually changed, then replans.
- Tested all four state combinations (fresh/dirty/stale/both) — all behave correctly, including the specific case that was broken.

## v2.22.7 — 2026-08-29

**New: "plan not updated" warning after a plain Save**

Addresses a real gap: if you click Save (not Save & Replan) in Study Preferences, your changes are recorded but the calendar doesn't reflect them yet — and the existing "unsaved changes" dot clears immediately on save, so there was no ongoing signal that the plan itself was now stale.

- New persisted `data.planStale` flag — distinct from `diffDirty` (unsaved *form* edits). This tracks "saved, but not yet reflected in the calendar," and survives tab switches and reloads (it's real data state, not just component state).
- Set to `true` whenever plain Save runs. Cleared to `false` whenever an actual replan completes — either `refreshQuarterPlan()` (Refresh Plan / Save & Replan) or `refreshWeekPlan()` (Update this week).
- Shown as a small amber warning line under the Study Preferences header: "Current plan doesn't reflect your latest saved changes — Save & Replan to apply."
- Chose a persistent text warning over a blinking icon (an option considered) — clearer, more accessible, and won't get missed the way a blink easily can.

## v2.22.6 — 2026-08-29

**Study Preferences: Save/Save & Replan moved up next to the "?" icon**

- Moved from the bottom of the table (where they were easy to miss — including missing the unsaved-changes dot on the tab itself, since it's not visible without scrolling down) up to the header row, next to "?".
- Converted to icon-only, matching the "?" button's 28px circular sizing (up slightly from "?"'s own 22px for a bit more tap target, still compact). Tooltips added since there's no text label anymore: "Save changes" and "Save & Replan — also updates your calendar right away".
- Save & Replan swaps its icon for a spinner while planning, instead of showing "Planning..." text (no room for text in an icon-only button) — the `planMsg` status line still appears, now right-aligned just under the header row instead of under the old bottom button row.
- Both buttons keep their existing amber-highlight-when-dirty / gray-when-clean states, just via icon color instead of button fill.

**Verified:** real running-server smoke test — confirmed the new tooltips and icon are present exactly once each, and the two other unrelated "Save changes" buttons elsewhere in the app (inline assignment/exam editing) are untouched.

## v2.22.5 — 2026-08-29

**Study Preferences: replaced the busy intro paragraph with a "?" help banner**

- Removed the always-visible descriptive paragraph at the top of Study Preferences.
- Added a "?" icon button next to the title — opens a help banner with the explanation, partitioned by topic (Difficulty, Hours, Your inputs always win, Save vs. Save & Replan).
- New `InfoModal` component: deliberately has **no backdrop-click-dismiss**, unlike the existing `ConfirmModal` — the student must explicitly click "Got it" to close it, so it can't be accidentally skipped past.
- Caught and fixed a real mistake mid-edit: adding `InfoModal` accidentally deleted `ConfirmModal`'s own function declaration line, orphaning its body. Found via syntax validation and fixed before shipping.
- Copy describes the near-term difficulty-research and personalization features we're about to build, not what exists today (`webDifficultySignal()` is still a stub) — this banner should not ship to real use until that work lands, per the same principle as the earlier De Anza cleanup: don't let the UI describe behavior the code doesn't actually have yet.
- Verified against a real running server: both `InfoModal` and `ConfirmModal` exist as separate, correctly-formed functions, and the app serves without errors.

## v2.22.4 — 2026-08-29

**Weekly view button consolidation**

1. **Moved "+ Add Activity" and "Update this week" into the main header row**, alongside Clear plan/Refresh Plan — previously they lived separately, absolutely-positioned inside `WeekGrid`'s own time-axis area. Required lifting `editState` (the Add-Activity/edit-block modal state) up from `WeekGrid` into the parent `Week` component so the button could move while the modal still works correctly from either the new header button or double-clicking a block.
   - Caught and fixed a real mistake mid-edit: removing the old buttons accidentally deleted `weekKey`/`storedWeek`, which turned out to still be needed elsewhere in `WeekGrid` (the day-rendering live-computation fallback). Restored before shipping.
   - "+" icon enlarged by exactly 2px (13px → 15px, matching `.btn-sm`'s actual 13px base font-size rather than an approximate relative increase).
   - Button order: Update this week → Add Activity → Clear plan → Refresh Plan, keeping Refresh Plan last/rightmost (needed for its edge-tooltip fix below to stay correct).
2. **Refresh Plan's tooltip was clipped at the right edge — fixed.** Combining the existing `.tt-below`/`.tt-right` classes naively would have conflicted (both set `transform`, so one would silently override the other's positioning). Added a dedicated compound selector `.tt-below.tt-right` with the correct combined values, applied to Refresh Plan specifically.

**Verified:** syntax validation, and an actual running-server smoke test (not just isolated logic) — started `server.js` for real, confirmed the main app and `app.js` serve correctly with the new button/state wiring present.

## v2.22.3 — 2026-08-29

**Four small UI fixes from first-run feedback**

1. **Homework tooltip missing class name — fixed.** Root cause: the homework block label was built as `${item.title} (due Xd)` only — unlike exam-prep and regular-study labels, which already included the course name. Now: `${item.courseName} — ${item.title} (due Xd)`.
2. **Clear Plan / Refresh Plan tooltips displayed too high, clipped at the top edge — fixed.** There was previously no "opens downward" tooltip variant, only left/right edge variants for horizontal clipping. Added `.tt-below` (opens below the element instead of above) and applied it to both buttons, which sit at the top of the Weekly view. Also widened the tooltip's max-width from 240px to 280px.
3. **"Planning" spinner still showing on tab click — real root cause found, not CSS residue.** The Today view's `gen()` function calls the shared `ai()` wrapper on mount to enrich task text, which sets a single global `busy` flag — the exact same flag the Weekly "Refresh Plan" button's "Planning..." text was tied to. Landing on Today (auto-runs `gen()` if not cached) then clicking into Weekly while that unrelated call was still in flight made the Refresh Plan button look like it was planning, even though nothing planning-related was happening. Fixed with a dedicated `planning` state, set only by `refreshQuarterPlan`/`refreshWeekPlan`, now used by Weekly's Refresh Plan, Study Preferences' Save & Replan, and Settings' Save & Replan — completely decoupled from the general AI-call `busy` flag.
4. **15-minute blocks off by 1px vs. other block heights.** Gave the block's outer container an explicit `height` matching the position math exactly, instead of relying on the browser's natural content-flow height to coincidentally match — most likely to drift on no-label (short-duration) blocks, which have less content to naturally fill the assumed space.
5. **Chunk ordering within a topic (e.g. 15>30>30 instead of 30>30>15) — fixed.** Root cause: `placeCourseBlocks()` placed multiple items' chunks in priority order — so a higher-priority item left with only a small remainder (e.g. 15 min to finish) claimed the day's earliest slot just by being processed first, even though a lower-priority item had a much bigger chunk to place. Fixed by splitting allocation from placement: which item gets how many minutes is still entirely priority-driven (Pass 1, unchanged), but the order they're actually placed into the day's time slots is now size-descending (Pass 2) — whoever has the most time today claims the earliest slot, and any small leftover naturally lands last.

**Testing:** reproduced the exact reported ordering bug (high-priority item with a 15-min remainder vs. a lower-priority item needing 60 min, both forced candidates) and confirmed the fix produces 30→30→15. Re-ran the full regression suite: two-item priority completion (zero shortfall), grid alignment, zero overlaps, the due-2 slack-deferral behavior, and manually-edited blocks — all still correct.

## v2.22.2 — 2026-08-29

**"Plan as late as needed, not as early as possible" — slack-based deferral**

v2.22.1 fixed the floor (never start outside the 5/7-day window). This fixes the ceiling within that window: previously, a solo item with no real competition still front-loaded onto the very first eligible day, since "eligible" and "gets scheduled" were the same thing whenever nothing else needed that time.

- Refined the buffer model per discussion: **due-date itself (day 0) stays a hard wall** — never scheduled, no exceptions. **Due-1 is now a soft emergency fallback**, not a separate hard rule — it stays available when genuinely needed (preserves the completion guarantee — never silently drop something to protect a buffer day) but is no longer a normal target. **Due-2 is the preferred finish line.**
- Added a slack check to `planDayV2()`'s Tier 1 candidate filter: an item within its window is only a *real* candidate today if there's no longer enough runway to defer it further and still finish by due-2 (computed via `remainingPreferredDays - daysNeededIfStartedNow`). If it could still be fully covered by starting later, it's deferred — no change to `preflightRiskCheck()`, which still needs to see the full window since its job is feasibility, not preference.
- Verified with the exact motivating case: a solo 90-minute homework item due in 5 days, zero competition — previously landed entirely on day 0; now lands entirely on day 3 (the due-2 target).
- Full regression suite re-run and passing: two-item priority competition still completes both with zero shortfall, grid alignment and zero-overlap checks still hold, the 58/73-day-out exclusion from v2.22.1 still works, and manually-edited blocks are still correctly respected as occupied time.

## v2.22.1 — 2026-08-29

**Fixed real regression from v2.22.0: no "start too early" window was enforced**

Confirmed via testing: the planner allocated study time for an exam 58 days out and homework 73 days out — the old `studyTargets()` had exactly this kind of window (`HOMEWORK_WINDOW=7`, and each exam's own `prepDays` field), but the v2.22.0 rewrite dropped both when building the new candidate list, so any item was "eligible" the instant it existed.

- Added `startWindowDays` to each item in `buildItemDemand()` — homework gets a fixed 5-day window (`HOMEWORK_START_WINDOW_DAYS`); exams use their own per-exam `prepDays` field (which already existed and was already editable per-exam — the bug was that the new planner just never consulted it).
- `prepDays` default bumped from 5 to 7 everywhere it's set (new exam creation via sync/manual-add, form defaults) — matches "6-7 days" as the more conservative default.
- Both `planDayV2()`'s candidate filter and `preflightRiskCheck()`'s valid-days calculation now enforce this upper bound (in addition to the existing 1-day lower-bound buffer near the due date), so pre-flight predictions stay consistent with actual placement.
- Hard cutoff, matching how the old system worked: before an item's window opens, it's simply not a candidate — Tier 2 regular study fills the day instead, so time doesn't sit idle waiting.
- Verified with the exact reported scenario: an exam 58 days out and homework 73 days out get zero dedicated time today; confirmed the exam correctly activates exactly 7 days before its due date, and the homework exactly 5 days before.

**Logged for later, not addressed yet:** how to treat large/project-style assignments differently from regular homework (e.g. a longer start window, since a multi-week project shouldn't wait until 5 days out).

## v2.22.0 — 2026-08-29

**The Phase 2 planner — full integration. This replaces the core scheduling algorithm.**

Every rule from the planner design, built and unit-tested as a standalone prototype over several sessions, is now wired into the real app, replacing `studyTargets()`/`planStudyBlocks()`'s old memoryless per-day-independent ramp logic.

**New core functions** (`app.js`):
- `buildItemDemand()` — candidate list of deadline-driven items (assignments/exams), reusing the hours/difficulty already computed by Study Preferences.
- `placeCourseBlocks()` — places one course's session(s) for a day, back-to-back within the same topic (minimize switching), depleting each item's `remainingMinutes` in place.
- `consumeTopicBuffer()` — the 15-minute gap enforced between *different* topics.
- `planDayV2()` — one day's full placement: Tier 1 (deadline-driven items, real priority-score-based primary/secondary split) then Tier 2 (regular per-course study with no specific deadline, fills any leftover capacity so idle time isn't wasted, but never at the expense of real deadline pressure).
- `preflightRiskCheck()` — the completion-guarantee rule: simulates allocation across the WHOLE horizon using real per-day capacity before any placement happens, catching a mathematically-unavoidable shortage immediately rather than after the fact.
- `planHorizon()` — the stateful multi-day orchestrator: cross-day depletion tracking (an item planned Monday correctly has less remaining demand by Wednesday — the old system had no memory between days at all), pre-flight risk detection, and a final planned-vs-desired summary per item.

**Real bug found and fixed during this integration** (not just new code): `refreshQuarterPlan()` was calling `planStudyBlocks(dateStr,data)` with no `userEditedBlocks` argument at all — meaning `freeSlots()` had no idea a manually-edited block already occupied time when generating new ones, a real overlap risk. Fixed: both `refreshQuarterPlan()` and `refreshWeekPlan()` now gather each day's existing `userEdited` blocks up front and pass them through correctly.

**Wired in:**
- `refreshQuarterPlan()` and `refreshWeekPlan()` both now call `planHorizon()` instead of the old per-day loop.
- New `profile.sessionPreset` field (30/45/60, default 30) — new Settings control under "Study preferences," clearly distinguished from the older Focus/Break fields (now labeled "Pomodoro timer only," since that's all they still drive).
- `sessionPreset` added to the plan-relevance list (v2.21.1) so changing it correctly triggers "Save & Replan."
- Post-refresh toasts now report the real outcome: "Everything fits!" or, per the completion-guarantee rule, an explicit list of which items came up short and by how many hours — never a generic "done" that hides a real shortage.

**What's superseded, not deleted:** `planStudyBlocks()`/`studyTargets()` remain in the file, clearly marked superseded, no longer called anywhere — kept temporarily per the lesson learned from the DEANZA/useDA cleanup (don't remove working fallback code in the same pass as a large new system). Slated for removal once the new system is confirmed working in real use.

**Testing performed:** isolated end-to-end tests of `planHorizon()` covering realistic courses/assignments/exams — confirmed grid alignment, zero overlaps (including with manually-edited blocks correctly treated as occupied time), correct 1-day-buffer enforcement, priority correctly favoring higher-stakes items, and re-tested with different settings (45-min preset, evening energy peak) to confirm variety works. **Not yet tested:** live in the actual running app with real data — that still needs verification on your Mac.

## v2.21.1 — 2026-08-29

**Two fixes: transparent dropdown (real bug), and unconditional replanning**

1. **College autocomplete dropdown background was transparent — confirmed real bug.** I'd used `var(--card1)`, but that CSS variable doesn't exist anywhere in this app (only `--card`/`--card2`/`--card3` are defined). An undefined CSS variable with no fallback resolves to nothing, so the dropdown had no background at all, letting the fields behind it show through. Fixed to `var(--card3)`. Also swept every other `var(--x)` usage in the file against what's actually defined — found nothing else wrong (the sweep's other "hits" turned out to be a regex limitation on my part catching only the first of two variables declared on one CSS line, not real bugs).
2. **"Save & Replan" now only actually replans when something plan-relevant changed.** Previously it unconditionally ran a full quarter-wide replan on ANY profile change, including things with zero effect on scheduling (name, phone, address). Added `PLAN_RELEVANT_FIELDS` — term dates (per the request), plus the other fields that genuinely feed the scheduler (wake/sleep/meal times, focus/break length, energy peak, gym days). Only a change to one of these triggers the actual replan; everything else just saves quietly with a toast explaining why nothing was replanned.
3. Added a tooltip on the button explaining what it does and when it actually replans vs. just saves.
4. Isolated-tested the plan-relevance check across four cases: phone-only change (no replan), school name/address change (no replan), term-date change (replan), wake-time change (replan) — all behave correctly.

## v2.21.0 — 2026-08-29

**School name + term dates now required to complete onboarding**

- Onboarding's School step previously only had School name / Schedule type / Address — Term start/end weren't shown there at all (only in Settings). Added them, matching Settings' layout (short labels, note below the End field).
- "Continue" is now disabled unless School name, Term start, AND Term end are all filled in — Schedule type always has a valid value already (dropdown defaults to Quarter, can never be truly empty), so it's satisfied automatically.
- Address remains explicitly optional, marked `(optional)` — whether it ends up auto-filled or manually typed, it's never required to proceed.
- Required fields marked with a red `*`.
- Updated the step's description text to explain *why* these are required (everything else in the app depends on knowing the actual term) instead of the old, now-stale "Not hardcoded — update when you transfer to UCSD" message.
- Isolated-tested the gating logic across all relevant combinations: nothing filled, partial fills, and the exact case of all three required fields present with address still blank.

**Scope note:** this gates onboarding specifically — the first-time setup flow. It doesn't add an ongoing lock elsewhere in the app if these fields were somehow cleared later in Settings after onboarding is already complete. Flagged separately in case that's also wanted.

## v2.20.1 — 2026-08-29

**Fixed the actual bug behind v2.20.0's non-functional auto-fetch**

Confirmed via testing: address/schedule type/term dates never populated after selecting a college. Root cause found in `/api/college-calendar`'s response parsing, not the tool wiring itself (verified against Anthropic's current docs — `web_search_20250305` needs no beta header and was correctly configured).

- The bug: when Claude uses the web search tool, it typically emits a **separate narration text block** before searching ("I'll search for...") and the real final answer in a **later** text block after results come back. The server was concatenating *every* text block together — producing malformed input like `"I'll search for X...{ actual JSON }"`, which `JSON.parse()` rejects every time. This silently failed on essentially every real request.
- Fix: only the **last** text block is used (the actual final answer), plus a regex safety net that extracts just the `{...}` substring even if any stray text still surrounds it.
- Added server-side logging of the raw model output on any remaining parse failure, so future issues are diagnosable from the terminal instead of a silent 500.
- Added `max_uses: 5` to the tool definition (sensible bound for a factual few-search lookup, per Anthropic's own guidance).
- Verified with a test that replicates the exact multi-block response shape from Anthropic's own documentation example: confirmed the OLD logic fails on it (`Unexpected token 'I', "I'll searc"...`) and the NEW logic correctly extracts and parses the JSON.

**Still needs your real-key testing** — this fixes a proven, reproducible bug in the parsing logic, but I still can't run this against the live Anthropic API myself.

## v2.20.0 — 2026-08-29

**College calendar auto-fetch + School Info UI fixes**

UI fixes (from screenshot feedback):
- Fixed Start/End term-date field misalignment — both now use short symmetric labels ("Start"/"End") instead of one field having a much longer wrapping label than the other.
- Moved the "last day of finals, not last day of class" clarification below the End field instead of cramming it into the label.

New: auto-fetch address, schedule type, term dates, and holidays when selecting a college —
- New server endpoint `/api/college-calendar` — uses Claude's `web_search` tool (the plain `/api/ai` proxy has no tool access) to find a school's real address, quarter/semester system, and current/upcoming term dates + holidays from official sources. None of this is reliably knowable from training data alone, since term dates change every year.
- `CollegeAutocomplete` gained an `onSelect` callback (fires only on an actual pick, distinct from `onChange` which fires every keystroke) — this is what triggers the fetch, not free typing.
- New shared `fetchCollegeCalendar()`/`applyCollegeCalendarResult()` — used identically by both onboarding and Settings, so selecting a college in either place has the same effect. Only fills in whatever the lookup actually found; a field the lookup couldn't determine is left untouched (null), not overwritten with nothing.
- Fills `schoolAddress`, `schoolType`, `termStart`/`termEnd`, and the new `collegeCalendar` field (quarters + holidays) — all remain fully editable afterward, same as any other field.
- Loading indicator shown while the lookup runs; graceful toast on failure ("please fill in manually") rather than a silent no-op.

**Testing status — please read before relying on this:** I don't have a real Anthropic API key in my build environment, so I could only verify the endpoint's plumbing (confirmed it correctly reaches the real Anthropic API and gets a real 401 back with a placeholder key, confirmed missing-input validation, confirmed no regression to existing endpoints). **The actual search quality — whether it reliably finds the right school, the right term, and correctly-formatted dates — has NOT been tested with a real key and needs verification on your machine.**

## v2.19.0 — 2026-08-29

**College autocomplete — School name is now a live-search field, not plain text**

- Added `public/data/us_colleges.json` — 2,348 US institutions (name + domain), sourced from the open `Hipo/university-domains-list` dataset, ~140KB.
- Added `searchColleges()`/`generateAcronym()` — ported directly from the validated sandbox prototype. Matches full names, partial substrings, AND generated acronyms (typing "MIT", "UCSD", or "UCLA" resolves to the right school even though the dataset only has full names).
- Added `CollegeAutocomplete` component: free-typing input with a live-filtering dropdown. Dataset is fetched lazily on first focus (not on every app load, since most sessions never revisit this screen). Selecting a suggestion sets the canonical name; typing without selecting still works exactly like the old plain field — some schools genuinely aren't in the dataset, and free-typing stays fully supported.
- Replaced the plain "School name" text input with this component in both onboarding and Settings.
- Caught and fixed a real mistake mid-build: an earlier edit accidentally sliced through a pre-existing comment, leaving a broken fragment merged with `ExtractionVerifyModal`'s docs. Cleaned up before shipping.
- Verified end-to-end against the actual running server (not just isolated logic): started `server.js` for real, confirmed `/data/us_colleges.json` serves all 2,348 entries with UCSD present, confirmed the main app and `app.js` (including the new functions) serve correctly.

## v2.18.1 — 2026-08-29

**Cleanup: fully removed DEANZA/useDA — not just unused, actively misleading**

v2.18.0 generalized the core term/holiday functions away from `DEANZA` but left the constant and the `useDA` checkbox sitting in the code as "harmless" leftovers. That was the wrong call — `useDA` no longer did anything (both onboarding and Settings still showed a working-looking "Use De Anza calendar" checkbox that silently did nothing when toggled), which is worse than dead code, it's misleading UI.

- Deleted the `DEANZA` constant entirely.
- Removed `useDA` from the profile schema.
- Removed both non-functional checkboxes (onboarding + Settings).
- Settings' term-dates section now always shows (previously hidden when `useDA` was checked) — matches actual current behavior, since `getTermRange()` already falls back to manual `termStart`/`termEnd` whenever no `collegeCalendar` is set, no flag needed.
- Confirmed zero remaining references to either name anywhere in the file.
- Re-ran the v2.18.0 isolation tests post-cleanup — all still pass.

## v2.18.0 — 2026-08-29

**Calendar module, step 1: generic college calendar support + US federal holiday baseline**

First piece of generalizing away from the De Anza-specific hardcoding toward any-college support, per the calendar-module design.

- Added a rule-based US federal holiday calculator (`usFederalHolidays()`/`federalHolidayName()`) — computes nth-weekday and fixed-date holidays with weekend-observance shifting, for any year, without needing per-year data updates.
- `getQ()`, `isHol()`, `isFin()`, `getTermRange()` are now generic — they read from a new `profile.collegeCalendar` field (same `{quarters, holidays}` shape De Anza's hardcoded data always had), not the De Anza-specific `DEANZA` constant. Works for any school once `collegeCalendar` is populated.
- Federal holidays now apply **unconditionally**, independent of whether a college-specific calendar has been fetched — the "no school at minimum" baseline this was built for.
- Fully backward compatible: with no `collegeCalendar` set, term range still falls back to manually-entered `termStart`/`termEnd` exactly as before.
- `DEANZA`/`useDA` are left in place untouched (not deleted) but no longer referenced by these core functions — safe to remove in a later cleanup pass once the new college-selection UI replaces the old onboarding/Settings fields.
- Isolated-tested: federal baseline with an empty profile, old-style manual term entry, and a full non-De-Anza example (UCSD) covering term range, a school-specific (non-federal) holiday, the federal baseline layered on top, and finals-week detection.

**Not yet done:** the college autocomplete UI, and the fetch flow that actually populates `collegeCalendar` for a real school (both validated separately in a standalone prototype — not yet wired into the app).

## v2.17.3 — 2026-08-29

**Fixed: block end times weren't grid-aligned — only starts were**

v2.15.0 aligned every planner-placed block's *start* to the :00/:15/:30/:45 grid, but never required the block's *duration* to be a multiple of 15 minutes — so a leftover "need" shorter than a full focus session (e.g. 21 minutes remaining of a day's regular-study target) produced a perfectly-aligned start with an off-grid end (4:30–4:51). This actually affected every block, not just edge cases: the default 25-minute focus length itself isn't a multiple of 15, so even "full" sessions ended off-grid.

- `planStudyBlocks()` now rounds each chunk's *duration* to the nearest 15-minute multiple (`Math.round(rawChunk/15)*15`), not just its position.
- This nudges the typical full-length session from 25 to 30 minutes — a small, deliberate overshoot, since these are soft daily targets rather than hard caps, and happens to land exactly on the smallest of the previously-discussed session presets (30 = 25 study + 5 break).
- Chunks that would round to 0 (raw length under ~7.5 min) are skipped, same "not worth a sliver" principle as before, just now tied to the 15-min grid instead of a flat 10-minute floor.
- Isolated-tested: both a small-leftover-need scenario (reproducing the reported 21-minute case) and a multi-chunk day (four consecutive sessions) — every block now starts and ends on the grid, with no overlaps introduced.

## v2.17.2 — 2026-08-29

**Consistency fix: reused the existing Enter-confirmation checkmark instead of leaving Hours with none**

`GradeInput` (used in Exams/Assignments) already had exactly this pattern — a `justConfirmed` state showing a green checkmark for 1200ms after pressing Enter. `HoursInput` (added in v2.17.1) had no such feedback at all. Ported the pattern directly rather than designing something new: same state name, same icon, same color, same timing, same fixed-padding approach (space for the checkmark is permanently reserved, not toggled, so the field doesn't shift width when it appears/disappears).

## v2.17.1 — 2026-08-29

**Hours field actually fixed this time — real root cause was different from v2.16.3's fix**

v2.16.3 removed a per-keystroke clamp, but that wasn't the actual bug. The real problem: the field's displayed value was derived directly from a *parsed number* (`userHours ?? aiHours`) on every render. The moment you backspaced to empty, `userHours` became `null`, and the controlled input immediately snapped to showing `aiHours` instead — so clearing the field never actually looked empty, it looked like backspacing did nothing (or "restored" a different number). Same underlying issue made Enter feel broken, since there was no commit step at all — every keystroke round-tripped straight to parent state.

- New dedicated `HoursInput` component: manages its own local text state while typing (so partial/empty states like `""` or `"0."` stay exactly as typed, never fought by the controlled value).
- Only commits to the parent — and only if the value actually changed — on **blur** or **Enter**. Enter also blurs the field, giving a real "confirm and done" action.
- Simplified `setHoursOverride()` to just store an already-validated number: `HoursInput` now owns all the parsing.
- Blurring an untouched field (still showing the AI suggestion, unedited) no longer manufactures a spurious override — only genuine changes get committed.

## v2.17.0 — 2026-08-29

**Design update: Clear plan now preserves history**

- Clear plan (both the normal pass and the force-clear follow-up) now only touches **today and forward** — any day before today is left completely untouched, regardless of `userEdited` status. History is a record of what actually happened, not clearable plan data.
- Applies at every stage: the initial count (`toClear`/`toKeep`), the confirm dialog wording, the normal clear, and the force-clear-everything follow-up all now respect the today-forward boundary.
- Isolated-tested: past-day blocks (edited and unedited) remain byte-identical before and after both the normal clear and the force-clear pass; only today-forward blocks are ever touched.

## v2.16.4 — 2026-08-29

**Clear plan: force-clear option for stale/mis-flagged blocks**

- The v2.16.2 fix to `BlockEditModal` only changes behavior going forward — it can't retroactively know whether an already-saved `userEdited:true` block was genuinely authored/customized by the student, or just mistakenly flagged by the old (pre-fix) code when completion was toggled. Any such block from before the fix stays permanently marked, and Clear plan will keep protecting it, since from the data's perspective it looks the same as a real manual edit.
- Fixed by making Clear plan itself surface and offer to resolve this: it now reports how many blocks would be cleared vs. kept *before* running, and — if any are kept — offers a second, explicit follow-up prompt to also clear those for a fully clean slate. This handles genuinely stale/mis-flagged blocks from before v2.16.2, and doubles as a real permanent option any time a fully blank slate is wanted, without weakening the normal (safe) default behavior.

## v2.16.3 — 2026-08-29

**Fixed: Hours field in Study Preferences didn't accept typing**

- `setHoursOverride()` was force-clamping the value to a 0.5 floor on every single keystroke (`Math.max(0.5,+value)`), which fought the controlled input as you typed — any intermediate value (e.g. mid-way through typing a decimal, or briefly empty while backspacing) got silently snapped back before the next character could register. This made the field feel unresponsive to backspace/typing/Enter.
- Fixed to match the simpler pattern already used by the working "Est. hours" field elsewhere in the app: store the raw parsed value on every keystroke, no per-keystroke clamping. An empty field still falls back to displaying the AI suggestion, same as before — only the fighting-the-input behavior is fixed.

## v2.16.2 — 2026-08-29

**Two real bugs found from testing — both fixed at the root**

1. **"Clear study plan" wasn't purging completed blocks — root cause: `BlockEditModal` conflated completion with authorship.** Every save from that modal set `userEdited:true` unconditionally, even when the *only* change was checking "Mark Complete" on a plain AI-planned block. Clear study plan correctly protects `userEdited` blocks (by design) — but a block simply being marked done was wrongly making it permanently immune to clearing. Fixed: `userEdited` is now only set to `true` when the block's actual content changed (description, time, or course) or it's brand new. Toggling completion alone no longer flags a block as user-authored, so Clear study plan now genuinely purges completed-but-otherwise-planner-generated blocks.

2. **Study Preferences spinner — closed the remaining gap for pre-existing data.** v2.16.1 stopped new items from ever needing repeat computation, but any item that already existed before that build (created before `computeEstimateFields` existed) still had no stored estimate, and would recompute on every visit until the student happened to click Save. Fixed: whatever gets freshly computed on a visit is now immediately cached back to `estimatorValue`/`aiHours` on the item — separate from the student's actual review (`userValue`/`userHours`/`reviewedAt` stay untouched) — so this is now a genuine one-time migration for old data, not a recurring one, with no need to click Save just to make the spinner stop.

## v2.16.1 — 2026-08-29

**Two follow-up fixes on v2.15.1**

1. **"Clear study plan" relocated** — moved from Settings to the Weekly view, right next to "Refresh Plan," since that's where it's actually used. Removed from Settings (not duplicated).

2. **Study Preferences tab no longer auto-recomputes on every visit — root cause fixed, not just patched.** v2.16.0's earlier fix (skip if `reviewedAt` is set) only prevented recompute *after* the student clicked Save — every visit *before* saving still recomputed every item from scratch, which is what was actually being seen. The real fix: estimate computation now happens once, at item-**creation** time (syllabus sync, manual add) — an already-agreed trigger — via a new shared `computeEstimateFields()` helper, instead of lazily whenever the tab happens to be opened.
   - `finalizeSync()` now computes and stores `estimatorValue`/`aiHours` for every new assignment/exam as it's created (sync progress label updated to reflect this: "Matching courses, saving & estimating study time...").
   - Manual "Add assignment"/"Add exam" now do the same. For assignments, the hours typed into the add form are now stored as an explicit `userHours` override (respecting what the student already chose) rather than being silently replaced by the AI suggestion later.
   - The tab's skip condition changed from `reviewedAt!=null` (post-Save only) to `estimatorValue!=null` (computed at all, regardless of review status) — so a genuinely-already-computed item is reused instantly on every visit, no spinner, whether or not it's been saved yet.
   - Only truly legacy items that predate this change (imported before `computeEstimateFields` existed) still trigger a real computation on tab visit — a one-time migration path, not the normal case going forward.

## v2.16.0 — 2026-08-29

**Difficulty tab → Study Preferences: hours, priority, and no more redundant recompute**

This is the first concrete piece of the two-phase planner design (Phase 1: Estimate & Prioritize).

- **New "Hours" column** — AI-suggested study hours per item, editable same as the difficulty dropdown. New function `estimateStudyHours(item, course, kind)`: `total_hours = base_hours(type) × difficulty_multiplier(course) × weight_scaling(item stakes)`. For assignments, this feeds the existing `estimatedHours` field the scheduler already reads. For exams, this is a genuinely new field (`estimatedHours` didn't exist on exams before) — not yet read by the scheduler, that wiring is a separate follow-up step.
- **New "Priority" column** — computed, read-only. New function `computePriorityScore(dueDate, effectiveDifficulty, weight)`: `priority = urgency_factor(days_until_due) × difficulty_weight × grade_weight%`. `urgency_factor` is flat at 1.0x beyond 14 days out, ramps linearly to 2.0x by the due date — no drastic spike, per agreed design. Sortable, like the other columns. Not persisted — always computed live since it depends on "today."
- **Fixed the recompute-on-every-visit bug** — previously, every assignment/exam's difficulty estimate was recalculated from scratch every time this tab mounted (i.e. every tab switch), showing a "Computing..." spinner each time. Now only items with no `reviewedAt` (never before reviewed) get a fresh (async) computation; already-reviewed items reuse their stored values instantly.
- **Added "Save & Replan"** next to the existing "Save" — runs the same replan as Weekly's Refresh Plan button immediately after saving, so edited hours/difficulty/priority take effect right away instead of sitting unused until some other action triggers a refresh.
- Renamed the tab from "Difficulty Estimates" to **"Study Preferences"** to reflect its expanded scope — this is now the persistent, revisitable Phase 1 screen from the planner design, not just a one-time difficulty rating exercise.
- New fields added to assignment/exam objects on Save: `aiHours` (AI suggestion at last save), `userHours` (student override, null if accepting the AI suggestion).

**Not yet done (separate follow-up):** wiring `studyTargets()`/`planStudyBlocks()` to actually read `estimatedHours`/effective difficulty on exams and the new priority score — today's scheduler still uses its own independent heuristics, unaware of anything computed on this tab.

## v2.15.1 — 2026-08-29

**Settings: "Clear study plan" button**

- New button in Settings, next to "Reset all data" — clears just the generated study plan (`studyPlan.weeks`, `quarterPlan`) so you can regenerate fresh via Refresh Plan.
- Courses, assignments, exams, and profile are untouched.
- Any manually-added/edited blocks (`userEdited:true`) within each week are preserved, not wiped — consistent with how Refresh Plan already protects manual edits.
- Added for two reasons: (1) testing new planner logic without needing a full "Reset all data" wipe, (2) genuinely useful for normal use — e.g. after a big schedule change, clearing and regenerating is cleaner than living with a stale plan until the next full refresh.

## v2.15.0 — 2026-08-29

**Planner: clock-aligned study block placement**

- `planStudyBlocks()` now snaps every planner-generated study/homework block's start time to the :00/:15/:30/:45 grid.
- Added `alignUp15(m)` helper — rounds a minute-of-day value up to the next 15-minute mark; no-op if already aligned.
- Fixes off-grid placements like a study block starting at 10:50 right after a class ends — now snaps to 11:00.
- Scope: only affects planner-placed blocks (study/homework). Real fixed events — class times, meals, gym, adhoc/manual entries — are untouched, since they never pass through this placement loop, only `freeSlots()`'s gap output does.
- The small leftover sliver between a gap's real start and its aligned start (always under 15 min) is discarded, same treatment as any other sub-10-minute leftover.

*Earlier version history was not tracked in a changelog file — see project memory / past session notes for prior changes back to the original block-schema and persistent-planning infrastructure work.*
