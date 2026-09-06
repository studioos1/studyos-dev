# StudyOS — Feature Backlog

Living list of features and fixes, maintained iteratively. Pull-based: we only queue the next
item or two — finish one, then pick the next together, folding in whatever surfaced along the way.
No need to order the whole list up front.

- **Order** — filled only for items actually queued (1 = doing next). Blank = unordered backlog.
- **Effort** — S (hours) · M (a day to a few) · L (multi-day). Rough estimate, mine.
- **Status** — Backlog · Next · In progress · Done · Parked
- Full description of each item is in **Details** below the table.

## Priority table

| Order | ID | Title | Category | Effort | Status |
|------:|------|-------|----------|:------:|--------|
| — | B-01 | Web-backed course difficulty (`webDifficultySignal`) | Planner | M | Backlog |
| — | B-02 | Personalization loop for estimates | Planner | M | Backlog |
| — | B-03 | Fix + test `refreshQuarterPlan` week-merging (D0) | Planner | M | Backlog |
| **2** | B-04 | Make the two planning-mode buttons consistent (decision: keep both) | UX | S | Next |
| — | B-05 | Per-shortfall suggested-fix value (mostly absorbed by B-07) | UX | S | Backlog |
| — | B-06 | GPA target-planning | UX | M | Backlog |
| **1** | B-07 | Weekly toolbar redesign + diagnostics drawer + past-day read-only | UX | M–L | In progress |
| — | B-08 | Day-view calendar visual design | UX | S–M | Backlog |
| — | B-09 | Validate college-calendar auto-fetch end-to-end | External data | S + ? | Backlog |
| — | B-10 | Real notification sending (WhatsApp / email) | Notifications | L | Backlog |
| — | B-11 | Transactional email provider for auth confirmations | Infra | S | Backlog |
| — | B-12 | Account management under real auth | Multi-user | M | Backlog |
| — | B-13 | Onboard Itay as 2nd developer | Process | S | Backlog |
| — | B-14 | Conversational AI query over all your data + app help | AI assistant | L | Backlog |
| — | B-15 | New-user Site Tour / guided walkthrough | Onboarding | M | Backlog |

## Details

### B-01 · Web-backed course difficulty (`webDifficultySignal`)
`estimateDifficulty()` today combines a course's manually-set difficulty rating with an item's
grade weight. `webDifficultySignal()` is a stub returning `null`. It's meant to do real research —
professor/course reputation signals, historical grade distributions, student feedback — and feed
that into the estimate so the student isn't hand-tuning every course. **Constraint:** the Study
Preferences "?" help text already describes this (and B-02) as if built; that copy must not reach
real users until this ships.

### B-02 · Personalization loop for estimates
When a student overrides an AI estimate (`userValue` / `userHours`), that override only affects
that one item. Nothing feeds it back to make future estimates for that course — or that student —
more accurate. Goal: learn from overrides so estimates converge on the individual over a term.

### B-03 · Fix + test `refreshQuarterPlan` week-merging (D0)
Logged during the Phase A refactor. `refreshQuarterPlan` groups per-day placements back into week
entries and merges with existing weeks; this merging path has a suspected edge-case bug and is
**not** covered by the A6 planner tests. Needs the merging logic extracted into a pure function,
unit tests written, then the bug confirmed and fixed.

### B-04 · Make the two planning-mode buttons consistent
**Decision made:** keep both modes — "Update this week" (`refreshWeekPlan`, one week) and
"Refresh Plan" (`refreshQuarterPlan`, whole term). They're genuinely different tools and both are
wanted. What's left is UI: the two buttons currently look and read inconsistently (different
styling, one red, tucked among Clear plan / Add). Give them a systematic, self-explanatory
treatment so it's obvious they're a pair — scope-of-one-week vs. scope-of-whole-term — and which
one you're reaching for. Small. Sensible to do in the same pass as B-07 (same Weekly-tab surface).

### B-05 · Per-shortfall suggested-fix value
Mostly absorbed by B-07 (the diagnostics drawer now surfaces shortfalls and auto-opens on a
shortage). What's left: for each shortfall row in the drawer, show a concrete suggested fix —
e.g. "lower this estimate to Xh" or "extend prep to N days" — and a one-click way to apply it
into Study Preferences.

### B-06 · GPA target-planning
Grade capture exists (per-course and per-item grades, letter conversion, live GPA). Nothing is
built on top: "what grade do I need on the remaining items to hit a target GPA," and optionally
letting that target influence how the planner allocates study time.

### B-07 · Weekly-tab plan surface: toolbar redesign + diagnostics drawer + past-day read-only
One PR (all the same Weekly-tab surface, tightly coupled). Scope is the control row and the plan
surface — **no change to what any button does**, except the two new behaviours noted.

**1. Toolbar redesign.** The current control row has no logical order, mixes text/icon buttons,
inconsistent widths, a redundant Wk1–Wk13 button wall alongside prev/next arrows, and an
oversized Schedule/Time-Allocation toggle. New layout, three groups (view · nav · actions) with
per-group consistent sizing:
- **Left — view mode:** compact segmented control `[ Schedule │ Time ]`.
- **Centre — week nav:** `‹` / `›` for ±1 week, plus a dropdown for any week; dropdown label reads
  "Week 3 of 13 · Sep 1–7" so term position is always visible. Replaces the Wk button wall and
  the separate "Today" button ("This week" is pinned at the top of the dropdown).
