# StudyOS — Project Context

Read this before starting any work. It's the distilled context from a long prior development
session (done via Claude's web chat, not this terminal) — architecture decisions, established
conventions, and hard-won lessons. Keep it updated as the project evolves; it's a living document,
not a one-time snapshot.

## What this is

A personal AI-powered study assistant, built for Itay (a UCSD Data Science student) by his parent
Avishai, who is the sole developer and product decision-maker. Single-user, runs locally.

**Stack:** Node.js/Express + React (Babel CDN — no build step) + JSON-file data store + Anthropic
API proxied server-side. Runs via `npm start` on `localhost:3000`, working directory `~/studyos`.

**Working style:** brainstorm briefly in plain language → confirm exact behavior/edge cases →
isolated tests → real-server smoke tests (never claim correctness from syntax validation alone) →
version bump + CHANGELOG entry + zip package for every meaningful change. Avishai gives direct,
specific feedback and actively cross-checks stated behavior against actual code — he catches
inconsistencies precisely, so don't hand-wave.

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

### Multi-school / multi-term system (added late in the session)
- `data.schools[]` / `data.terms[]` are the real source of truth for term history.
- **Mirror pattern:** `profile.termStart/termEnd/schoolName/schoolAddress/schoolType/collegeCalendar`
  stay in place as fields, auto-synced to whichever term is "current" via
  `syncActiveTermToProfilePatch()`. Every existing consumer of those profile fields (the planner,
  `getTermRange()`, `isFin()`/`isHol()`, WeekGrid) works unchanged — they just always reflect the
  active term now.
- Term status (`Completed` / `Current` / `Upcoming`) is **always derived from dates**, never
  stored — `computeTermStatuses()`. A term becomes Current the moment the previous one's end date
  passes, even before its own start date arrives.
- **`termScopedForPlanning(data)` is critical and easy to forget.** It filters
  courses/assignments/exams to just the current term before anything planning-related touches
  them. Without it, the planner and calendar display would consider *every* course ever created,
  including years-old completed terms — this was a real, shipped bug (fixed in v2.32.0/v2.34.0).
  Apply it at every point data enters term-sensitive logic: both `planHorizon()` call sites,
  inside `buildBlocks()` itself (not at each caller), and at the top of `Today`.
- One-time legacy migration (`migrateLegacyTermIfNeeded`) synthesizes a school+term from old
  single-term profile fields on first load, and backfills `termId` onto any existing untagged
  course — without the backfill, real existing data silently vanishes from term-filtered views.

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
- On-demand content (calendar, WhatsApp preview) lives behind small icon buttons with `data-tt`
  tooltips, opened as centered modals — not always-inline sections, and not text-labeled buttons
  once more than one or two exist in a header (keep headers minimal).
- Time display: 12-hour with am/pm (`f12()`), never raw 24-hour — this was a real, confirmed
  inconsistency (v2.25.1) found in two separate places.
- Duration display: `fmtDur()` → "1h 30m", never raw minutes.
- When redesigning a layout from a screenshot: match the *exact* structure shown (element order,
  grouping, spacing pattern), not an approximation. This took multiple iterations to get right on
  the Focus Time row layout (v2.37.0 → v2.37.3) — read reference images very literally.

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

- ~~`webDifficultySignal()`~~ — done (B-01): `/api/course-info` now runs real web search per new
  course (not per item — the old per-item stub was removed), self-reports a confidence level
  (low/medium/high) + rationale since real grade-distribution data is usually login-gated, and
  that confidence shows as a small tooltip badge next to the course's difficulty in Academics →
  Courses.
- Personalization loop — student overrides (`userValue`/`userHours`) only affect that one item;
  nothing feeds them back to influence future estimates.
- Overflow UI — currently just a toast naming shortfalls. Designed but not built: a persistent
  alert banner deep-linking into Study Preferences with a pre-filled suggested value.
- GPA target-planning — grade capture exists, no calculation/planning built on it.
- College calendar auto-fetch — endpoint built, parsing bug fixed, but real web-search quality
  never verified end-to-end with a live key.
- "Planner diagnostics" panel in Preferences — simplified to just Refresh Plan history; a full
  diagnostic tool matching the *current* planner's concepts (slack, priority score) doesn't exist.
- Day-view calendar (Today's "View day calendar" modal) — functional but its visual design is an
  explicitly open, parked question, not finalized.
- WhatsApp — currently a formatted preview to copy, not live sending. Email/username/password are
  placeholder fields only, no real auth — both deferred to when notification infrastructure is
  actually built.
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

## Workflow discipline to keep

1. Ambiguous request → pick the most reasonable interpretation, state the assumption, proceed —
   don't stall on clarifying questions unless truly necessary.
2. Before any UI/logic change: check current behavior in code first, don't assume.
3. After any change: syntax-validate, isolated-test the core logic where feasible, then a real
   server smoke test (`npm start` + `curl`) — "the file parses" is not "it works."
4. Version bump (`APP_VERSION` in `app.js`) + CHANGELOG.md entry + repackage, every time.
5. If a fix doesn't match what was asked (this happened more than once this session with a UI
   layout request) — re-read the actual reference/screenshot literally rather than iterating on
   assumptions. Ask directly if genuinely ambiguous rather than guessing again.
