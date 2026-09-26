# StudyOS — Project Context

Read this before starting any work. It's the distilled context from a long prior development
session (done via Claude's web chat, not this terminal) — architecture decisions, established
conventions, and hard-won lessons. Keep it updated as the project evolves; it's a living document,
not a one-time snapshot.

## What this is

A personal AI-powered study assistant, built for Itay (a UCSD Data Science student) by his parent
Avishai, who is the sole developer and product decision-maker. Single-user, runs locally.

**Stack:** Next.js (Turbopack) + React, client components ("use client") — a real build step now,
not the original Babel-CDN/no-build setup. Backend is Supabase (Auth + Postgres, RLS-scoped
per-user data, `supabase/schema.sql`), replacing the original JSON-file store — `lib/data/store.js`
is the one place that talks to it (`load()`/`save()`). Anthropic API proxied server-side. Runs via
`npm start` on `localhost:3000`, working directory `~/studyos`. **Build/restart ordering matters
and has burned real time twice in one session:** `npm run build` must run and complete BEFORE
`lsof -ti :3000 | xargs kill -9 && nohup npm start &` — restarting from a build made before your
latest edit (or, just as easily, editing `lib/version.js` for a version bump AFTER the last build)
means the server silently serves stale code while every version number and log looks fine. Confirm
the fix actually shipped by checking the server process's start *time* is after the build (`ps -o
pid,lstart -p $(lsof -ti :3000 -sTCP:LISTEN)` vs `ls -la .next/BUILD_ID`), not just that the build
succeeded — and killing by `lsof -ti :3000`, not a name-pattern `pkill`, which has separately failed
to find the actual `npm start`/`next-server` process more than once.

**Working style:** brainstorm briefly in plain language → confirm exact behavior/edge cases →
isolated tests (`npx vitest run`) → real-server smoke tests (never claim correctness from syntax
validation alone) → version bump + CHANGELOG entry → commit (scratch file + `git commit -F`) on a
feature branch → push, every meaningful change — no zip packaging, that was the pre-Next.js
workflow. Avishai gives direct, specific feedback and actively cross-checks stated behavior against
actual code — he catches inconsistencies precisely, so don't hand-wave.

**Explicit standing preference:** "avoid inconsistency of AI and use as possible deterministic
method" — prefer deterministic logic over AI calls wherever the two could achieve the same result.

## Core architecture

### The planner (two-phase)
- **PRINCIPLE — all planner logic is generalized and non-term-specific.** No rule branches on
  course names, specific dates, exam counts, or an assumed term shape (quarter vs semester). Logic
  acts only on `data` and the derived horizon. Tuned default constants (`EXAM_EVE_CAP`,
  `FINALS_STRETCH_MAX_SPAN`, `STUDY_HOURS_BY_RATING`, band thresholds, …) are fine but must be
  universal defaults, centralized at the top of their module, never conditioned on which
  term/course. Structural devices (clusters, run-in days, finals stretch) must scale to 1, 2, N
  exams and any spacing — verify with a lone exam and a non-final mid-term cluster, not just the
  3-final case. Real course names/dates in code only ever appear inside explanatory comments.
- **Phase 1 (Estimate & Prioritize):** `estimateDifficulty()`/`estimateStudyHours()` — combines
  course difficulty rating with an item's grade weight. Student overrides (`userValue`/`userHours`)
  always take precedence over AI estimates, permanently, per item.
- **Phase 2 (Scheduling):** `planHorizon()` → `planDayV2()` → `buildItemDemand()` +
  `placeCourseBlocks()`. Priority-driven, stateful across the whole planning horizon (not
  recomputed fresh per day). Session presets (30/45/60 min) grid-aligned to :00/:15/:30/:45.
  Deadline-driven items (Tier 1) get primary/secondary placement with minimize-switching; regular
  per-course study (Tier 2) fills leftover capacity.
- **Core planning philosophy — "plan as late as needed, not as early as possible."** Items only
  become schedulable within a bounded start-window before their due date (homework: 5 days;
  exams: the item's own `prepDays` field, default 7) — this is a hard ceiling, not just a lower
  buffer. Within that window, slack-based deferral pushes placement toward the due-2 target rather
  than front-loading the moment a window opens (`computeSlack`-style logic in `planDayV2`).
  Due-date itself is a hard wall (never scheduled); due-1 is a soft emergency fallback only, not a
  normal target.
- **Completion guarantee:** `preflightRiskCheck()` does whole-horizon feasibility simulation before
  committing to a plan. Shortfalls are always surfaced explicitly (never silently dropped).

### Multi-school / multi-term system
- `data.schools[]` / `data.terms[]` (`lib/data/terms.js`) are the real source of truth for term
  history. Current work lives on branch `feature/term-status-manual` (stacked, unmerged PR bundle
  with the B-07 + planner work — see git log, not yet deployed).
- **Term status is a STORED, user-set field now — `"current" | "upcoming" | "archived"` —
  NOT derived from dates.** This is a deliberate reversal of the original design (below is what it
  used to be, kept as a warning against reintroducing it): status used to be 100% date-computed via
  `computeTermStatuses()`, on purpose, so it couldn't drift out of sync. Real request that reversed
  it: "remove the function to close current term... instead we need a function to set a term to
  Active... ONLY ONE can be set to Current." The student now explicitly sets which term is Current
  via School Info's inline status editor (see below); `computeTermStatuses()` today just reads each
  term's stored `status`, defaulting a term with none to `"upcoming"` (`migrateTermStatusIfNeeded`
  backfills existing accounts once). Changing status never touches a term's own
  courses/assignments/exams — every consumer scopes by `termId`, so a term's data just sits exactly
  as it was regardless of status.
- **School Info's status editor is inline, not a popup** (`components/SchoolInfo.jsx`) — clicking
  "Change Status" toggles edit mode on the term cards already on the page: each shows its status in
  color plus the other two as gray clickable pills, staged locally (`draftStatuses`) until "Save
  States" commits them. Picking Current on one term auto-demotes whichever term was Current in the
  draft to Archive — enforced live, no confirm popup (a popup-based version was explicitly removed
  per request). A Current term **cannot be deleted directly** — `deleteTermEntirely` blocks it with
  a toast telling the student to change status first, no confirm dialog even opens.
- **Mirror pattern:** `profile.termStart/termEnd/schoolName/schoolAddress/schoolType/collegeCalendar`
  stay in place as fields, auto-synced to whichever term is "current" via
  `syncActiveTermToProfilePatch()` — which must actively CLEAR those fields when no term is
  Current, not just leave them stale (real shipped bug: deleting the last term left the header
  still showing it). Every existing consumer of those profile fields (the planner, `getTermRange()`,
  `isFin()`/`isHol()`, WeekGrid) works unchanged — they just always reflect the active term now.
- **`termScopedForPlanning(data)` is critical and easy to forget.** It filters
  courses/assignments/exams to just the current term before anything planning-related touches
  them. Without it, the planner and calendar display would consider *every* course ever created,
  including years-old archived terms — this was a real, shipped bug (fixed in v2.32.0/v2.34.0).
  Apply it at every point data enters term-sensitive logic: both `planHorizon()` call sites,
  inside `buildBlocks()` itself (not at each caller), and at the top of `Today`.
- One-time legacy migration (`migrateLegacyTermIfNeeded`) synthesizes a school+term from old
  single-term profile fields on first load, and backfills `termId` onto any existing untagged
  course. **Guarded by a permanent `termsInitialized` flag** (set the moment an account first gets
  a real term, backfilled onto existing accounts) — without it, this migration re-fires the moment
  `terms[]` goes empty again (e.g. after deleting the last term) and resynthesizes a "new" term
  from whatever stale profile fields haven't been cleared yet, resurrecting a term the student just
  deleted. This was a real, shipped, two-layer bug — don't remove the guard.
- **Real per-term data isolation — fixed, v2.88.20.** `studyPlan`/`completionLog`/`pomodoroLogs`/
  `gymLogs`/`dailyLogs`/`adhoc`/`briefCache`/`briefPeriod`/`quarterPlan`/`planStale`/
  `notifications`/`lastSyllabusSync` (`TERM_SCOPED_KEYS`, `lib/data/schema.js`) used to be flat,
  global stores shared across every term — a term only "owned" a date range, not a real data
  partition, and switching which term was Current never actually changed what any of them showed
  (real, concrete report: uploading a syllabus for a new term still showed "Last synced..." from a
  different one). Real request that drove the fix: "each term will be created in the database as a
  complete isolated term... include all its academic data, study plans, grades, user behaviour.
  ALL... no cross-talking" — confirmed explicitly that this includes gym/daily-checkin/Pomodoro
  logs too (an earlier, separate request had these deliberately EXCLUDED from term resets — that
  request was about a specific button's scope, not about isolation, and doesn't conflict: Acad.jsx's
  "Reset academic data" still only clears `studyPlan`, same as before, just now correctly scoped to
  whichever term is current).

  Fixed by extending this app's own existing "mirror pattern" (already used for
  `profile.termStart/termEnd/schoolName`) to these fields too: each is now a REAL, isolated field on
  every term object (`data.terms[i].studyPlan` etc — the actual source of truth), while the flat
  top-level copies ~50 call sites across the app already read/write directly (Today.jsx, Week.jsx,
  the planner, the SMS cron routes...) stay a live mirror of whichever term is current — kept in
  sync by **`applyTermScopedPatch`** (`lib/data/terms.js`), the one choke point every `upd()` call
  now routes through (`components/App.jsx`). This is why almost none of those ~50 call sites needed
  to change: they still read/write the same flat fields as always, it's just genuinely per-term
  underneath now. The one write path that bypasses `upd()` entirely — the server-side
  `runNotifyUrgentItems` cron function (`lib/data/notifications.js`) — reuses the exact same
  `applyTermScopedPatch`, so its notification-log write stays mirrored too even though it never
  touches `App.jsx`. One-time migration (`migrateTermDataIsolationIfNeeded`) seeds the CURRENT
  term's isolated copy from the old flat data on first load, and every OTHER term from genuinely
  empty defaults — verified live against the real account (round-tripped Current between two real
  terms, confirmed zero data loss and correct isolation both directions).

  Net simplification: the old `scrubTermSchedule` (date-range + courseId reconciliation, needed
  only because these stores used to be shared) is gone entirely — resetting a term is now just
  resetting its own copy to empty, deleting a term removes its data by definition, and a brand-new
  term simply starts with its own empty defaults regardless of whether its dates happen to overlap
  another term's. Calendar's own week/month *navigation* range (`components/Week.jsx`) still reads
  the term's raw typed start/end (`getTermRange`) directly — NOT `planningRange()`, which is
  deadline-anchored (last real assignment/exam due date, not the typed term-end) and exists purely
  so a mistyped Term End can't give the AI planner a pointless empty tail to schedule into —
  conflating those two ranges was a real, shipped bug (a freshly-synced term with only its first
  few items entered had its entire calendar chopped down to just those couple of weeks); unrelated
  to this fix, still a live distinction to keep straight.

  **Known limitation of the migration, not a bug in it:** any term whose flat data had already been
  overwritten by normal cross-talk BEFORE this fix shipped (e.g. a Replan run while a different term
  was Current, in the old flat-store world) can't have that specific data resurrected — the
  migration can only adopt whatever was actually sitting in the flat store at migration time, honestly,
  not reconstruct something already clobbered by the very bug being fixed. Confirmed low-stakes in
  practice (only affected an old mock/test term's calendar, not real academic data) — going forward
  from v2.88.20 this exact overwriting can never happen again.

- **Term-switching (VIEWING a non-current term without making it current) remains explicitly
  deferred, on request** — real request from this same session: "later, we shall allow user to
  switch between terms and display EXACTLY as left," deliberately scoped OUT of the isolation fix
  above ("Isolation only, no viewer UI yet" — explicitly chosen over building both together). The
  real per-term partitioning above is exactly the prerequisite that feature was waiting on
  (previously the blocker was real vs. derived-view data, per the "Known next step" this replaces)
  — building the actual viewer UI is still a separate, later, deliberately-scoped piece of work.
  Acad.jsx briefly had an in-tab term switcher from an earlier pass and it was explicitly removed
  ("revert to the original page design") — re-adding term-switching UI should be deliberate, not a
  repeat of that.

### Today tab
- `realDayBlocks(data, dateStr)` is the single source of truth for "what does the real plan say
  about this day." Everywhere that used to call the old `planStudyBlocks()` directly, or read from
  a disconnected AI-generated `brief` object, was a real, shipped bug — found in four separate
  places at once (Today's Schedule, Focus Time, Weekly's day-detail view, the week-balance
  summary), all silently showing a fictional AI-guessed schedule instead of the real persisted
  plan. Fixed in v2.24.0.
- AI in `gen()` is scoped to commentary only (`oneFocus`/`encouragement`/`whatsAppMessage`/etc.) —
  given the real plan as read-only context, never asked to invent or rewrite task text.
- Focus Time timer: per-row Play/Pause/Complete, not a single global "which session is current"
  selector (that design was explicitly rejected in favor of this). `completeSession()` reuses the
  same shared functions and `completionLog` shape as `BlockEditModal`, so tracking is one
  consistent system regardless of which UI triggered it.

## Established UI conventions

- **"Activated" state = amber text.** A control that reflects a *state* rather than firing an
  action (a selected tab/segment, the currently-viewed item, a toggle that's "on", a button
  that's now relevant) is shown by turning its **text/icon colour to `var(--amber)`** — same as
  the Academics sub-tabs, the Weekly view segmented toggle, the current-week dropdown, and
  "Save" buttons when there's something to save. Not-activated / not-relevant is muted
  (`var(--t3)`) or disabled. Apply this by default for any new state-reflecting control.
- Every content section uses the same `BOX`/`TITLE_ROW`/`TITLE_LEFT`/`TITLE_ICON`/`TITLE_TEXT`/
  `DIVIDER`/`INNER` style-constant pattern (each top-level tab component redefines these locally —
  `Today`, `Acad`, `Sett`, `SchoolInfo` etc. all have their own copies). New sections should match
  this exactly, not invent new card styling — this was a real complaint when `SchoolInfo` first
  shipped with ad-hoc styling instead (v2.33.1 fixed it).
- On-demand content (calendar, daily message preview) lives behind small icon buttons with `data-tt`
  tooltips, opened as centered modals — not always-inline sections, and not text-labeled buttons
  once more than one or two exist in a header (keep headers minimal).
- Time display: 12-hour with am/pm (`f12()`), never raw 24-hour — this was a real, confirmed
  inconsistency (v2.25.1) found in two separate places.
- Duration display: `fmtDur()` → "1h 30m", never raw minutes.
- When redesigning a layout from a screenshot: match the *exact* structure shown (element order,
  grouping, spacing pattern), not an approximation. This took multiple iterations to get right on
  the Focus Time row layout (v2.37.0 → v2.37.3) — read reference images very literally.
- **Notification-channel section pattern** (v2.82.0-2, Preferences → Notifications) — the shape
  every delivery channel (Browser, SMS, and whatever's added next — email, a native app push, …)
  should follow, each its own card:
  1. A tinted **master-switch banner** at the top (`var(--green-bg)` once on, `var(--card2)` once
     off, `var(--red-bg)` only for a real failure/blocked state like denied browser permission) —
     status text on the left, a **Turn off**/**Turn on** button on the right. This is a real app-
     level preference (its own boolean profile field, e.g. `browserNotifsEnabled`/`smsEnabled`),
     never a stand-in for something outside the app's control (browser permission itself is tracked
     separately, live, via `Notification.permission` — not stored, not what this switch means).
  2. A **per-type toggle list** below it, shown only while the master is on: each row is one
     `.field-grid` with a stacked title+sub-caption "label" (`.align-col-label .align-col-flex
     .align-col-stacked`) and a `.toggle-group` field, one row per distinct notification *type* the
     channel can send (e.g. SMS's Daily summary/Evening check-in; Browser's Daily priorities/
     Session start/Break reminders). Each type is its own profile boolean
     (`notify<Channel><Type>`), independent of the master — turning the master off must never erase
     an individual type's own remembered choice; turning it back on resumes exactly where it left
     off (see `disableSms`/`enableBrowserNotifs` in `components/Sett.jsx` for the exact pattern).
  3. Every real send/fire site for that channel checks BOTH: the master switch AND that specific
     type's own toggle — never just one. A type gated only by the master (or only by its own
     toggle) is a bug, found and fixed exactly this way for Browser's Focus Timer chime once
     already (it had ignored the old single switch entirely).
  A brand-new notification type within an existing channel is "add one profile boolean + one row in
  that channel's toggle list + gate its one send/fire site on master-AND-own-toggle" — no new UI
  pattern needed. A brand-new channel is "copy the whole card structure above."

## Real bugs found and fixed this session (worth knowing so they don't recur)

- **`iso()` timezone bug (v2.34.0), critical.** Used `.toISOString()` (UTC conversion) instead of
  local date components. For any US timezone, evening local time is already tomorrow in UTC — so
  for a large part of every day, the canonical "what's today" function was silently wrong. Fixed
  by switching to `getFullYear()`/`getMonth()`/`getDate()`. **If you ever need "today" as a
  date string, always use the existing `iso()` function — never re-derive it with
  `toISOString()`.**
- **Refresh Plan overwriting protected history (v2.36.0), critical.** `refreshQuarterPlan`'s
  planning range started from the current week's Sunday, not from today — so days before today
  but within the current week got silently regenerated, even right after "Clear Plan" had
  correctly protected them. `refreshWeekPlan` had the same issue, more directly (no fallback at
  all for days before today). Fixed by starting the planning range from today exactly in both.
- **Do not delete superseded code in the same pass as adding its replacement.** Established after
  an earlier incident (De Anza-specific hardcoding removal). Superseded functions
  (`planStudyBlocks`, `studyTargets`, `generateWeekPlan`, `Pomo`) were kept, clearly marked, for a
  full session before being deleted in a dedicated cleanup pass (v2.29.0) — by which point every
  call site had been re-verified to have zero remaining references.
- **UI copy must never describe behavior the code doesn't have yet.** The Study Preferences "?"
  help banner describes the difficulty-research algorithm and personalization loop as if built —
  intentionally, ahead of the code — and must not go to real use until that backlog closes.

## Known backlog (not yet built)

- ~~Syllabus-sync extraction miss on the real account's Fall 2026 DSC 10~~ — **fixed, v2.88.13.**
  Root cause: `t.slice(0,16000)` in all three upload flows (`Onboard.parseSyl`, `Acad.syncSyl`,
  `Acad.rawExtract`) truncated each PDF's extracted text before sending it to the AI — a leftover
  constant unrelated to the model's real context window. The actual uploaded file (found at
  `~/Downloads/DSC 10 updated.pdf`, matching the sync record's filename) is a real 23-page UCSD
  "Course Info" page that extracts to 40,616 characters; 16,000 landed mid-page-9, before the
  Exams/Quizzes section, Weekly Schedule, and Grades weight table were ever reached — confirmed by
  reproducing the exact pdf.js extraction and re-running the real prompt against `/api/ai` both
  truncated (reproduced the bug exactly: 4 admin items, 0 exams) and untruncated (correctly
  returned the 4 admin items + 4 quizzes + 2 real exams with real weights, matching the syllabus's
  own grading table). Fixed by centralizing a much larger, explicitly-justified
  `MAX_SYLLABUS_CHARS=120000` in `lib/pdf.js` (still just a safety valve against a truly degenerate
  PDF, not a real content limit) shared by all three call sites, replacing three separate copies of
  the old magic number. Separately (not a bug): this specific PDF has no individual per-assignment
  HW/lab dates at all — it explicitly defers those to a separate live "homepage" calendar page not
  included in the upload; nothing in extraction can recover dates that aren't in the document.
  **Follow-up, v2.88.14, from trying the fix on the real file:** (1) Quizzes now classify as
  **exams**, not assignments — reversed on direct request ("it classified 'Quiz' as Homework, shall
  be an exam"); the extraction prompt's rule and `lib/syllabus.js`'s deterministic safety net
  (`reclassifyQuizzesAsExams`, promoting quiz-titled items from assignments → exams) both flipped
  direction, with a shorter `prepDays` (2-3) than a Midterm/Final gets. Re-confirmed via the
  full-text grep that labs/HW genuinely aren't in this PDF (see above) — not re-litigated, just
  double-checked on request. (2) Found and fixed a real, unrelated bug while investigating "save
  didn't work": `toast2()` only ever holds one toast, and `refreshQuarterPlan()` fired it twice in a
  row — the real success message, then a term-end/last-deadline mismatch nudge — so the second call
  silently clobbered the first before it rendered, styled as a persistent red error with zero
  success confirmation. **Any code path that wants to show more than one thing after an action must
  fold it into a single `toast2()` call (structured `{title,sub,lines,footer}`), never fire a
  second one — the second always wins, silently.** Fixed here; worth checking for the same pattern
  elsewhere if a similar "did it actually work?" report comes up again.
  **v2.88.15/16, from the same thread, escalated to "if this isn't 100% right the whole app can be
  trashed":** could not reproduce a reported "6 homework, all one fabricated date" live (5 direct
  API test runs across every DSC10-related file in Downloads), but treated the underlying risk as
  real anyway — a single AI pass over a PDF is never a literal completeness guarantee, so the fix
  isn't "try to hit 100%", it's "make a gap impossible to miss silently". Two deterministic
  safety nets now run on every syllabus extraction, both **free** (no second AI call — offered and
  explicitly declined by the student in favor of keeping upload cost at one call per sync):
  (1) **hallucination guard** (`checkSyllabusExtraction`, precision side) — flags 3+ items sharing
  one base title (e.g. "Homework N") AND the identical due date, the signature of a guessed
  schedule rather than real per-item dates; (2) **completeness signal**
  (`scanForDatedItemSignals`, recall side) — regex-scans the raw source text for a date near
  graded-item language, cross-references it against what actually got extracted, flags anything
  mentioned but not covered. Both are approximate by design (regex heuristics, not language
  understanding) and worded as "worth checking", never a confirmed miss — verified against real
  syllabus phrasing (correctly spaced, since condensing sections together creates false window
  overlaps that don't happen in the real ~40k-char document) to produce zero false positives on a
  correct extraction. Alongside these, the extraction prompt (rule 10, all 3 upload flows) now
  makes the AI self-report: work through the document's own section headers as a checklist, return
  `extractionNotes` naming every graded category it recognized but found no individual date for,
  with why. Live-verified against the real DSC10 PDF: correctly named all 9 undated categories
  (Labs, Homework, Midterm/Final Project, Pretest, Discussion groupwork, Pod meetings, SETs, Extra
  credit) with specific reasons — and, notably, **stopped guessing a date for the Pretest** (an
  earlier run had silently placed it on 9/29 with no real textual basis; this one correctly omits
  it with an explanatory note instead). All three surface in `ExtractionVerifyModal`, the
  onboarding syllabus screen, and the raw-extraction diagnostic — errors/warnings and the AI's own
  notes get visually distinct blocks (problem vs. transparency), never merged into one.
  **Established pattern going forward for any future extraction-quality concern:** don't reach for
  a second AI pass by default — first ask whether a deterministic, generalized (non-course-
  specific) cross-check against the raw source text can catch the same failure class for free.
- **Known next step, explicitly requested, not yet built: term-switching (viewing).** The real
  prerequisite — genuine per-term data isolation — is done (v2.88.20, see the Multi-school/
  multi-term section above). Building the actual viewer UI (browsing a past/upcoming term's data
  without making it Current) is still separate, later, deliberately-scoped work.
- ~~`webDifficultySignal()`~~ — done (B-01): `/api/course-info` now runs real web search per new
  course (not per item — the old per-item stub was removed), self-reports a confidence level
  (low/medium/high) + rationale since real grade-distribution data is usually login-gated, and
  that confidence shows as a small tooltip badge next to the course's difficulty in Academics →
  Courses. Re-researching an existing course (🔄) shows old vs new inline before saving anything
  (`ResearchPreview` in `components/Acad.jsx`), with a deterministic sanity check
  (`expectedHoursRange()` in `lib/planner/estimate.js`) flagging — never blocking — a result whose
  difficulty score and weekly hours don't plausibly line up, since the two come from one AI call
  with no guaranteed internal consistency across separate research runs.
- Personalization loop — student overrides (`userValue`/`userHours`) only affect that one item;
  nothing feeds them back to influence future estimates.
- Overflow UI — currently just a toast naming shortfalls. Designed but not built: a persistent
  alert banner deep-linking into Study Preferences with a pre-filled suggested value.
- GPA target-planning — grade capture exists, no calculation/planning built on it.
- College calendar auto-fetch — endpoint built, parsing bug fixed, but real web-search quality
  never verified end-to-end with a live key.
- "Planner diagnostics" panel in Preferences — simplified to just Refresh Plan history; a full
  diagnostic tool matching the *current* planner's concepts (slack, priority score) doesn't exist.
- ~~Day-view calendar (Today's "View day calendar" modal) — visual design~~ — done: unified with
  the Calendar tab's own day view (`DayAgenda` shared component, this session) instead of two
  separate designs.
- WhatsApp — deliberately deferred, not being pursued. Renamed out of the UI entirely back in
  v2.51.1 once it turned out nothing ever actually sent via WhatsApp — see that CHANGELOG entry.
  The real outbound channel is **SMS via Twilio**: opt-in flow with an explicit consent checkbox
  (`components/Sett.jsx`), `/api/sms/send` built and working, A2P 10DLC campaign **approved** (as
  of 2026-09-18). Two real scheduled sends now exist: `app/api/cron/daily-summary` (8:30am, a
  deterministic message built by `lib/sms/dailySummary.js` — no AI call) and
  `app/api/cron/evening-checkin` (8:00pm, a fixed check-in nudge), both fired by
  `.github/workflows/scheduled-reminders.yml` — Vercel Cron Jobs (originally `vercel.json`'s
  `crons` entries) turned out to be silently unavailable on the Hobby plan (deploy log had zero
  mention of "cron", no error, nothing registered), so a GitHub Actions schedule calls the routes'
  URLs directly instead, same `CRON_SECRET` bearer-token auth either way. A third route,
  `app/api/cron/notify-urgent-items`, writes the same "today's priorities" content straight into
  each user's in-app bell log (`data.notifications`) — not its own schedule, called from inside
  `daily-summary` on that same 8:30am trigger. All three are gated by `CRON_SECRET` + a
  `SUPABASE_SERVICE_ROLE_KEY`-backed client (`lib/sms/cronSend.js` — the one deliberate place this
  app uses a service-role key, never imported from client code). There is no standalone exam/
  project-countdown send — deliberately not built, to avoid a third scheduled cron/toggle; instead
  `lib/sms/dailySummary.js`'s own message and `urgentItems()` (`lib/data/notifications.js`, feeds
  both the bell log and the browser-notification effect) each include an exam AND a project
  countdown line directly, gated by the same `notifyDailySummary`/`notifyBrowserPriorities`
  toggles those channels already have — see `PROJECT_COUNTDOWN_DAYS` there. The "Morning Message" daily-briefing card
  (the feature formerly labeled WhatsApp)
  is still preview-only, not auto-sent — separate from the scheduled SMS reminders above.
  Email/username/password fields on the Account modal / onboarding Welcome step remain
  placeholders only, no real auth tied to them.
- Mode 1 vs Mode 2 semester planning — original design had two distinct modes (a one-time coarse
  semester-level budget allocation vs. the rolling detailed plan). Worth reconsidering whether this
  distinction is still needed now that `planHorizon()` already does full-term detailed planning in
  one pass — never revisited since the two-phase planner was built.
- Deployment path — currently single-user, local-only. Two options on the table, actively being
  discussed as of this writing (separately from this file, so check in with Avishai on current
  status): (A) hosted multi-user web app — needs a real database, real auth, cloud hosting; framed
  as additive to the current design, not a rewrite. (B) native/device app — Electron/Tauri is the
  smallest lift; true mobile would need a React Native rewrite; a PWA is a middle ground. This is
  the actively-developing "bigger goal" — if this file feels behind on it, ask rather than assume.
  **Update:** Option A is done — Supabase Auth + Postgres, deployed on Vercel, real signup/login/
  password-reset, RLS-scoped per-user data (`supabase/schema.sql`). This paragraph is being kept
  as-is (rather than rewritten) as a marker of how stale a "known backlog" entry can quietly get —
  re-verify status here before trusting it, don't just read it.
- **Two accepted security risks from the pre-launch RLS audit (2026-09), not fixed, revisit if
  actually exploited:** (1) admin-seeded invite codes (`invite_codes.owner_id is null`, e.g. the
  launch code) have no SELECT policy match, so their use-count isn't visible in-app, only via the
  Supabase dashboard — a usability gap, not a leak. (2) `redeem_invite_code()` (an RPC callable
  pre-auth, so it can't require a session) has no rate-limiting — a scripted attacker could hammer
  it. Self-generated codes are an 8-hex-char space (~4.3B combinations), impractical to brute-force;
  the human-shared launch code is a static secret with the usual sharing risk. Fine at family/
  small-cohort scale; would need real rate-limiting (which needs a backend route) before this app
  is handling meaningfully more signup traffic.

## Workflow discipline to keep

1. Ambiguous request → pick the most reasonable interpretation, state the assumption, proceed —
   don't stall on clarifying questions unless truly necessary.
2. Before any UI/logic change: check current behavior in code first, don't assume.
3. After any change: syntax-validate, isolated-test the core logic where feasible, then a real
   server smoke test (`npm start` + `curl`) — "the file parses" is not "it works."
4. Version bump (`APP_VERSION` in `lib/version.js`, not `app.js`) + CHANGELOG.md entry, every time
   — see the Stack section above for the build-before-restart ordering that has to go with this.
5. If a fix doesn't match what was asked (this happened more than once this session with a UI
   layout request) — re-read the actual reference/screenshot literally rather than iterating on
   assumptions. Ask directly if genuinely ambiguous rather than guessing again.
6. **For any visual/CSS fix, verify against the actual computed state before calling it done —
   `getComputedStyle`/DOM inspection, or precise measurement (e.g. canvas `measureText` for
   text-fit questions) — not just a screenshot that happens to look right in one browser session.**
   A one-line request ("move a select's native dropdown arrow off the edge") took 4 shipped
   versions to actually land because early attempts guessed at browser rendering behavior (does
   padding move a native `<select>` arrow? does a split `background`/`backgroundImage`/
   `backgroundRepeat` style object render as one image, or race and duplicate?) and shipped on a
   screenshot instead of checking computed state first. The one attempt that measured first worked
   in a single pass.
