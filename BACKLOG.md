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
| — | B-05 | Overflow UI — persistent shortfall banner | UX | M | Backlog |
| — | B-06 | GPA target-planning | UX | M | Backlog |
| **1** | B-07 | Planner diagnostics panel + past-day study plan read-only | UX | M | Next |
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

### B-05 · Overflow UI — persistent shortfall banner
When the planner can't fit everything, the only signal is a transient toast naming the shortfalls.
Designed but not built: a persistent alert banner that stays until addressed, deep-links into
Study Preferences, and pre-fills a suggested value (e.g. lower an estimate, extend prep days).

### B-06 · GPA target-planning
Grade capture exists (per-course and per-item grades, letter conversion, live GPA). Nothing is
built on top: "what grade do I need on the remaining items to hit a target GPA," and optionally
letting that target influence how the planner allocates study time.

### B-07 · Planner diagnostics panel + past-day study plan read-only
Two things in one pass:

**Diagnostics panel.** Preferences currently shows only a Refresh Plan history. A real diagnostic
view would expose the *current* planner's concepts — per-item slack, priority score, why an item
was placed where it was, where capacity ran out — so plan decisions are inspectable rather than a
black box.

**Past-day study plan read-only.** Replan / Refresh / Clear plan already leave `dateStr < today`
untouched (verified — the earlier history-protection fix holds; empty early weeks are just weeks
that were never planned, not erased). The remaining gap: the *manual* edit paths
(`saveBlockToDay` / `deleteBlockFromDay`, the double-click block-edit modal in Timeline/WeekGrid)
have no past-day guard, so a user can still edit history. Disable the double-click edit / add /
delete on any day before today — past days only.

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