- **Right — actions:** `+` (add activity) · **Plan status** (ghost button, always visible) ·
  **Replan** (primary). Replan's `▾` menu holds scope + clear: **This week · Whole term · — ·
  Clear plan** — this is also the B-04 resolution (keep both planning modes, make them one
  consistent scoped control). On a narrow width, `+` collapses into the Replan menu first;
  Plan status stays visible.
- Rules: within a group every control is the same height; icon-only controls always have a
  tooltip; only Replan is filled/accent, the rest are ghost.
- **Skipped:** a vertical Wk rail down the grid's left edge — redundant with the dropdown,
  doesn't fit the 7-row grid height, works against the minimalist goal. Revisit a slim
  *horizontal* term strip only if term navigation proves clunky in use.

**2. Diagnostics drawer.** Remove the always-visible inline "Plan Status" bar (frees grid
height). Its content + new diagnostics move into a right-side **slide-over drawer** (~400px,
full-width on mobile), opened by the Plan status button, closed by X or Esc, **non-modal** (grid
stays usable behind it, light shadow not a heavy scrim). Contents:
- Replan history (generated when / through when / N days / last error) — kept from today's bar.
- Per active assignment/exam: due date, effective difficulty, priority score, desired hrs,
  planned hrs, shortfall, and the date it first became schedulable (its start-window).
- Capacity summary: total study demand vs. total free study capacity over the horizon, and which
  days/weeks came up short.
- v1 is all computable from existing planner outputs; per-placement rationale ("why is *this*
  block at *this* time") needs planner instrumentation → deferred to a later pass.

**3. Auto-open on shortfall (new behaviour).** After `refreshQuarterPlan` / `refreshWeekPlan`,
if there are shortfalls, auto-open the drawer instead of only flashing a toast. Stash the last
shortfall list on `quarterPlan` so it's still shown if the drawer is reopened later. This
absorbs most of B-05 — B-05 shrinks to "drawer also shows a suggested fix value per shortfall".

**4. Past-day study plan read-only (new behaviour).** Replan/Refresh/Clear already protect
`dateStr < today` (verified — the earlier history-protection fix holds; empty early weeks are
just weeks never planned, not erased). The gap is the *manual* edit paths — the double-click
block-edit modal in Timeline/WeekGrid, plus `saveBlockToDay` / `deleteBlockFromDay`. Disable
double-click edit / delete for any day before today; guard the two store functions at the source
as a backstop.

### B-08 · Day-view calendar visual design
The Today tab's "view day calendar" modal is functional but its visual design was explicitly left
as an open, parked question. Needs a design pass (layout, density, how blocks/meals/classes/gym
read at a glance) and implementation.

### B-09 · Validate college-calendar auto-fetch end-to-end
The `/api/college-calendar` endpoint and its parsing exist, and a parsing bug was fixed, but the
real quality of the web-search-backed result was never verified end-to-end with a live API key.
Now that production has a working key, actually run it against several real schools and judge
whether the output is trustworthy; fix as needed.

### B-10 · Real notification sending (WhatsApp / email)
Browser notifications for due dates / exam prep work. WhatsApp is a formatted preview to copy, not
live sending; the email/username/password fields in the notification settings are placeholders
with no real auth. This needs actual notification infrastructure — a sending backend and real
delivery — and is the larger piece here.

### B-11 · Transactional email provider for auth confirmations
Supabase's built-in email sender is heavily rate-limited and unreliable. Before external testers,
wire a real transactional provider (Resend, SendGrid, etc.) into Supabase's SMTP settings so
sign-up confirmation (and later, password-reset) emails actually deliver. Mostly configuration.

### B-12 · Account management under real auth
The Account modal still has placeholder email / username / password fields from the single-user
era. Under real Supabase auth it should show the actual signed-in account and support: change
password, sign out (exists in the header now), and delete account (with data removal). Possibly
also display name / basic profile.

### B-13 · Onboard Itay as 2nd developer
The pipeline is ready (GitHub + branch protection + CI + Vercel previews + Supabase). Remaining:
grant Itay repo, Vercel, and Supabase access; a short walkthrough of the branch/PR flow and the
`lib/` + `components/` layout; agree on how work is split.

### B-14 · Conversational AI query over all your data + app help
A free-text "ask anything" interface where the student queries their own data in natural language
— "when's my next exam and how ready am I", "what's my GPA if I ace the final", "what am I
supposed to be doing Thursday afternoon", "which class is dragging my average down" — spanning
syllabus, study plan, grades, calendar, and habit logs. It also answers "how do I…" / "where do
I find…" questions about the app itself. Read-only: it explains and surfaces, never edits. Needs a
chat UI, assembly of the user's data plus an app feature-map into context, and enough grounding
that answers are trustworthy and don't invent facts. Related to B-07 but broader and
conversational.

### B-15 · New-user Site Tour / guided walkthrough
An interactive tour for first-time users that walks through the startup flow and points out what
each part of the app does — coachmark-style highlights with short explanations, step-through,
skippable, re-launchable later from a help menu. Complements the onboarding wizard (which collects
data) by orienting the user in the UI once they're in.

---

## New ideas (unsorted — move into the table above once fleshed out)

<!-- Add rough ideas here; we turn them into B-## entries with a description during review. -->
