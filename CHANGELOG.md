# StudyOS Changelog

## v2.80.5 — 2026-09-18

**Focus Time: the last study session of the day skips the break — nothing to return to after it**

Asked: "the last study session on any day - does not need to have a break. Is that big effort to
fix?" Small — the Focus Time timer (`components/Today.jsx`) runs study and break as one continuous
countdown per session (Play commits to both phases at once, no second click for the break), always
transitioning study→break→complete regardless of whether anything else is scheduled after. A break
after the actual last session just sat there counting down with no next session to return to.

Fixed by checking, at the moment a session's study phase ends, whether it's the one with the
LATEST end time among everything scheduled today (`todayRealBlocks`) — not array order, not
completion state, so an earlier block finished out of order or already marked done doesn't change
which one is chronologically last. If it is, the session completes immediately (same as a manual
Complete click) with no break countdown and no "Break time! ☕" notification; every other session
keeps the existing study→break→next behavior unchanged.

Caught in review before shipping: my first pass at this edit introduced a brace-matching bug that
would have made the "break's over" fallthrough code run in the wrong branch — found by re-reading
the diff, not by a test catching it. Verified the actual `isLastToday` logic against realistic
sample data (first/middle/last block, a single-block day, two blocks tied at the same end time, an
unknown id) — all correct. Couldn't run a full live end-to-end timer test (today has no study
blocks scheduled — exam day — and even on a day that did, the real fix only proves itself after a
real 15–45 minute countdown, not a good use of anyone's time to sit through). Build clean, 184/184
existing tests pass, page renders with no runtime error.

## v2.80.4 — 2026-09-18

**Field alignment moved to ~40% from the left; mobile label-to-field spacing tightened**

Two requests: "move the alignment line ... around 40% of the screen width from the left," and on
mobile, "the space between the field name above it too much ... make sure the field name will sit
much closer above the fields."

**Alignment line.** Switched `.aligned-fields .field-grid` from equal (50/50) content-sized columns
to a straight 2fr:3fr (40:60) percentage split spanning the card's full width. This is actually
*simpler* than the previous content-measured version — a fixed ratio doesn't need any label's width
measured at all, so the line can't drift depending on which label happens to be longest. Removed
the `useLayoutEffect`/label-measuring code from `components/Sett.jsx` entirely now that it's
unused. Verified live: fields land at 41.4% from each card's left edge, identical across all 3
cards (the fixed 240px field column used by Gym/Chores/Notifications sections is untouched — those
still need real typing room a percentage split would cramp).

**Mobile spacing.** Real bug, not just "too much space": the stacked mobile layout's `row-gap` is
uniform between every row, and the label's own `margin-bottom` was stacking ON TOP of it — so a
label actually sat *farther* from its own field (22px) than from the next field-group's label
(16px), backwards from how a form should read. Fixed by dropping `row-gap` to 6px (tight,
label-to-its-own-field) and moving the real separation onto `margin-top` on every label except the
first (`label:not(:first-child)`, plus the same treatment for Meal times' icon+name rows via
`.align-col-label`). Verified live via `getBoundingClientRect()`: label-to-own-field is now 6px,
field-to-next-label is 22px — correctly the other way around from before, and the ratio a form
should have.

Re-verified against a real mobile viewport (iframe, not a fixed-width div) on Sleep & Wake and Meal
times: no overflow, clean left-aligned stacking, correct tight/loose spacing rhythm. Build clean,
184/184 tests pass.

## v2.80.3 — 2026-09-18

**Fields now genuinely start at the card's center line, not just "the block is centered"**

Real bug in v2.80.2's centering: `width:max-content; margin:0 auto` centers the whole label+field
BLOCK as a unit, which is not the same as the FIELD starting at the true center — a wide measured
label column next to a fixed 240px field column makes the block lopsided, so its own midpoint (the
point `margin:auto` actually centers around) sits well left of where the field begins. Confirmed
live before the fix: fields started ~62px left of the card's true center.

Fixed with a new `.aligned-fields` wrapper class (the Daily Schedule tab's root div) that makes
both grid columns the SAME width — the same `--label-col` already measured for cross-card
alignment — so the two halves are symmetric and the label/field boundary genuinely lands on the
center line. Deliberately scoped to just this wrapper, not the default for every `.field-grid`: a
free-text field (Chores' "Or custom name", Custom reminders' "Remind me about...") needs real
typing room a label-width-only column would cramp, so those keep their existing fixed 240px field
column.

Caught in review before shipping: the new `.aligned-fields .field-grid` selector is more specific
(2 classes) than the plain `.field-grid` mobile rule (1 class) — without also listing it inside the
`@media(max-width:640px)` block, it would have kept winning over the stacked mobile layout even
below the breakpoint, silently reintroducing overflow risk on exactly the phones this was built to
protect. Fixed by listing both selectors together in the media query.

Verified live: measured `getBoundingClientRect()` on all 3 cards — fields now start 7px right of
the card's true center (half the column gap, effectively exact) and identically so across Sleep &
Wake, Study preferences, and Meal times. Re-ran the real-viewport mobile check (iframe, not a
fixed-width div) — still clean, no overflow, no clipping. Build clean, 184/184 tests pass.

## v2.80.2 — 2026-09-18

**Sleep & Wake, Study preferences, and Meal times now share one aligned, centered field column**

Two follow-up refinements to v2.80.1's per-card field alignment: "align all the fields in the 3
sections to the SAME right/left distance," then "a better UI design: center the field at the mid
page, align all field name text to the right."

CSS Grid's `max-content` label-column sizing is per grid instance — three separate `.card`s each
aligning to only their OWN longest label doesn't produce one shared column. Fixed with a small
`useLayoutEffect` (`components/Sett.jsx`) that measures every label (marked `.align-col-label`)
across all three cards once, and sets the max as a `--label-col` CSS custom property on their
shared wrapper — inherited down through all three `.field-grid` instances, so every field's left
edge lands at the same X position across cards, not just within one. Re-measures on resize;
skipped above the mobile breakpoint since it stacks there regardless.

Each label+field pair is now also centered as a unit in its card (field column is a fixed
`minmax(0,240px)` track, not `1fr` — `1fr` would stretch it to the card's full width and pin the
pair to the left edge instead of centering it), with the label right-aligned immediately against
its field.

Meal times' rows (icon + meal name standing in for a plain label) now use the same `.field-grid` so
they participate in the shared column too — Breakfast/Lunch/Dinner's time+duration fields align
with Wake time/Focus length exactly. Caught in review before shipping: the icon+name pair was
right-aligned via an inline style, which doesn't respond to the mobile media query the way a real
`<label>` does — moved to a class (`.align-col-flex`) with its own mobile override so it correctly
flips to left-aligned when stacked, matching every other label in these three cards.

Mobile safety (explicitly requested): the stacking breakpoint is 640px here, not `.g2`/`.g3`'s
480px — this section's longest label plus even a shrunk field genuinely needs more room than a
phone gets below ~600px. Both grid columns use `minmax(0,...)`, not a bare value, so a track can
shrink (and label text wrap) instead of forcing the page wider on a width the breakpoint doesn't
catch. Verified with a real mobile viewport — an iframe with its own CSS media context (a
fixed-width div does NOT trigger a `@media` breakpoint, confirmed the hard way earlier this
session) — checked `document.documentElement.scrollWidth <= clientWidth` (no overflow) on all
three cards, then visually confirmed clean stacking with no clipping.

## v2.80.1 — 2026-09-18

**Preferences fields: label + field on one line, aligned to the longest label per section**

Requested: "1) Field name and field at the same line. 2) all the fields to be aligned (right-to
left) at the same line based on the space the longest field name need." New `.field-grid` CSS
class (`app/globals.css`) — a 2-column grid (`max-content 1fr`) so the label column is
automatically sized to whichever label is longest *in that section*, right-aligned, with every
field's left edge landing in the same place. No manual pixel-width guessing, and it stays correct
if a label's text ever changes.

Applied across every plain label+field group in Preferences: Sleep & Wake, Study preferences
(Focus/Break/Energy peak — now genuinely one aligned block, not just one row), Gym's Stretch
prep/Drive to gym, Fun time targets (with each field's "Xh total" hint riding along inside its own
cell), the whole "Add Chore" card (Quick select's button row and Which days?'s day-picker now
align with the plain text fields too, not just inputs), and Custom reminders (Remind me
about.../Date/Time). Left unchanged: the SMS phone number field (its own recent bespoke +1-prefix
design), and the meal-time/gym-day/toggle rows, which already read as one line via their own
icon/checkbox-led layout — a different, already-working pattern, not the stacked-label one being
fixed here.

Mobile: falls back to the same stacked (label-above-field) layout as `.g2`/`.g3` already use below
480px, rather than force one line at any cost — a section whose longest label is genuinely long
(e.g. "Focus length (study time before a break)") would otherwise leave no room for the field
itself on a phone width. Verified against a REAL 375px viewport (an iframe with its own CSS media
context, not just a fixed-width div — the earlier technique doesn't actually trigger a
viewport-based media query): confirmed on Study preferences (longest-label case) and the full Add
Chore card (most rows, mixed widget types — buttons, day-picker, inputs) — clean stack, full
readable text, nothing clipped or overflowing.

## v2.80.0 — 2026-09-18

**Preferences UI consistency + mobile pass — compact fields everywhere, Study preferences on one row, gym schedule redesigned, and an app-wide color-readability sweep**

Requested: "go over ALL Tab under preferences and the UI assets we used there and make sure we are
consistant neatly with the design language... implement it on all fields and don't leave anymore
inconsistancy in the app." Four separate changes, all part of the same pass:

**1. Compact time/date/number fields (`.input-time`/`.input-date`/`.input-num-sm` in globals.css,
same idea as the existing `.select-compact`).** Every time/date/number field across all 4
Preferences tabs (Wake/Sleep, Energy peak, meal times, gym per-day times, stretch/drive minutes,
fun-time hours, chore time/duration, custom reminder date/time) inherited the app-wide
`width:100%` default, stretching to fill whatever grid column or row it sat in — "away too long"
on desktop (a `.g3` column alone runs 200-300px, many times what "07:00 AM" needs). Now a fixed,
comfortable width instead, applied identically everywhere. First pass tightened these more than it
should have and clipped the AM/PM text ("09:00 A" instead of "09:00 AM") — caught live and widened
back out; verified full "09:00 AM"/"12:00 AM"/"01:00 PM" display afterward.

**2. Gym per-day row — a real, separate mobile bug closed out.** The row's time fields were
shrunk to `fontSize:12` to make them fit — which is itself a documented bug: the comment above
`input,select,textarea` in globals.css already flagged that any input under the 16px baseline
triggers iOS Safari's auto-zoom-on-focus, and explicitly called out "a few compact... inputs" as a
follow-up sweep. This is that sweep. Full-size 16px `.input-time` fields now wrap onto their own
line under the day checkbox on narrow screens (verified against a real 375px viewport — iPhone SE
width) instead of shrinking to fit. Same fix applied to the identical gym widget duplicated in the
onboarding wizard (`components/Onboard.jsx`).

**3. Two follow-up requests mid-pass:**
- Study preferences: Focus length, Break length, and Energy peak now share one row (`.g3`, same
  as Sleep & Wake above it) instead of Energy peak sitting alone on its own row below.
- Gym schedule: each day is now Start time + a duration select ("60 min", same idiom as meal
  duration) instead of Start + End time with an arrow between them — the arrow is gone, and the
  student no longer has to subtract two clocks to know a session's length. The underlying data
  shape is unchanged (`gd.e` is still stored, now always derived as start+duration) so
  conflict-checking and the planner elsewhere keep working exactly as before — no migration. A
  legacy/custom duration that doesn't match a preset is added to that row's own option list rather
  than silently snapping to a different value on load. New `GYM_DUR_OPTIONS` constant in
  `lib/constants.js`; mirrored into the onboarding wizard's gym step too.

**4. App-wide color-readability sweep — 11 more instances of an already-known bug pattern.**
Same fix as this session's earlier "red text over brown background" fixes: a sentence/paragraph of
body text set directly in an accent color (amber/blue/green/red) reads poorly on that color's own
tinted background, even though a short pill/badge in the same combo is fine. Swept every
`background:"var(--*-bg)"` banner across the app and fixed the ones that were actual sentences, not
badges: Sett.jsx (meal-times info banner, "SMS reminders are on" status row), Onboard.jsx (PDF
privacy note, both "imported!" confirmations), Today.jsx (missing-due-dates banner), Acad.jsx
("Last synced" banner), shared/ui.jsx (AI-read notice, "files skipped" line), shared/DayAgenda.jsx
("not planned yet" banner), shared/modals.jsx ("looks like duplicates" banner) — body text switched
to white, icon/accent kept as the color cue. Left untouched: `.badge-*` pills, stat-tile numbers,
and icon-only buttons on tinted backgrounds — those are a different, intentional, already-working
pattern (short label/number, not a sentence).

Verified live throughout: all 4 Preferences tabs screenshotted at full width (all fields compact,
no clipping); gym row cloned into a real 375px-wide sandbox (iPhone SE width) — clean wrap, no
overflow, full 16px legible text; gym duration select changed live and confirmed it correctly
derives/persists the new end time across a full page reload, then reverted back to the real
account's original values; "Last synced" and "AI read this" banners confirmed white-on-tint live.
Build clean, 184/184 tests pass.

## v2.79.6 — 2026-09-18

**Phone field: +1 moved outside the input, blur is the explicit "Confirm Number" moment — plus a real validity-check bug caught live**

This is a US-only product, so there's no reason to make the student type or edit a country code:
"+1" is now a fixed, non-editable box to the left of the input, and the input itself holds only
the 10 raw digits. Typing shows no error yet (mid-entry isn't a mistake); clicking outside the
field — the natural "I'm done" moment — is what triggers validation: a green "Number confirmed."
message for a complete 10-digit number, or a red "Enter a full 10-digit number." error otherwise.
An incomplete number is never silently accepted.

Caught during live verification of this change: the old `isValidUsPhone` counted digits across
the *entire* `+1`-prefixed string. Since the field always stores `+1` + whatever was typed, a
number that was missing its last digit (9 real digits) plus the "1" from "+1" totaled exactly 10
digits — so it was misread as a valid 10-digit number and silently accepted. Fixed by stripping
exactly the literal `+1` prefix before counting, so validity is always checked against the real
digits the student typed.

Verified live: typed a 9-digit number and blurred — before the fix this showed a false green
"Number confirmed."; after the fix it correctly shows the red 10-digit error. Restored the real
number, blurred, confirmed the green message, then reloaded the page fully and confirmed the
number persisted correctly (`4084764297`).

## v2.79.5 — 2026-09-18

**Phone number field now masks to digits-only, hard-capped at 10 — illegal input can't be typed in**

`maxLength` alone only capped total character count — letters, symbols, and extra/missing digits
all still typed in fine, only caught later by the Submit-time check. `maskUsPhone` now strips every
keystroke down to digits and hard-caps at 10 significant digits (a leading `1` is treated as the
country code, not counted as an 11th digit), always re-rendering as a clean `+1XXXXXXXXXX` — the
field can only ever hold a valid number or a valid prefix of one.

Verified live: typing `abc555123456789999xyz` directly into the field correctly masked down to
`+15551234567` in real time.

## v2.79.4 — 2026-09-18

**Preferences UI consistency pass: sized buttons/toggle/input, fixed tinted-text-on-tinted-bg banners**

Real reported issues, plus a consistency sweep of the same patterns elsewhere in this page:

- **Browser permission On/Off toggle** was stretching to the full card width (`.toggle-opt` is
  `flex:1`, and the bare `.toggle-group` here had nothing constraining its own width, unlike every
  other toggle-group in this file which sits in a row next to a label). Now `display:"inline-flex"`
  hugs its own content.
- **Phone number field** now caps at `maxWidth:220` instead of the global input default of
  `width:100%` — proportionate to how short the actual content is.
- **"Add chore," "Enable notifications," and "Add reminder"** buttons no longer stretch
  `width:100%` across their cards — sized to content, matching the SMS buttons fixed earlier today.
- **Consistency sweep**: found the same low-contrast pattern already fixed on the main toast
  (colored text directly on its own color-tinted background) still present in three inline
  warning banners on this same page (meal/gym schedule conflict warnings). Text switched to white,
  with the icon keeping the severity color as the at-a-glance cue — same split the toast uses.

## v2.79.3 — 2026-09-18

**SMS phone input: live length checkmark, capped length; server-side send logging**

- Phone input now caps at 16 characters (the longest reasonable typed format) and shows a live
  green checkmark the instant the digit count is actually valid — feedback while typing, not just
  a rejection after Submit.
- `/api/sms/send` now logs every send attempt server-side: the Twilio SID + status on success (a
  real, traceable reference for a "the app said success but nothing arrived" report — that gap
  means Twilio *accepted* the message, which is not the same as the carrier actually delivering
  it), and the Twilio error code/message on failure. Previously logged nothing at all either way.

Real note on the "sent but never arrived" report this session surfaced: the earlier live-test
"Yes, it arrived" confirmation was clicked during automated testing without an actual way to
verify a real phone received anything — that was a mistake, not a real confirmation. The
verification state has been left for the user to redo for real.

## v2.79.2 — 2026-09-18

**SMS: 10-digit validation, auto-verify-and-confirm, sized buttons, white error text**

Real feedback from testing the just-approved SMS flow directly:

1. **Phone number validation** — a 9-digit number (missing a digit) used to be silently accepted
   and only failed deep inside a confusing Twilio API error. Now checked client-side first
   (`isValidUsPhone`): a full 10 digits required, or a clear toast before anything is sent.
2. **Auto-test-and-confirm on a new/changed number** — entering a phone and opting in no longer
   just flips SMS on and hopes for the best. It now sends a real test text first and shows
   "Did it arrive? [Yes, it arrived] [No, let me fix it]" — SMS only actually turns on once
   confirmed. The same applies to an already-enabled account whose number changes: a new
   `smsVerifiedPhone` field tracks exactly which number was last confirmed, and any mismatch shows
   an amber "This number hasn't been verified yet" prompt instead of silently trusting it.
3. **Buttons sized to content** — "Yes, text me reminders" and "Send me a test text" no longer
   stretch `width:100%` across the card.
4. **Error toast text is now pure white** (`#fff`, not `var(--t1)`) instead of reading as
   low-contrast/reddish against the dark red-tinted background.

Verified live end-to-end: a real test text confirmed delivery through the full flow, the
9-digit-number validation correctly blocked before any API call, and the toast's computed color
confirmed `rgb(255,255,255)` text on the dark red background.

## v2.79.1 — 2026-09-18

**SMS opt-in evidence page: screenshot now shows the real unchecked-by-default state**

Real cause of a Twilio A2P 10DLC rejection (Error 30925, "opt-in flow ... does not show clear,
affirmative consent ... checkbox cannot be pre-selected by default"): the actual code has always
defaulted the consent checkbox to unchecked (`useState(false)`, confirmed) — the evidence
screenshot on `studyos.io/sms-optin` just happened to have been captured with the box already
checked, giving the reviewer the exact wrong impression.

- Retook the screenshot from the real live screen in its true default state — box unchecked,
  submit button visibly disabled/greyed (`disabled={!phone||!smsConsent}`) — with a placeholder
  phone number (`+15551234567`) instead of a real one.
- Fixed the image's `alt` text, which had separately (and wrongly) said "a checked consent
  checkbox" — directly contradicting the correct "unchecked by default" text one paragraph above
  it. Also strengthened the surrounding copy to call out the unchecked/disabled default state
  explicitly, so there's no ambiguity for a human or automated reviewer this time.

## v2.79.0 — 2026-09-18

**Schedule-driven study/break reminders — fires at the real planned clock time**

Correction per direct feedback: the Focus Time signals built earlier today only fired for a
session the student had already manually clicked Play on. The actual ask was proactive: "10:00
MATH 180A — start studying," "10:45 — time for a break," independent of whether Play was ever
touched. Today's click-to-start live timer (Play/Pause/countdown) is untouched and still there as
its own active-session tool — this is a separate, passive watcher layered on top.

- New `scheduleReminders(data,now)` in `lib/calendar/weeks.js` — a pure, testable function: for
  each of today's real study/homework/project sessions, checks whether *right now* is within 10
  minutes of that session's study-start, break-start, or block-end clock time (using the real
  `focusMins`/`breakMins` split), and returns the reminder(s) due. Bounded to a 10-minute window
  after each boundary — deliberately not open-ended, so a session from hours ago never fires a
  stale flurry of "start studying" reminders the moment the app happens to be reopened.
- App.jsx ticks this every 30 seconds via a small ref-based watcher (refs keep the interval on the
  latest data without tearing down its per-block/day dedupe on every unrelated data change), firing
  a browser Notification (if granted) and logging every reminder to the new notification bell —
  the same log/badge/panel shipped earlier today.
- 9 new unit tests with a controlled clock, covering every boundary and the "must stay silent"
  cases (gap between windows, already completed, wrong kind, other day, hours-later staleness).

Live browser verification wasn't available for this one (Chrome extension disconnected mid-session)
— shipped on build success + the full unit-test suite (184 tests, all green) + code review.

## v2.78.0 — 2026-09-18

**Notification bell — a persistent log of real alerts, with an unread badge**

A bell icon in the top bar's right-hand icon group (next to the Evening Check-in shortcut) opens
a dropdown listing the real alerts StudyOS has sent — the daily priorities notification and Focus
Time's break-start/break-over signals — not routine toasts (those stay transient, as before).

- New `lib/data/notifications.js`: `pushNotification(data,upd,{title,body})` appends an unread
  entry (capped at 50, oldest dropped); `markAllNotificationsRead(data,upd)` marks the whole log
  read in one pass, no-ops if nothing's unread.
- `notifications:[]` added to the data schema — old accounts default to an empty log via the
  existing `data.notifications||[]` guard, no migration needed.
- Wired at the two real trigger points: App.jsx's once-daily priorities Notification, and
  Today.jsx's two Focus Time phase signals (break-start, break-over) — logged regardless of
  whether the OS-level browser Notification itself fired (permission not granted, etc.), so the
  bell is a reliable fallback even without notification permission.
- Bell shows a red unread-count badge (9+ caps display); opening the panel marks everything
  visible read immediately — no per-item click needed, matching most notification-bell UIs.
- 6 new unit tests for the pure data-layer logic (add/cap/mark-read/no-op-when-clean).

Verified live end-to-end, not simulated: the badge showed a real unread count from the daily
priorities notification, the panel displayed its actual logged content and timestamp, and the
badge correctly cleared after opening.

## v2.77.0 — 2026-09-17

**Focus Time: automatic study→break→complete, with a chime + notification at each transition**

One Play click now runs the whole session — study phase, then automatically into break, then
complete — using the real `focusMins`/`breakMins` profile values (not the block's own rounded
combined duration), matching the calendar's new split-color bars from earlier today.

- New `lib/notify.js`: a short two-tone chime (Web Audio, no permission needed — rising tone for
  "break starts," falling for "break's over") plus a best-effort browser Notification if
  permission is already granted. Never requests permission itself.
- `Today.jsx`'s countdown is now phase-aware (`study`/`break`): at 0 in the study phase it
  switches straight to a break countdown with no click needed; at 0 in break it fires the
  "break's over" signal and completes the session exactly as before.
- The running row shows a small "BREAK" label in teal during the break phase, distinct from the
  amber study countdown.
- Onboarding's Study step (right under the Focus/Break length dropdowns) now offers to enable
  browser notifications — optional, skippable, reuses the same `Notification.requestPermission()`
  flow already in Preferences, framed honestly as ongoing (break alerts + the existing once-daily
  priorities notification).

Verified live: starting a session now begins the countdown at the real `focusMins` value (tested
by temporarily setting Focus/Break to 15/5 min and confirming the timer started at 14:57, not the
block's own 60-minute duration), with no console errors from the new chime code. Preferences
restored to their real 45/15 values afterward. The full real-time phase transition (15+ minutes)
wasn't practical to wait out via automation — verified through code review instead.

## v2.76.5 — 2026-09-17

**Calendar: study blocks now show their break portion as a faded tone of the same color**

Every planner-scheduled study/homework/project block is really one focus+break Pomodoro chunk
(`presetLenFor`) with zero visual distinction between the two parts. Split the block's bar into
two proportional segments — full-tone for the study portion, the same color at 0.4 opacity for
the break portion — using the real `focusMins`/`breakMins` ratio, not absolute minutes, so it
stays correct even if 15-min rounding made the placed block a bit longer/shorter than
focusMins+breakMins exactly. Fixed-duration activities (class, gym, meals, commute, etc.) are
unaffected — only `study`/`homework`/`project` kinds get the split.

Verified live: a 45/15 focus/break profile renders as a 75%/25% split at the exact same RGB color,
confirmed via direct DOM inspection of the rendered segments.

## v2.76.4 — 2026-09-17

**Calendar block edit: same "not before its time" rule as Progress**

Same "can't act on a session before its time" rule as the Progress todayPassedBlocks fix earlier
this session, applied to the Calendar page's block edit modal (double-click a session to open it):

- **Start time** now has a `min` of the current time when editing a block on today's date — the
  browser's own time picker won't offer an earlier slot, and saving is blocked with an inline
  "Can't schedule a start time in the past" error (and a disabled Save button) even if a value
  slips past the picker (manual entry, mobile browsers).
- **"Mark as completed"** is now disabled — greyed out, with a tooltip explaining why — until the
  block's own (possibly just-edited) end time has actually passed. Already-completed blocks can
  still be unchecked any time, to fix a mistake.
- Verified live: opening a not-yet-happened session today shows the checkbox correctly locked
  with the tooltip, and forcing an earlier start time (bypassing the native picker) correctly
  shows the error and disables Save.

## v2.76.3 — 2026-09-17

**Evening Check-in: AI feedback card background darkened to a clearer gray**

`#eef0f4` read too close to white — darkened to `#c9ccd2`, with text darkened to match
(`#20242e`) so contrast stays strong.

## v2.76.2 — 2026-09-17

**Evening Check-in: AI feedback card is now light gray with dark text**

Replaced the dark-green background / light-blue-grey text combo with a light gray card (`#eef0f4`)
and dark text (`#242933`) — a deliberate, isolated break from the app's otherwise all-dark
palette for this one card, since it's a warm personal note rather than a status/severity signal.

## v2.76.1 — 2026-09-17

**Check-in icon now always in the topbar; the nudge itself still starts at 8pm**

Split the evening nudge into two pieces, per feedback: a plain check-in shortcut icon in the
top bar's right-hand icon group (next to Bug Report/Account) is now always present — muted grey,
just a quick way to jump to Progress. The "Click to report complete" text badge + × still only
appears once the real nudge conditions are met (8pm, real work to report, not yet checked in);
when it does, the always-there icon also turns amber and bounces, tying the two together.

## v2.76.0 — 2026-09-17

**Evening report-complete nudge**

A small amber badge in the top bar (visible on every tab, not just Progress) — "🔔 Click to
report complete" — appears from 8pm onward, but ONLY when there's actually something to report
(`hasCheckInWork`: a due/overdue assignment, an exam inside its prep window, or an unmarked past
session) and today's check-in hasn't been submitted yet. Clicking it jumps to the Progress tab.

- New `lib/calendar`'s `hasCheckInWork(data)` — a cheap boolean version of Progress's own
  tasks/catchDays logic, used purely to gate the nudge without duplicating the display lists.
- The × hides the badge from view but does **not** stop it — it comes back in 30 minutes. The
  only thing that actually clears the nudge is submitting Report Complete (today's `dailyLogs`
  entry existing).
- Bell icon bounces gently (`.nudge-bounce`, respects `prefers-reduced-motion`).
- A `nowTick` state (re-evaluated every 60s) is what makes 8pm arriving and each 30-minute snooze
  actually take effect without requiring the user to do anything.

## v2.75.8 — 2026-09-17

**Progress: shorter, plain-language tooltips on the top stat cards**

Replaced the formula-heavy tooltip text (weights, multipliers, math notation) on all 7 Progress
stat cards with short, plain-language sentences — same accuracy, easier to actually read at a
glance.

## v2.75.7 — 2026-09-17

**Progress: merged Evening Check-in and Catch Up into one list, one Report Complete button**

- Evening Check-in and Catch Up are no longer two separate cards with two separate submit
  buttons — one combined checklist, one "Report Complete" button that applies both: today's
  checked assignments/exam-prep AND any past unmarked sessions checked off, in one click.
- Today's items show "Today" in amber (matching the Catch Up rows' inline date styling) instead
  of no date label at all.
- `submit()` now runs `catchUpMarkComplete` for any checked catch-up items before saving the
  daily log; the AI-feedback once-per-day cap is unaffected. The confirmation toast mentions how
  many sessions were caught up, when any were.

## v2.75.6 — 2026-09-17

**Progress: removed redundant exam badge, sized action buttons to their content**

- Evening Check-in task rows: removed the right-side "exam"/type badge — redundant with the
  item's own label already saying "exam."
- "Submit Check-in" and "Mark caught up" no longer stretch to `width:100%` — sized to their
  content like a normal button.

## v2.75.5 — 2026-09-17

**Progress: headline in its own card; Catch Up rows show date inline, drop course name**

- "Keep the pace and mark your progress daily" now sits inside its own `.card`, directly under
  the page title — back in the normal page-body content flow instead of bare text, same plain
  styling as Catch Up's description.
- Catch Up list rows: removed the per-day date header (shown separately, in `--t3`/blue-ish) and
  the right-aligned course-name label on each item. The date is now shown inline on the item's own
  row, immediately after the checkbox, in amber.

## v2.75.4 — 2026-09-17

**Progress: headline moved under the page title, styling matched to Catch Up**

Correction to v2.75.3 — "Keep the pace and mark your progress daily" moved from inside the
Evening Check-in card to directly under the "Progress" page title (above the stat cards),
and restyled plain (`fontSize:13`, no bold, no explicit color) to match the Catch Up section's
own description paragraph exactly, instead of the bold white treatment from the last pass.

## v2.75.3 — 2026-09-17

**Evening Check-in: new headline copy, removed the %/progress bar**

- The card's intro line is now "Keep the pace and mark your progress daily" — bold, white
  (`var(--t1)`), placed above the "Evening Check-in" title as the card's first element. Replaces
  "No judgment — tracking so tomorrow's plan is smarter."
- Removed the "What got done? / NN%" row and its progress bar entirely — straight into the task
  checklist now. The unused `dp` (done %) variable was removed with it.

## v2.75.2 — 2026-09-17

**Progress: removed redundant Habit Score section, added tooltips to every stat card**

- Removed the large "Habit Score" card/bar section — it duplicated the "Habit score" stat card
  right above it with no added information.
- `StatCard` (shared component) now accepts an optional `tt` prop — hover tooltip explaining what
  the metric is/how it's computed, using the existing `.tt`/`data-tt` mechanism. Opens below the
  card (`tt-below`) since these sit near the top of the page, where the default above-trigger
  placement would clip off-screen.
- All 7 Progress stat cards (Habit score, Streak, Completion, Gym/30d, GPA, Focus/30d, College
  ready) now have one.

## v2.75.1 — 2026-09-17

**Sparkle re-scoped to real completions; wordmark now STUDYOS**

Correction to v2.75.0, per direct feedback: the sparkle burst was wired to Preferences/Academics
"Save & Replan," which was never the intended trigger. Removed entirely from both Save & Replan
buttons. The real, intended trigger is "the user clicks CHECK on a study-plan item or an
assignment, anywhere" — now wired at every real place that happens:

- Today's Focus Time "Mark complete" (unchanged from v2.75.0 — this one was already right)
- Academics: the assignment-row checkbox that marks it done
- Progress → Evening Check-in: each task checkbox, fired on check (not uncheck)
- Progress → Catch Up: each missed-session checkbox, same as above
- The shared Block Edit modal's "Mark as completed" checkbox (Timeline/Week's edit-a-block flow)

Also: the "StudyOS" wordmark is now displayed **STUDYOS** (all-caps) everywhere it appears as the
stylized brand mark — the top bar (`App.jsx`), both Login screen instances, the SMS opt-in
evidence page, and the browser tab title. Left as mixed-case "StudyOS" only inside running legal
prose (Terms/Privacy body text), where all-caps would read as shouting mid-sentence rather than a
brand mark.

## v2.75.0 — 2026-09-17

**Sparkle burst: a lightweight celebration on Mark Complete and Save & Replan**

Prototyped first as a standalone Claude Artifact mockup (matched to StudyOS's real palette —
`app/globals.css` tokens, the real `StudyOS` Syne/gradient wordmark — and tuned for pacing across
a few rounds of feedback) before being wired into the real app.

- New `lib/sparkle.js` — a small canvas particle burst, not a React component: a single
  module-level canvas is created lazily on first use and painted only while particles are alive
  (nothing runs at rest, no idle loop, no library). Colors are read live from the app's real
  `--amber`/`--blue`/`--green`/`--teal` custom properties, so it always matches the current theme.
  Respects `prefers-reduced-motion` — no-ops entirely when set.
- Two tiers: `sparkleBurst(el,"task")` — a small ~20-particle amber/green spark, wired to Today's
  "Mark complete" button (both a manual click and the timer auto-completing at 0 use the same
  code path). `sparkleBurst(el,"save")` — a fuller ~60-particle burst in the full amber/blue/teal
  mix, wired to both real "Save & Replan" buttons (Settings, and Academics' difficulty-research
  Save & Replan) — fired after the replan actually completes, not on the click itself, so it reads
  as the payoff rather than a premature promise.

## v2.74.1 — 2026-09-15

**Evening check-in: AI feedback capped at once per day**

Part of the same cost-review pass as v2.74.0. `Prog.jsx`'s evening check-in previously called the
AI-feedback endpoint on every single Submit click — resubmitting the same day (editing notes,
double-clicking, revisiting the tab) fired a fresh paid call each time, with the generated message
never even persisted (it only ever lived in local component state, so it was gone on reload
anyway).

- Today's `dailyLogs` entry now stores a `feedback` field. Submit checks it first: if today's log
  already has feedback, it's reused as-is and the AI call is skipped entirely — a real call only
  ever happens once per day, on the first check-in.
- Re-visiting Progress later the same day now also shows the earlier feedback immediately (seeded
  from the saved log), instead of the message disappearing until the next Submit.

## v2.74.0 — 2026-09-15

**College calendar lookups: shared cross-user cache — a real AI call only happens once per school**

⚠️ **Requires a manual database migration before this actually activates** — see below.

Direct follow-up to the cost conversation: rather than a one-time bulk pre-fetch of all ~2,348 US
schools (considered and rejected — academic calendars are per-term so a bulk fetch goes stale
almost immediately, and this app's real users only ever touch a handful of schools, so pre-paying
for the other ~2,340 that will never be looked up is the wrong trade), this is a lazy, per-school
shared cache: the first real lookup for a school pays for the AI call as before; every subsequent
lookup of that SAME school — by anyone, not just the original user — reads from the database
instead.

- New `public.college_calendar_cache` table (`supabase/schema.sql`) — shared across all users
  (not per-user data), keyed on `(school_name, after_date)`. RLS is deliberately permissive (any
  signed-in user can read or write any row) since this is just cached public academic-calendar
  data, not sensitive.
- A cached row is reused only while **its own `term_end` hasn't passed yet** — a deterministic
  staleness signal tied to the actual data, not a fixed TTL. A row with no `term_end` (an earlier
  lookup that couldn't find one) is never reused.
- `/api/college-calendar` now requires a signed-in caller (same Bearer-token pattern already used
  by `/api/sms/send`) so it can read/write the cache under RLS as that user. Every real caller
  (`Onboard.jsx`, `SchoolInfo.jsx`) already has a session by the time this route is ever hit, so
  this doesn't change real usage — it just closes a route that was previously open with no auth
  check at all.
- **Fails gracefully if the table doesn't exist yet** — verified live: with the migration not yet
  applied, a lookup still works end-to-end exactly as before (a clear, logged "table not found"
  error on the cache read/write, not a crash or a broken response). So this ships safely even
  before the database migration below is run; it just doesn't start saving money until it is.

**⚠️ To actually activate the caching:** open the Supabase project → SQL Editor → paste the
`college_calendar_cache` table + policies section from `supabase/schema.sql` (or the whole file —
safe to re-run) → Run.

**Validation:** 163 tests pass (no logic change to tested code). `npm run build` clean. Verified
live end-to-end pre-migration: "Find Upcoming Term" still correctly returns real data, with the
expected graceful cache-miss logged server-side.

## v2.73.8 — 2026-09-15

**School Info: every API call is now strictly by-demand — including picking from the autocomplete**

Follow-up to v2.73.6's "no auto-search on open" fix, per an explicit instruction to reduce this
screen's calls to only-by-demand, full stop. Picking a school from the autocomplete dropdown
(`onSelect`) was still auto-searching — that's now removed too.

- `handleSchoolSelected()` (fires when a suggestion is clicked) now only fills the School field and
  pre-fills the term type for an existing school — both free, local operations, no API call.
- **"Find Upcoming Term" is the one and only trigger for a real search anywhere on this screen**,
  for both a brand-new school and one already on record.

**Validation:** 163 tests pass (no logic change — this is UI wiring). `npm run build` clean.
Verified live via network-request inspection: typing "Stanford University" and clicking it from
the dropdown fires zero API calls; the "Find Upcoming Term" button still works correctly when
clicked (unchanged from v2.73.6).

## v2.73.7 — 2026-09-15

**Daily briefing: refreshes once per day at 8am local time — not on every rebuild**

Real cost concern, confirmed live: the cached daily brief only stayed valid if `briefVersion`
matched the app's exact `APP_VERSION` string — so every rebuild/redeploy (multiple times a day,
every commit) silently invalidated the cache and fired a real, paid `/api/ai` call on next load,
completely unrelated to whether the day's actual facts had changed. Reproduced directly: reloading
the page after a version bump changed the brief text with no other input changing at all.

- New `briefPeriodStart()` (`lib/time.js`) — the current "brief day," anchored to **8am local
  time**, not midnight and not the build version. Before 8am, still counts as yesterday's period
  (a student up late studying shouldn't get a fresh brief at 12:01am).
- Cache check is now `briefCache && briefPeriod===briefPeriodStart()` — the build version plays no
  role at all. `briefDate`/`briefVersion` fields replaced with `briefPeriod` everywhere they're
  reset (`History.jsx`, `Week.jsx`, `Acad.jsx`, `App.jsx`, `schema.js`'s defaults).
- A tab left open across the 8am boundary now actually regenerates without needing a manual
  reload — a 10-minute interval re-checks whether the period has rolled over.

**Validation:** 163 tests pass (4 new — `briefPeriodStart`, including the before/after-8am
boundary and a month-rollover case). `npm run build` clean. Verified live end-to-end: captured the
exact brief text, bumped `APP_VERSION` (a real rebuild), reloaded — confirmed via network-request
inspection that **zero** `/api/ai` calls fired and the brief text was byte-identical to before.

## v2.73.6 — 2026-09-15

**School Info: "Find Upcoming Term" is now a real button, not an automatic call on every open**

Real cost concern raised directly: the "Add term" default-school auto-search added in v2.73.3 was
firing a real, paid Anthropic API call **every single time the modal opened** for your current
school — even if you immediately closed it without saving.

- Opening "Add term" still pre-fills the School field with your current school (that part stays —
  most opens are adding the next term at the school you're already at) but no longer searches
  automatically.
- New **"Find Upcoming Term"** button, right under the School field — the lookup now only runs
  when actually clicked.
- Picking a school from the autocomplete dropdown is unchanged — that's a deliberate action, so it
  still searches right away, same as before.
- `anchorForSchool()` extracted as a shared helper (the "search for what comes after your latest
  known term" logic) so the automatic dropdown-select path and the new manual button use the exact
  same rule, not two copies that could drift apart.

**Validation:** 159 tests pass (no logic change to tested code — this is UI wiring). `npm run
build` clean. Verified live via network-request inspection: opening "Add term" now fires zero API
calls; clicking "Find Upcoming Term" correctly runs the search (confirmed: Winter 2027,
2027-01-04 – 2027-03-20).

## v2.73.5 — 2026-09-15

**Removed the onboarding tour**

Shipped in v2.74.0, removed the same day after real use turned up problems the design/mockup pass
and live verification didn't catch: the welcome screen's "Skip" looped back to "start tour"
instead of dismissing, the callout felt unengaging, the Next/Back buttons rendered outside the
card, and the spotlighted "Save & Replan" button read as visually enlarged. Rather than patch a
design that wasn't landing, reverted cleanly (`git revert`) back to the pre-tour state — the "?"
header icon, `TourOverlay` component, and the two `tourOfferedAt`/`tourCompletedAt` profile fields
are all gone. `lib/colleges.js`'s autocomplete fix and the college-calendar speed fix from v2.73.4
are unaffected (separate commit, not touched).

**Validation:** 159 tests pass (back to the pre-tour count). `npm run build` clean.

## v2.73.4 — 2026-09-15

**School autocomplete: partial acronym matched nothing; college calendar lookup was slow**

Two small, real fixes surfaced while investigating the "Add term" flow, shipped together since
both came out of the same session.

- **`searchColleges()` only matched a *complete* acronym** (`c.acronym===q`), not a prefix — so a
  partial acronym like "UCS" (a real, common in-progress search for any of UCSD/UCSB/UCSC/UCSF,
  each a 4-letter acronym) matched none of them; their full names don't literally contain "ucs" as
  a substring either, so they had no other tier to fall through to. Confirmed directly: typing
  "UCS" showed only "Tucson University" (a coincidental substring match), while the four real UC
  campuses were invisible until the complete 4-letter acronym was typed. Now `startsWith`, not
  `===` — "UCS" correctly shows all four campuses, ranked above the unrelated substring match.
- **College calendar lookup took >20 seconds** — real reported complaint. `max_uses` on the
  web-search tool dropped from 5 to 2 (`app/api/college-calendar/route.js`). Verified empirically,
  not guessed: with the query-first prompt (v2.73.1), a real answer typically resolves in exactly
  2 searches, and the model was just spending extra rounds re-confirming rather than stopping once
  it already had an answer. Capped runs (2 searches) returned identical dates/holidays/source to
  uncapped runs (up to 4 searches) on the same hardest case already tested (UCSD's afterDate
  lookup) — ~11s vs. ~21s, no accuracy loss observed. Worst-case degradation for a genuinely
  harder-to-find school is more `null` fields (the prompt already says to use null rather than
  guess), not wrong data.

**Validation:** 159 tests pass (8 new — `generateAcronym`/`searchColleges`, including the exact
reported "UCS" scenario). `npm run build` clean.

## v2.73.3 — 2026-09-15

**"Add term" defaults to your current school and auto-searches the real next term, holidays stored**

Follow-up to the reset fix, refined per direct feedback ("not exactly"): a blank form wasn't what
was wanted. Most "Add term" clicks are for the NEXT term at the school you're already at, so:

- **School field now defaults to your current school** and immediately runs the lookup, as if you
  had just selected it — instead of opening blank and waiting for you to re-select a school you're
  already enrolled at.
- **The lookup itself now finds the real next term, not a re-fetch of the one you already have.**
  New optional `afterDate` on `/api/college-calendar` (and `fetchCollegeCalendar()`) anchors the
  search on "the term after this end date" instead of "current or upcoming" — same query-first
  principle as the earlier UCSD accuracy fix, just anchored to a specific date. Verified live and
  via direct API call: UCSD's current term ends 2026-11-06 in this account → correctly returned
  Winter 2027 (2027-01-04 – 2027-03-20), not a repeat of Fall 2026.
- **Holidays now get stored on the term record** (`term.holidays`, plus `source`/`fetchedAt`) —
  fetched alongside the dates but never rendered in the modal, per explicit instruction ("no need
  to display"). Confirmed persisted through a full page reload, not just optimistic local state.
- The new-school path (a school not yet in the account) is unchanged — still "current or upcoming",
  since there's no prior term to anchor after.

**Validation:** 151 tests pass (no logic change to tested code). `npm run build` clean. Verified
live end-to-end: opened "Add term" → pre-filled with current school → auto-ran the search →
correct next term appeared → saved → confirmed the new term persisted after a full reload → then
deleted it (test data cleanup) via the existing delete feature, which also re-confirmed that still
works correctly.

## v2.73.2 — 2026-09-15

**School Info: "Add term" modal kept stale state after closing without saving**

Closing the modal (X button or clicking the backdrop) only hid it — the school name, term name,
type, dates, and lookup state all stayed in memory. Reopening "Add term" right after came back
with the last attempt's data still sitting there instead of a blank form — real reported bug,
found right after the UCSD/UCSB lookup-trigger investigation (typed UCSB, closed without saving,
reopened, still showed UCSB's result).

- New `closeAddTerm()` is now the one place that both hides the modal and resets every field back
  to its default — used by the X button, the backdrop click, AND a successful save (which
  previously had its own separate, slightly different reset inline). One path instead of two that
  could drift apart.
- Confirmed the school-search trigger itself was already correct and untouched by this fix:
  typing in the School field only updates the text (`onChange`); the lookup only fires on an
  actual autocomplete selection (`onSelect`) — never on every keystroke.

**Validation:** 151 tests pass (no logic change — this is component-local UI state). `npm run
build` clean. Verified live: typed a school, closed via X without saving, reopened "Add term" —
confirmed blank (empty school field, default Quarter type, empty dates) instead of the stale
previous entry.

## v2.73.1 — 2026-09-15

**College calendar lookup: real bug fixed (UCSD result was inconsistent/wrong), address dropped**

Backlog item #4's QA pass (real API calls, not just "does it return JSON") found a genuine bug: the
prompt's original multi-field-up-front phrasing gave UCSD specifically an inconsistent/wrong
result across repeated runs — once silently `null` for term end + holidays, once confidently
pulling term dates from **UCSD Extended Studies** (a different calendar than the regular
undergraduate one) instead of the real academic calendar.

- **Root cause:** UCSD has several official `*.ucsd.edu` calendars (main campus, Extension/
  Extended Studies, Summer Session). The old prompt's "prefer the school's own `.edu` domain"
  instruction is satisfied by all of them, so it gave the model no way to pick the authoritative
  one before it had even searched anything.
- **Fix:** the prompt now leads with a single, simple, human-style search query ("what is the
  current or upcoming term at X?") instead of front-loading every field the app needs — closer to
  how a person would actually search, and it lands on the right page. Verified with 3 repeated
  UCSD runs through the real endpoint (not a prototype) — consistent correct end date
  (2026-12-12, matches UCSD's real Fall 2026 finals) and consistent correct source
  (`blink.ucsd.edu`, not Extended Studies) every time, versus inconsistent/wrong before. Re-ran
  Harvard and Stanford afterward too, to confirm the change didn't regress schools that already
  worked — both came back correct (Stanford: real "Autumn 2026" naming, quarter system).
  Considered swapping to OpenAI's web-search as an alternative fix; concluded it wouldn't actually
  address the root cause (any search backend hits the same multi-calendar ambiguity) and would
  add a second AI provider for no clear win, contrary to the project's own standing preference for
  deterministic logic over more AI where the two could achieve the same result.
- **Address dropped from the lookup entirely** — per explicit product decision, it wasn't actually
  needed. `applyCollegeCalendarResult()` no longer reads `result.address`; `schoolAddress` remains
  a real, separately-editable profile field, just no longer auto-fetched by this endpoint. Updated
  the two UI strings (`Onboard.jsx`) that described the lookup as auto-filling an address.

**Validation:** 151 tests pass (no logic change to tested code — the prompt/address change is in
the API route and a thin `lib/colleges.js` function with no existing test file). `npm run build`
clean. Verified live end-to-end through the real UI (Add term → Stanford University): correct
"Autumn 2026" naming, quarter system, plausible dates, no address field anywhere.

## v2.73.0 — 2026-09-15

**School Info: delete an "Upcoming" term**

There was previously no way to remove a term at all — each term row only had an Edit (pencil)
button. Added a delete option, scoped deliberately narrow:

- **Only "Upcoming" terms are deletable** — never "Current" (actively driving the planner) or
  "Completed" (real history). The trash icon only renders next to an upcoming term's row.
- **Blocked (not cascaded) when courses are already attached.** A student can prep courses against
  a future term before it starts (Academics' term selector allows it), so silently deleting those
  along with the term would be a much bigger, easy-to-miss loss than the term itself — the toast
  names exactly how many courses are in the way instead.
- Deleting a clear (no-courses) upcoming term goes through the existing `useConfirm()` dialog
  (same pattern already used for the term-date-overlap warning in this file), naming the exact
  term and dates before removal — matches this component's own established confirm-before-destroy
  convention, unlike the app's usual delete-with-no-confirm pattern for simpler list items.
- New `canDeleteTerm(term, courses)` (`lib/data/terms.js`) holds the actual rule, kept out of the
  component so it's unit-testable without mocking `confirm`/`toast2` — 7 new tests covering each
  status, singular/plural wording, and a term with no attached courses.

**Validation:** 151 tests pass (7 new). `npm run build` clean. Verified live: delete button shows
only on the upcoming term, confirm dialog names the exact term/dates, Cancel is a safe no-op.

## v2.72.3 — 2026-09-14

**Focus Time mobile: time-range text sat a few px lower than the class name (final alignment pass)**

- Root cause: `.ft-actions`/`.ft-time` zeroed `padding-bottom` below 640px (so they'd stop
  reaching into line 2's row, from v2.72.2) but kept `padding-top:12px`. The course-name cell
  beside them has no padding at all, so `align-items:center` centers it on the cell's true
  geometric center — but the action/time cells' now-asymmetric padding (12px top, 0 bottom) shifted
  *their* centered content a few px below that same center. `padding-top` now also zeroes out
  below 640px, matching the course-name cell's zero-padding box exactly.
- Confirmed via `getBoundingClientRect()`: course name, play button, and time-range text all
  center at the identical y (was off by ~5-6px before). Desktop unaffected (re-verified —
  untouched above 640px).

## v2.72.2 — 2026-09-14

**Focus Time mobile: play button and time range truly centered on the class-name line; assignment gets the full row width**

Follow-up to v2.72.1's top-align fix — still not quite right ("the text is not aligned... center
the play icon with the center of the top line... make sure we have enough space to display the
2nd line in full left to right").

- **Restructured each task from one grid row into two.** Previously the course name and assignment
  text were stacked inside a single grid cell (column 2), with the play button/duration (column 3)
  and time range (column 4) spanning that cell's full 2-line height. Each task now spans two real
  grid rows: line 1 (course name + play button/duration + time range) and line 2 (assignment,
  full width). Both changes fall out of this directly:
  - **Play button and time range are now genuinely centered against just the course-name line**
    (not the row's full 2-line height) below 640px, since they now only span line 1's grid row
    there — `grid-row-end` switches from `span 2` to `span 1` via a `--ft-span` custom property,
    conditional per breakpoint (`.ft-actions`/`.ft-time` in `app/globals.css`). Course name uses
    the same `alignSelf:"stretch"` + internal flex-centering as those two cells, so all three sit
    at the exact same vertical center regardless of line 1's actual computed height — confirmed
    via `getBoundingClientRect()` (all three centered at the same y).
  - **The assignment line spans the full row width on mobile** (columns 2 through 4 — the width
    the now line-1-only action/time cells free up there), instead of being confined to column 2's
    narrow share — confirmed via measurement: full row width (54px→565px), versus column 2 alone
    (54px→333px) before.
- **Desktop is pixel-identical to before** (re-verified via `getBoundingClientRect()`) — the
  action/time cells still span both rows there (`grid-row-end:span 2`, the default), so they read
  centered across the full 2-line block exactly as already shipped/verified, and the assignment
  line stays confined to the course-name column only (`grid-column-end:span 1`, the default).
- The Focus Time row divider (fixed in v2.72.0) also stays intact at both breakpoints — every
  cell still ends up `alignSelf:"stretch"`-ed to the exact height/rows it's meant to span, so its
  border-bottom lands at the task's true boundary.

## v2.72.1 — 2026-09-14

**Focus Time mobile: play button + time were dead-centered across both text lines, crowding the assignment line**

- On narrow screens, the Focus Time row's action column (play button + duration) and time-range
  column were vertically centered against the row's full height — the same height as the row's two
  text lines (course name + assignment). A button centered across both lines visually sits on top
  of the boundary between them, crowding the second (assignment) line — real reported bug on
  iPhone: "the play icon ... is blocking the display of the assignment."
- New `.ft-actions`/`.ft-time` classes (`app/globals.css`) keep both columns centered on desktop
  (unchanged, already verified) but switch to top-aligned below 640px, so they line up with the
  course-name line instead, leaving the full row height under them free for the assignment line.

## v2.72.0 — 2026-09-14

**Five tuneups: dropdown sizing/arrow, replan-summary contrast, Replan tooltip clipping, Focus Time divider**

- **Focus/Break length dropdowns were ~5x wider than needed.** They inherited the global
  `select{width:100%}` rule, stretching to their full grid-column width for a two-word label like
  "45 min". New `.select-compact` class (`app/globals.css`) caps them at 110–150px, applied in
  both `components/Sett.jsx` and `components/Onboard.jsx`.
- **Dropdown arrow sat too close to the field's own right edge.** Native select arrows aren't
  independently positionable, so `.select-compact` also switches to `appearance:none` plus an
  inline SVG chevron pinned at a fixed 10px inset.
- **Replan summary toast: amber text on an amber-tinted dark background read poorly.** The
  background stays severity-tinted (unchanged), but the text is now near-white (`--t1`) with the
  severity color kept only as a left accent bar and bullet-dot color — same pattern
  `.card-warn`/`.card-critical` already use elsewhere. `lines` now render as a real bulleted list
  (`•`, not a middle-dot). The toast's `top` offset also moved down — 92px→116px desktop,
  58px→78px mobile — so it no longer sits flush against the header.
- **"Save & Replan" button's tooltip rendered clipped above the viewport.** It's the first thing
  on the Preferences page, so the tooltip's default above-trigger placement had nowhere to render.
  Added `tt-below tt-right` (an existing compound tooltip variant) so it opens downward, anchored
  to the button's right edge.
- **Focus Time row divider was a jagged 3-segment line, not one straight line.** Each of the 4
  grid cells in a row had its own `border-bottom`, but only the task-column cell was actually the
  row's full height — the button/duration and time-range cells were shorter (centered via
  `alignItems:"center"` on the shared grid) so their own border-bottom landed higher than the
  task column's. Fixed by giving every cell `alignSelf:"stretch"`, so all 4 cells in a row now
  share the same box height and their borders land at the same y.

## v2.71.0 — 2026-09-14

**Study Preferences: unified session length (removed the duplicate picker), energy peak by real time, dropdowns for real resolution**

Preferences had two separate "how long do you study" pickers that meant the same thing:
"Study session length" (`sessionPreset` — 3 fixed choices, each a bundled study+break split, fed
only to the planner) and "Focus block length" + "Break length" (`focusMins`/`breakMins` — fed
only to the Pomodoro timer). One concept, two places to set it, and the planner's own choice was
invisible unless you knew to look for the separate picker.

- **`sessionPreset` removed entirely.** `focusMins`/`breakMins` (the same pair the timer already
  used) now drive the planner too — `presetLenFor()` (`lib/planner/schedule.js`, replaces the old
  `SESSION_PRESETS` lookup) sums them and rounds to the nearest 15 minutes, so placed study blocks
  still land on the scheduling grid even though the dropdowns below offer finer-than-15
  resolution. One preference, one place, both consumers.
- **Dropdowns instead of button rows**, with real resolution: focus length now offers
  15–90 minutes in 5-minute steps (was 5 fixed choices), break length 5–30 minutes (was 3). New
  shared `FOCUS_MIN_OPTIONS`/`BREAK_MIN_OPTIONS` (`lib/constants.js`) so Sett.jsx and Onboard.jsx
  offer the identical choices.
- **Energy peak is now a real time** (`energyPeakTime`, an actual `<input type="time">`),
  replacing the old morning/afternoon/evening 3-button bucket. `windowOrderFor()` classifies that
  time into the same three broad scheduling windows internally, so the planner still prioritizes
  whichever part of the day the student is sharpest — just picked with real precision instead of
  a coarse guess at which third of the day "counts".
- **Migration for existing accounts:** an existing profile only has the old `energyPeak` bucket
  on disk, not `energyPeakTime` — without carrying it forward, the new time picker would render
  empty and silently reset everyone's preference to the default. `migrate()` (`lib/data/store.js`)
  now converts each old bucket to a representative time (morning→09:00, afternoon→14:00,
  evening→19:00) the first time an existing account loads.

**Validation:** 144 tests pass (23 new — `presetLenFor`/`windowOrderFor` in a new
`lib/planner/schedule.test.js`, plus the `migrate()` carry-forward in a new
`lib/data/store.test.js`; the three existing planner test suites' PROFILE fixtures were updated to
the new fields with equivalent values and still pass unchanged, confirming no behavior
regression). `npm run build` clean. Verified live end-to-end in a real browser: the old duplicate
picker is gone, the dropdowns/time-input render and save correctly, an existing profile's old
"afternoon" bucket correctly carried forward to "02:00 PM", and — the real test — triggered an
actual "Save & Replan" and watched the planner run successfully to completion on the new fields
with no error.

## v2.70.0 — 2026-09-14

**Syllabus upload: probable-duplicate detection & review, instead of a silent (and leaky) auto-skip**

Acad.jsx already had a dedup check, but it was exact-match only (`normalized title === normalized
title` and `dueDate === dueDate` for assignments; date-only for exams) and completely silent — no
visibility, no choice, and real duplicates slipped through whenever the AI's extraction wording
drifted even slightly between two separate parses of the same PDF ("Problem Set 5" vs "Problem Set
#5", a date reformatted a day off), which is exactly the scenario a re-upload hits.

- New `findProbableDuplicate()` (`lib/syllabus.js`, 13 unit tests) — a looser, still fully
  deterministic match: same course, and either (a) the same title once punctuation/formatting is
  stripped, with a due date within a few days, or (b) the exact same date with one title clearly
  containing the other. Deliberately conservative — no date-only matching (that's how the old exam
  dedup could have conflated two unrelated exams landing on the same day) — a false flag costs one
  extra click to dismiss; a missed one is the bug being fixed.
- **`ExtractionVerifyModal`** (the existing "review before saving" screen) now flags every probable
  duplicate inline, highlighted, with the matched existing item shown and a real per-item choice:
  **Keep recent (recommended)** — replace the existing item in place (same id, so its
  status/completedAt survive) with the freshly-parsed version; **Keep both** — add it anyway; or
  **Skip this one** — don't add it. Nothing is decided silently anymore.
- `finalizeSync` (Acad.jsx) now honors that choice — a "replace" carries the existing item's id
  through as `_replaceId` and updates it in place instead of adding a second entry. `SyncResultModal`
  gained a "updated (kept the recent version)" tile alongside the existing added/skipped ones.

**Validation:** 114 tests pass (13 new for `findProbableDuplicate`, covering exact/fuzzy-title/
date-drift/cross-course/missing-field cases). `npm run build` clean. Verified the Update Syllabus
page still loads and renders cleanly with the new props wired through; the actual upload → AI
extraction → duplicate-flagging flow was NOT verified end-to-end with a real PDF in this session
(no sample syllabus file available here, and it would cost a real Opus-tier API call) — the
matching logic itself is thoroughly unit-tested, but a real-file pass is worth doing before
trusting this fully in production.

## v2.69.1 — 2026-09-14

**Focus Time: course badge simplified to plain text, color swapped to the task line**

- Dropped the pill/background treatment on the course name — plain bright text now
  (`var(--t1)`/white, bold), no background chip.
- Swapped which line carries the course color: course name is now white, the task/assignment
  line below it is colored with the course's own color instead (`course.color.border`/`.text` —
  the same value used for course dot indicators elsewhere in the app, already tuned as a readable
  text color, so it's bright enough on its own without needing a background to read clearly).

**Validation:** 119 tests pass (no logic changed, display-only). `npm run build` clean. Verified
live — course name reads as plain white text, task line reads clearly in the course's color.

## v2.69.0 — 2026-09-14

**Focus Time: deduped course/task text, course badge, and a real fix for a self-inflicted misalignment bug**

- **Deduped course name from the task label.** Every task label the planner writes is built as
  "&lt;courseName&gt; &lt;rest&gt;" (schedule.js — "MATH 180A exam prep (4d left)", etc.), and this
  row already shows the course name on its own line — same information twice, wasting the width
  the row's ellipsis truncation needs. New `dedupeCourseFromTaskLabel()` (`lib/taskLabel.js`,
  10 unit tests against the actual label shapes schedule.js produces) strips the leading
  course-name prefix for display only — the stored label itself is untouched, since other
  surfaces (Calendar's day agenda, PlanDrawer) show the task without a separate course line and
  still need it whole.
- Course name is now a real badge/chip (course color as background tint + text, same pattern
  already used for every other badge in this app), placed **above** the task line since it's the
  category — and it's the only place this row names the course now, so it needed to be more
  visible than the plain muted-gray text it replaced.
- **Real regression found and fixed, not just patched again:** rebuilding the row as CSS grid
  (v2.68.1) fixed the overflow bug but reintroduced a different one — each row was its own
  independent grid, so the "auto"-sized button/time columns were computed per-row rather than
  synced across rows, and the play button visibly drifted left/right depending on that row's own
  duration text ("30m" vs "1h 30m"). Fixed properly: the whole Focus Time list is now ONE grid
  (`components/Today.jsx`), with each row contributing its 4 cells directly via `Fragment`
  instead of nesting its own grid — column widths are computed once, across every row, the way
  CSS grid alignment is supposed to work.

**Validation:** 119 tests pass (10 new for the dedup logic). `npm run build` clean. Verified live
and measured, not eyeballed: `getBoundingClientRect()` across all 6 Focus Time rows (mixed "1h"
and "30m" durations) shows every play button/checkmark at the exact same `left: 241px`.

## v2.68.1 — 2026-09-14

**Focus Time row rebuilt as CSS grid — v2.68.0's flex patch made it worse, not better**

Real report from live iPhone testing: the previous fix (a responsive `flex-basis` on the time
column) made the row shift right and the task column stop shrinking, pushing the play button and
time range further off-screen than before. The underlying problem wasn't any one element's width —
it was the row's whole structure: 3 nested flex levels (row → a "right" group → a button/time
pair), where *any* level missing an explicit `min-width:0` silently re-imposes a content-based
floor on everything above it. Patching individual widths kept moving the bug around instead of
removing it.

Rebuilt the row as CSS grid instead: `grid-template-columns: 4px minmax(0,1fr) auto auto`
(stripe / task+course / button+duration / time). Only the task column is elastic — genuinely
reaches 0 via `minmax(0,1fr)`, with the task and course text now truncating via ellipsis
(`overflow:hidden; text-overflow:ellipsis; white-space:nowrap`) instead of wrapping or forcing the
row wider. The button+duration group and the time range are both `auto` — sized to their own
content, never compressed, so the time genuinely stays locked to the right edge at a constant,
readable size, which is what was asked for. This sidesteps the whole class of nested-flex
min-width bug rather than patching around it again.

**Validation:** 109 tests pass. `npm run build` clean. Verified live and *measured*, not just
eyeballed: at a 500px viewport, all 6 Focus Time rows (mix of short and long task/course text,
including the running-timer state) have their right edge at 459px — comfortably inside the
viewport, confirmed via `getBoundingClientRect()`, not a screenshot guess. Task text now visibly
truncates with an ellipsis when it's the long "MATH 180A exam prep (4d left)" label.

## v2.68.0 — 2026-09-14

**Two real bugs found from live iPhone testing**

- **Focus Time row overflow.** The time-range column ("3:00pm – 4:00pm") was `flex:0 0 170px`
  unconditionally, and its parent had no `min-width:0` — the same root-cause pattern already
  found and fixed several times this session (a flex item's default `min-width:auto` blocks
  shrinking below its content size even with `flex-shrink` set). On a real iPhone this popped the
  time column out past the right edge. Fixed with a responsive `.focustime-timecol` class: fixed
  170px on desktop (unchanged, matches the reference image it was built from), shrinkable
  (`flex:0 1 120px; min-width:0`) below 480px, plus `min-width:0` added to its parent container.
- **iOS Safari zoom-on-focus (the Bug Report modal bug).** Real root cause, not a rendering
  quirk: Safari on iOS auto-zooms the whole page when a focused input/select/textarea has
  `font-size` under 16px, and doesn't reliably reset that zoom when the field blurs or its modal
  closes. The app-wide default for every input/select/textarea was 15px, and the Bug Report
  modal's textarea explicitly overrode it to 14px *and* has `autoFocus` — guaranteeing the zoom
  fired every single time that modal opened. That's what "modal looks a bit large, then the whole
  UI stays enlarged and overflowing after Cancel" actually was. Fixed the global default to 16px
  and removed the modal's smaller override. Several other inputs across the app (compact table
  cells in Academics, time pickers in Settings/Onboarding, a few modal fields) have their own
  sub-16px overrides and could still trigger this on their own field — flagged as a follow-up
  sweep, not fixed blindly here since several are deliberately compact, already-tuned table cells.

**Validation:** 109 tests pass (no logic changed). `npm run build` clean. Verified the
Focus Time fix's compiled CSS directly (this environment's browser-automation tooling has a
~500px floor and can't reach true iPhone widths to screenshot it there); verified the textarea's
computed `font-size` is 16px live, and that Cancel returns cleanly with no regression on desktop
Chrome (Safari's zoom-on-focus specifically can't be reproduced outside real Safari, but the root
cause is a well-documented, standard browser behavior and both fixes address it directly).

## v2.67.0 — 2026-09-14

**Today's "View day calendar" modal now matches the Calendar tab's day view**

CLAUDE.md's backlog had flagged this explicitly: "Day-view calendar (Today's 'View day calendar'
modal) — functional but its visual design is an explicitly open, parked question, not finalized."
It was also a genuine inconsistency — Today's modal used `Timeline` (an hourly 3-column grid),
while the Calendar tab's month-view day-detail pane (redesigned earlier this session) used a
completely different chronological colored-list style. Same day, two different looks depending on
which surface you opened it from.

- Extracted the Calendar tab's day-list rendering into a new shared component,
  `components/shared/DayAgenda.jsx` — colored left-border rows by activity type, chronological,
  sleep filtered out, always shows the day's real fixed schedule (classes/meals/gym) regardless of
  AI-planning status with its own "not planned yet" banner when relevant.
- Both the Calendar tab's month-view day-detail pane and Today's day-calendar modal now render
  through this one component — a day looks identical no matter which one you open. Today's modal
  keeps its own "Plan now" action button (specific to that surface); the Calendar tab's icon
  toolbar (Add/diagnostics/Replan) stays where it was, unchanged.
- Left Week.jsx's OLDER single-day drill-down (`mode==="day"`, reached by tapping a cell in the
  full desktop week grid) on `Timeline` — untouched, out of scope for this request, its own
  separate flow.
- Net effect on Week.jsx: removed ~30 lines of now-duplicate inline rendering, replaced with a
  five-word one-liner using the shared component.

**Validation:** 109 tests pass (no logic changed, pure extraction + swap). `npm run build` clean.
Verified live: opened Today's modal and the Calendar tab's day view side by side for the same
date — identical rows, identical order, identical styling.

## v2.66.0 — 2026-09-14

**Progress bars always stacked and genuinely aligned; due-today/tomorrow made deterministic**

- Dropped the side-by-side desktop layout entirely — the two bars now always stack exactly above
  each other, at any width.
- **Real alignment bug fixed, not just repositioned:** the bonus badge only ever existed on the
  On-time row, so its presence alone pushed that row's percentage and bar to the right of Study
  Pace's — no amount of nudging pixels fixes that while the badge is only sometimes there. Fixed
  with a fixed-width `.pace-bonus-slot`, rendered (empty) on both rows regardless of whether a
  bonus exists, so the bar always starts at the identical x. The badge sits inside that slot,
  pulled toward the label with a small negative margin.
- `.pace-pct` font shrunk 19px→15px (frees width for the wider "Assignment on-time" label,
  and the bar — not the number — is the thing actually worth reading at a glance here).
- **Due today/tomorrow is now deterministic**, not left to the AI's discretion. "Top Things To
  Keep In Mind" previously depended entirely on the AI happening to mention a same-day or
  next-day deadline — a real reliability gap for content this critical, and one this app has an
  explicit standing preference against (deterministic over AI wherever the two could achieve the
  same result). A new always-first line in that section — computed the same way the proven
  `dueToday` filter already works, just for `du(dueDate)===1` too — shows "Due today: …" / "Due
  tomorrow: …" whenever relevant, independent of whether the AI briefing has loaded or even
  succeeded.

**Validation:** 109 tests pass (no logic change to anything previously tested). `npm run build`
clean. Verified live: bar alignment confirmed pixel-exact via zoomed screenshot; the due-soon
line correctly stays hidden in the current sample data (nothing due today/tomorrow in it).

## v2.65.1 — 2026-09-14

**Progress card: bonus badge moved left, "On-time" renamed to "Assignment on-time"**

- Bonus badge now sits to the left of the percentage (`+2  100%`) instead of the right.
- Label renamed "On-time" → "Assignment on-time"; `.pace-metric-label` widened 86px→150px to fit
  it (shared by both rows, so "Study Pace" just has extra breathing room after it).
- **Known tradeoff, not a bug:** the wider label + bonus badge means the two metric rows no
  longer fit side by side at the card's max width (960px) — `flex-wrap` gracefully falls back to
  stacked (same as mobile) instead of overflowing, but the "both on one line at desktop width"
  layout from v2.64.0 is effectively unreachable now with the bar staying at its requested
  240px. Flagged for Avishai rather than silently trading away either the wider label or the
  longer bar to preserve it.

**Validation:** 109 tests pass (no logic changed, CSS/JSX ordering only), `npm run build` clean,
verified live at both desktop and phone widths.

## v2.65.0 — 2026-09-14

**Two real bugs found from live testing: the bonus badge never showing, "not yet" on items that were actually planned**

- **Bonus badge fix.** `dueToDate` (Today.jsx) only ever included assignments whose due date had
  *already passed* — so an assignment finished early, with its due date still in the future, was
  excluded from the On-time calculation entirely and could never show a bonus. Now included the
  moment it's marked done, regardless of whether the due date has arrived: `dueDate<=today OR
  status==="done"`. Verified live — marked "Essay 1" (due in 4 days) done and watched the badge
  render "+2" immediately.
- **Deadline Awareness "planned"/"not yet" fix.** The tag was checking only *today's* scheduled
  blocks, matched by *course* rather than the specific item — so an item genuinely scheduled for
  tomorrow (or any day but today) showed "not yet" even though it truly was planned, and
  exam-prep/due-next-week rows were hardcoded `planned:false` regardless of the real plan. New
  `isItemScheduled()` (`lib/calendar/weeks.js`) checks the planner's own `source:{type,id}` tag
  on every block against the specific item, on any day, anywhere in the plan — a precise "is this
  exact thing scheduled" check instead of a same-day/same-course proxy for it. Verified live:
  "Problem Set 5" and "Reading Quiz 4" (11d/14d out — previously hardcoded to "not yet" no matter
  what) now correctly show "✓ planned".
- **Back to Today** is now a plain circular "‹" chevron icon button, matching the header's other
  icon buttons, instead of a text link.

**Validation:** 109 tests pass (5 new for `isItemScheduled`, covering the exact reported scenario
— an item scheduled for tomorrow, not today). `npm run build` clean. Verified live end-to-end:
watched the bonus badge appear after marking an early item done, and watched two previously
always-"not yet" rows correctly flip to "✓ planned".

## v2.64.1 — 2026-09-14

**On-time metric: capped at 100%, early bonus split into its own badge**

Follow-up on v2.64.0's formula — "112% submitted on time" reads as confusing on its own, even
though the underlying score legitimately exceeds 100. Split instead of changed: the raw
(possibly >100) average still exists, `splitOnTimeScore()` (`lib/metrics.js`) just divides it
into a normal capped 0-100% reading (drives the number, bar, and color, same as before) and
whatever was earned above that, shown as a small separate green "+N" badge right next to the
percentage. Nothing about the underlying scoring changed, only how it's presented.

**Validation:** 104 tests pass (4 new for the split — including a reconstruction check,
`pct + bonus === raw`, across several raw values). `npm run build` clean. Verified live that
the no-bonus case (100%, nothing above it) renders identically to before — no regression when
there's nothing to show.

## v2.64.0 — 2026-09-14

**Nav: easy back-to-Today, hamburger closes on outside click; Assignments On-time gets a real formula**

- **Back to Today**: the check-in shortcut on Today's header (the amber checkbox icon) now takes
  you to Progress with a small "← Back to Today" link at the top — appears only when you actually
  arrived via that shortcut, and is cleared on any normal nav click so it never lingers once
  you've navigated elsewhere on purpose. Tracked via a new `progBackTo` state in App.jsx and a
  `go(id)` wrapper that every normal nav handler (nav-row, hamburger dropdown, the
  missing-due-dates badge) now goes through instead of calling `setTab` directly.
- **Hamburger menu now closes on outside click**, not just on picking an option — same invisible
  full-screen click-catcher pattern already used for Today's health-dot popover, just applied
  here too. Real, reported bug: previously the only way to dismiss it was choosing a tab.
- **Assignments On-time**, reformulated as a continuous per-item score instead of a binary
  on-time/late count — a student can now score above 100% for submitting early:
  - On time = 100%. Early = bonus, `+5%` per day early, capped at 10 days (max +50%). Late = the
    same shrinking credit, `-10%` per day late, floored at 0 — so a late submission gets partial
    credit back rather than zero. Still-missing items score the same shrinking-credit formula
    live against *today* (so the score keeps dropping the longer it sits undone), then locks in
    wherever it landed the moment it's actually marked done.
  - Extracted to `lib/metrics.js` (`assignmentOnTimeScore`) specifically so this real formula has
    real unit tests, rather than living untested inside the Today.jsx component — same
    "pure logic separated from the component" convention the planner already follows.
  - Tunable constants (`ONTIME_EARLY_BONUS_PER_DAY`, `ONTIME_EARLY_BONUS_CAP_DAYS`,
    `ONTIME_LATE_PENALTY_PER_DAY`) centralized at the top of that module.

**Validation:** 100 tests pass (6 new for the scoring formula, including a monotonicity check —
later can never score better than earlier). `npm run build` clean. Verified live end-to-end: the
check-in shortcut → Back to Today link → return; hamburger open → click elsewhere → closes
without navigating; confirmed the back link does NOT appear when Progress is reached normally.

## v2.63.0 — 2026-09-14

**Progress tab: Catch Up — a forgotten day no longer permanently deflates Study Pace**

Real gap found while reviewing the Progress card: `saveBlockToDay` has a hard "history is
read-only" guard (`if(dateStr<iso())return;`), added earlier to stop the planner's regeneration
path from clobbering history. Correct for that, but it had no other door — a study session
someone forgot to mark done on the day it happened could never be corrected, and since Study
Pace sums every block's live `completed` flag from the term start to today, that miss was baked
into the denominator forever with no way back.

- New "Catch Up" card on the Progress tab, right under Evening Check-in, using the exact same
  list/checkbox/submit pattern — appears only when there's something to catch up on (hidden
  entirely otherwise, same as every other conditional section in this app).
- Lists the last 3 days' (`CATCHUP_DAYS`) still-unmarked study sessions, grouped by day, newest
  first. Check off what actually happened, submit, done — Study Pace picks it up immediately
  since it just reads the same `completed` flags.
- **Deliberately a separate, narrower write path** (`catchUpMarkComplete` in
  `lib/calendar/weeks.js`), not a loosening of `saveBlockToDay`'s guard — that guard also
  protects the planner's regeneration path, and loosening it broadly would risk reopening the
  exact bug it was built to stop. This one only ever flips a `completed` flag on an existing
  block the user is explicitly confirming happened, within its own explicit bound.
- **Real bug avoided, not just theoretical:** catching up several sessions has to be ONE `upd()`
  call building the complete result, not a loop of one call per item — a loop would have each
  call compute its patch from the same stale `data` closure, and `upd()`'s merge in App.jsx is
  shallow (`{...prev,...p}`), so only the *last* item's patch would actually stick, silently
  losing the rest. Caught this before it shipped and wrote a regression test for it specifically.
- Assignment catch-up needed no changes — marking an assignment done was already date-unguarded
  (only the study-block path had the read-only wall), so that half of the picture already worked.

**Validation:** 11 new tests in `lib/calendar/weeks.test.js` (94 total, all pass) — including the
multi-item-single-pass regression above, window-boundary edges, and completedAt never getting
overwritten once set. `npm run build` clean. Verified live end-to-end in a real browser: checked
2 forgotten sessions, submitted, watched them disappear from the list, then watched Study Pace on
the Today tab move from 8% to 11%.

## v2.62.2 — 2026-09-14

**Today tab: fixed a real overflow bug at true iPhone widths, not just the widest phone tested**

All prior mobile testing this session was done in a desktop browser resized down (≥500px) —
narrower than every real iPhone in the current lineup (iPhone 17 / 17 Pro: 402×874 CSS px;
17 Pro Max: 440×956; even the smallest current model is ~390px). That gap hid a real bug:

- The Progress bar's `flex:0 0 240px` (added to stop it silently shrinking to a stub on desktop —
  see v2.62.1) was unconditional, so it also applied below 768px — 240px alone is more than half
  of an actual iPhone's width, before the label/percentage next to it are even counted. Now fluid
  on mobile (`flex:1`, 60–240px) and only switches to the fixed 240px at the same 768px tier the
  two metrics go side-by-side at, where there's actually room for it.
- Audited the rest of the Today tab for the same root-cause bug (a `flex:1` content column
  missing `min-width:0`, so a long string it holds can't actually shrink and forces its row to
  overflow instead) and found two more real instances: Today's Classes' course-name/room column
  (room names like "Room ERC Administration Bldg 115" are genuinely long) and Today's Other
  Activities' gym/chore/event column. Both fixed the same way.
- Focus Time's fixed 170px time-range column was deliberately left alone — it's intentional
  (documented in-code: keeps times aligned across rows) and already degrades safely, since the
  task-text column next to it has `min-width:0` and absorbs any real space pressure first.

**Validation:** 83 tests pass, `npm run build` clean. Verified live in a real browser at every
width the tooling could reach (desktop down to ~500px) — the automation environment has a ~500px
floor and couldn't reach a true 402px iPhone viewport directly, so the actual iPhone-width fix
is verified by CSS math + the same root-cause pattern already fixed and confirmed working
elsewhere this session, not a live screenshot at 402px. Worth a real-device check.

## v2.62.1 — 2026-09-14

**Today tab: Progress card layout/alignment polish pass**

Follow-up fixes on the v2.62.0 Progress card, from live iteration against a real browser:

- Headline is a fixed light-blue (`var(--blue)`) at all times instead of being color-banded
  red/amber/green — red text read as a warning/error, undercutting a line meant to encourage even
  on a rough day. Runner sits right after the headline text with a small gap instead of being
  pushed to the card's far right corner (dropped `justify-content: space-between`).
- Desktop (≥768px, the same tier the top nav already switches on): Study Pace and On-time now sit
  side by side on one line instead of stacking — stacked rows in a ~900px-wide card just left the
  right two-thirds empty. Mobile still stacks, unchanged.
- **Real bug, not just a number:** the bar's target length kept getting silently squeezed down to
  its 80px floor once two rows had to share space on the desktop line, because `flex-shrink` was
  left on — setting a bigger target width alone did nothing until `flex-shrink:0` actually stopped
  it from collapsing. Bars are 240px now and hold that length.
- **Second real bug:** the percentage column used `min-width` (a floor, not a cap), so "100%"
  rendered wider than "8%" and pushed that row's bar further right — the two rows never actually
  lined up regardless of vertical spacing. Fixed to a fixed `width` + right-align, so both bars
  start at the same x regardless of digit count, stacked or side by side.

**Validation:** 83 tests pass, `npm run build` clean, verified live in a real browser at desktop
and phone widths after every change in this pass (not just build/test).

## v2.62.0 — 2026-09-14

**Today tab: Progress card gets a second metric (On-time Assignments), made compact**

- Renamed "Study Pace" → "Progress" now that the card holds two metrics. Dropped the per-metric
  hint line in favor of one shared headline at the top, driven by whichever metric is currently
  *worse* (not an average — saying "you're doing great" while one number is actually struggling
  would be dishonest encouragement): "Keep going — every session moves you forward." below 60%,
  "Keep going — you're building good momentum." 60–85%, "You're doing great — keep it up! 🎉" at
  85%+.
- **On-time Assignments** (the metric flagged as blocked last entry): every assignment due from
  the term's start through today, on-time vs late vs missing. Needed a real signal this app
  didn't record before — `completedAt` now stamps the moment an assignment flips to `status:
  "done"` (both places that happens: the checkbox in Academics, and the evening check-in in
  Progress). An assignment marked done before this shipped has no `completedAt` and defaults to
  on-time rather than being penalized retroactively for data that was never captured.
- Both rows shrunk (6px bars, single label+pct+bar line, no per-row commentary) and the
  PaceRunner mascot shrunk from 40→30px and moved to sit once beside both rows instead of once
  per metric — the two-metric version is barely taller than the original one-metric card.
- Along the way, found and fixed the actual cause of "local tab is broken": a leftover
  `next start` process from earlier in the session wasn't matched by `pkill -f "next start"`
  (it shows as `next-server` in `ps`, not `next start`) and kept answering on :3000 through
  several rebuilds — including through a `rm -rf .next`, which pulled files out from under it
  mid-request. No app code was at fault; killing the right PID fixed it. Also widened the header
  greeting's abbreviation breakpoint 480px → 560px — the real overflow point measured closer to
  520px with a full name, not 480.

**Validation:** 83 tests pass, `npm run build` clean, verified live in a real browser (both
narrow — short greeting, one-line icon row, compact stacked Progress card — and desktop widths).

## v2.61.0 — 2026-09-14

**Today tab: Study Pace bar with a running mascot, mobile header icon-wrap fix**

- New "Study Pace" section (its own card, same title-row pattern as every other Today section):
  a percentage, a bar, and a small running-character mascot that speeds up and bounces higher as
  the score climbs, slower and lower as it drops — prototyped live in a standalone artifact over
  several rounds (fixing a genuine gait bug along the way: a nested knee rotation had the wrong
  sign, folding the shin past straight instead of curling it up behind on recovery, which read as
  "swinging" rather than running) before landing here. `components/shared/PaceRunner.jsx` is the
  mascot; its animation rig lives in `app/globals.css` under the `.pr-*` prefix.
- **Formula:** every study/homework/project minute the planner has scheduled from the term's
  start through today, vs. how much of that is marked completed — read straight from
  `data.studyPlan.weeks` (the same source `realDayBlocks` uses), not a simulated estimate. Section
  is hidden entirely (not shown as 0%) until there's actually something in that range to compute.
- **Color:** red &lt;60%, amber 60–85%, green 85%+ — the app's existing 3-tier semantics, not a
  new palette. Arrow marker sits exactly under the bar's fill edge; the mascot is fixed at the
  bar's right end and keeps its own colors regardless of score, by design — only the bar and
  percentage recolor.
- **Today header mobile fix:** "Good afternoon, {name}" at the h1 size plus the 3 header icon
  buttons (check-in/calendar/message) didn't both fit one line at phone widths, so the icon row
  was wrapping onto its own line below the greeting. Abbreviated to "Hi, {name}" below 480px
  (same show/hide-by-class pattern already used for the Academics tab labels and onboarding step
  labels), instead of guessing at a font-size shrink.

**Validation:** 83 tests pass, `npm run build` clean, server smoke-tested (200 on `/`).

## v2.60.7 — 2026-09-14

**Today tab: new health dot — a single red/yellow/green signal next to the greeting**

- A small colored dot next to "Good morning, {name}" — bare color as the at-a-glance signal (per
  explicit choice: no persistent label, most minimal of 3 options offered). Tapping it (not
  hover — hover tooltips don't fire on touch, confirmed earlier this session, so a hover-only
  version would show color with no way to see why on a phone) opens a small popover listing the
  specific reasons, same dropdown pattern already used elsewhere in the app (Academics' term
  switcher).
- **Red**: missing due dates, or overdue items not marked done. **Yellow**: plan doesn't reflect
  latest changes (`planStale`), or evening check-in not done yet. **Green**: none of the above.
- Deliberately built from cheap checks already available on every Today render (plain array
  filters + `planStale`) — does **not** run a planner simulation just to color a dot. Real plan
  shortfalls already have their own dedicated surface (Plan status); this is a lighter "is
  anything obviously off" signal, not a duplicate of that.

**Validation:** 83 tests pass, `npm run build` clean.

## v2.60.6 — 2026-09-14

**Today tab: check-in nudge shrunk from a full-width banner to a small icon**

- The "Evening check-in not done yet..." banner (icon + sentence + its own button) is now a
  single small icon button folded into the existing calendar/daily-message icon row — amber-
  tinted so it still reads as "needs attention" without text. Same destination (Progress tab).

**Validation:** 83 tests pass, `npm run build` clean.

## v2.60.5 — 2026-09-14

**Web-Mobile Enablement: last untreated Academics table fixed (Difficulty tab)**

Doing a status check on what's left from the mobile backlog surfaced this: the Difficulty tab's
review table (Assignment/Due/Weight/Type/AI Planning/Student Planning/Hours/Priority) never got
`table-layout:fixed`, unlike Assignments/Exams/GPA — same exposure to the same auto-layout bug
class those had before. Added `DIFF_COLS` (same pattern as `ASSIGN_COLS`/`EXAM_COLS`/`GPA_COLS`):
Assignment is the one unconstrained `<col/>` (title + icon + EXAM/PROJECT badge), everything else
sized to its real content. `minWidth` 680→820 to match the new fixed-column sum.

Also verified clean, no action needed: School Info and History tabs (no tables/wide grids, same
responsive patterns already in place), and the Courses tab (already card-based, verified earlier
this session).

**Validation:** 83 tests pass, `npm run build` clean.

## v2.60.4 — 2026-09-14

**Star icon restored; ⭐ now consistent between the drawer and the replan result toast**

- Put the star icon back on a forced row in the Per-item table — it's the only control that
  clears `forced` (`setForced(it, false)`); removing it earlier silently blocked un-prioritising
  anything from this drawer.
- The replan result toast already showed "⭐ Item — still short" for a prioritised item that came
  up short; the success case ("fully scheduled 🎯") didn't have the same marker. Added it there
  too, in both the full-replan and single-week toasts, so the star means the same thing in the
  drawer and in the result you see right after clicking Replan — not two different signals for
  the same "this item was prioritised" fact.

**Validation:** 83 tests pass, `npm run build` clean.

## v2.60.3 — 2026-09-14

**Plan status: settled on color-only item marking**

- `ItemTitle` now colors the title text only, no symbol: **Exam = red**, **Project/Essay = amber**
  (one shared color for "the next tier of critical," not split into two), regular homework
  unmarked in the default text color. Reuses the exact colors the rest of the app already uses
  for these types, so there's nothing new to learn.

**Validation:** 83 tests pass, `npm run build` clean.

## v2.60.2 — 2026-09-14

**Plan status: removed the "*" marker and the star icon per feedback**

- `ItemTitle` no longer prefixes Exam/Project/Essay with `*` — red text for Exam titles stays.
- Removed the star icon (⭐) that showed on a forced item's row to un-prioritise it.
  **Functional note, not just visual**: that icon was the only way to clear an item's `forced`
  flag from this drawer (`setForced(it, false)`) — it's now unreachable from here. `setForced`
  itself is left in place (unused for now) rather than deleted, in case this needs to come back
  in whatever form replaces it.

**Validation:** 83 tests pass, `npm run build` clean.

## v2.60.1 — 2026-09-14

**Plan status: Exam/Project/Essay items marked with *, Exams also in red**

- Both tables (Overdue, Per item) now prefix the title with `*` for Exam, Project, or Essay
  items — the "heavier"/higher-stakes item types — and render Exam titles in red specifically,
  so the denser tables still surface which rows carry more weight at a glance.
- Exam and Project both key off a real structural field: `kind==="exam"` (already used elsewhere
  in this file) and a new `isProject` field threaded through from `buildItemDemand`'s own kind
  ("homework"/"project"/"study") via `lib/planDiagnostics.js` — the diagnostics item shape only
  exposed "assignment" vs "exam" before, collapsing homework and project together.
- Essay has no structural type field to key off (unlike exam/project) — display-only title match
  (`/essay/i`), same spirit as the existing `looksLikeProject` heuristic elsewhere in the app.
  Purely visual, doesn't touch scheduling.

**Validation:** 83 tests pass, `npm run build` clean.

## v2.60.0 — 2026-09-14

**Real fix: forcing an exam or project didn't actually give it priority over competing items**

Reported multiple times, and rightly so — the earlier "explanation" (capacity constraints) wasn't
the whole story. Traced the actual allocator (`lib/planner/schedule.js`) line by line and found a
genuine bug: `forced` only ever worked for regular homework (`priority=1e9` in `planDayV2`'s
candidates). Exams and projects never consulted it when deciding who gets first claim on
genuinely scarce SHARED capacity:

- **Exams**: `forced` widened an exam's own start window, but the loop that hands out leftover
  shared capacity when an exam's own dedicated days (eve + lead-in) aren't enough processed exams
  strictly in **due-date order** — a forced exam due later than a competing exam still got served
  after it, and could still lose the shared capacity to a non-forced exam that got there first.
- **Projects**: `forced` wasn't consulted **at all** in the project-placement loop — zero special
  treatment.
- **Preflight risk check**: same gap — computed priority without ever checking `forced`.

Fixed all three: exams' and projects' allocation now sort forced items first (stable sort, so
due-date order is otherwise unchanged); preflight now does the same. Added two regression tests
that reproduce the exact failure mode (two exams / two projects competing for capacity too tight
for both, one forced due *later* than the other) — verified they actually fail without the fix
(reverted schedule.js, confirmed both new tests fail; restored it, confirmed they pass) before
calling this done. 83 tests pass now (81 + 2 new), `npm run build` clean.

**Also, per explicit request**: the replan result toast (both the full replan and single-week
versions) now specifically calls out currently-prioritised items by name — "⭐ Item — still short:
Xh of Yh" listed first, or "'Item' is fully scheduled 🎯" on success — instead of only a generic
top-N shortfall list that never answered "did the thing I just prioritised actually work."

## v2.59.19 — 2026-09-14

**Shortfall toast redesigned: structured, amber (not red), × in the top-right corner**

- **Readability**: the "N items came up short: A (Xh of Yh); B (Xh of Yh)…" run-on sentence is
  now a real structure — bold title ("N items came up short"), a context subtitle ("Re-planned N
  days…"), one line per item, and a footer pointing to Study Preferences. `toast2()` now accepts
  a structured object (`{title, sub, lines, footer}`) as its message in addition to a plain
  string, which the toast renders as title+list+footer instead of one paragraph.
- **Why red, and why it's not anymore**: red is this app's established color for something that
  actually *failed* (delete buttons, overdue badges) — but a shortfall toast fires after a
  replan that *succeeded*; it's a heads-up needing attention, not an error. It's amber now,
  matching every other "needs your attention" surface in the app (missing-due-date badges,
  "Changes not applied yet" banners). `toast2(m, e, severity)` takes an optional 3rd argument to
  set this explicitly — every other existing call site is unaffected (`e:true` alone still
  defaults to red, unchanged).
- **× moved to the top-right corner** of the toast box (`alignItems:flex-start` on the title row)
  instead of sitting inline at the end of a single line of text — matters more now that toasts can
  be genuinely multi-line.

**Validation:** 81 tests pass, `npm run build` clean.

## v2.59.18 — 2026-09-14

**Plan status: Replan button pinned to a fixed banner instead of buried in scroll**

- The button lived inside the scrollable "Per item · today forward" section, past "Last full
  replan," the stats row, and potentially the Overdue table — scrollable out of view once
  checked. Moved to a fixed amber banner right below the header (`flexShrink:0`, same spot/style
  as the "Changes not applied yet" and staged-completions banners already there), so it's always
  visible the instant a row is checked, matching where this kind of action used to live before
  the recent rework.
- No behavior change — same `prioritiseSelected()` handler, same one-click result.

**Validation:** 81 tests pass, `npm run build` clean.

## v2.59.17 — 2026-09-14

**Disabled Next.js's dev-mode "N" indicator badge**

- Not part of the app — a framework-level debugging badge `next dev` shows in a screen corner,
  dev-only (never appears in production builds). Turned off via `devIndicators:false` in
  `next.config.mjs`.

**Validation:** 81 tests pass, `npm run build` clean.

## v2.59.16 — 2026-09-13

**Toasts: error/important ones move higher, persist until closed, and wrap instead of overflowing**

Prompted by the "N items came up short" toast after a replan being gone before it could be read.

- `toast2(m,e)` used to auto-dismiss everything on a fixed 3s timer regardless of message length
  or importance. Routine confirmations ("Added!", "Saved!") still do — fine to miss, low stakes.
  Error/important toasts (`e:true`) now persist until dismissed via a new × button, never on a
  timer. A second `toast2()` call while one's already showing now cancels any pending auto-dismiss
  timer instead of two timers racing to clear whichever toast happens to be up at the time.
- Moved from `bottom:22px` to just below the header (`top:92px` desktop, `top:58px` mobile — same
  split `.header-spacer-nav` already uses), so it's immediately visible instead of easy to miss at
  the screen's bottom edge.
- Also fixed a real overflow bug this surfaced: `white-space:nowrap` meant a longer message (like
  a multi-item shortfall list) just stretched the toast pill wider than the viewport instead of
  wrapping — clipped by the page's own `overflow-x:hidden` guard, so part of the message was
  literally cut off, not just hard to read in time. Wraps within `max-width:min(480px,100vw-32px)`
  now.

**Validation:** 81 tests pass, `npm run build` clean.

## v2.59.15 — 2026-09-13

**Plan status: single "Replan → fill 100%" action, correctly sequenced**

Per explicit clarification: one button, one click — not a stage-then-separately-replan flow.

- Renamed the button `Prioritise N → fill 100%` → `Replan N → fill 100%` (`ti-sparkles` icon) —
  it now does the whole job on click: marks the items forced *and* runs the actual replan, not
  just a staging step.
- Brought back the `pendingAutoReplan` effect from v2.59.13 (armed by the click, fires
  `refreshQuarterPlan` once `data` has genuinely updated) — this part was correct before; what
  broke it was also setting `planStale:true`, which drives a *separate*, pre-existing banner
  ("Changes not applied yet") meant for setHours/setForced's manual, not-auto-replanned edits.
  Setting it here just for the instant before this effect cleared it again produced two
  overlapping "please replan" prompts for what should be one action. `prioritiseSelected` no
  longer touches `planStale` at all — only this one button appears, and only while `sel` is
  non-empty, exactly matching "uncheck removes it unless another item is still checked."
- Updated the stale "Then Replan to apply" help text below the table, which no longer described
  the actual flow.

**Validation:** 81 tests pass, `npm run build` clean.

## v2.59.14 — 2026-09-13

**Plan status: reverted Prioritise to the one pattern that's actually proven correct**

v2.59.13's auto-trigger (an effect watching `data`) fixed the stale-data bug but created a new
problem: since the "Changes not applied yet — Replan now" banner is driven purely by
`planStale` (true the instant `prioritiseSelected` runs), it appeared immediately, and then the
auto-triggered replan's own confirm dialog popped up on top of it — two overlapping "replan"
prompts for one action, with the banner's own button now redundant and confusing.

- `prioritiseSelected` is back to setting `forced:true` + `planStale:true` and stopping there —
  exactly matching `setForced` (the per-item star-icon toggle), which was never touched and never
  had this bug. The "Changes not applied yet — Replan now" banner is the one, single place that
  actually triggers the replan, as its own deliberate click — by which point React has already
  applied the forced flags, so `refreshQuarterPlan` closes over current data, not stale data.
  Removed the `pendingAutoReplan` effect entirely rather than trying to patch it further.
- Removed the amber background added to the Need cell on check (v2.59.13) — reported as
  rendering black, and per feedback not wanted regardless of color.
- The "Prioritise N → fill 100%" button's position and wording are unchanged throughout all of
  this — only the mechanism behind what happens after you click it changed.

**Expected flow now:** check items → **Prioritise N → fill 100%** (marks them) → the amber banner
appears → **Replan now** → confirm → the item should no longer show Short, assuming there's
enough free time before its due date to actually fit it — forced priority means "goes first, ahead
of everything else," not a way to manufacture calendar time that doesn't exist. If it's still
short after a completed replan with real available capacity, that's still worth reporting as a bug.

**Validation:** 81 tests pass, `npm run build` clean.

## v2.59.13 — 2026-09-13

**Prioritise back to one click — auto-replans once the data actually lands, not before**

v2.59.12's fix was correct about the root cause but overcorrected to a manual two-step flow. This
keeps the fix and removes the extra click.

- `prioritiseSelected()` now sets `forced:true` and arms a `pendingAutoReplan` flag instead of
  calling `refreshQuarterPlan()` directly. A new effect watches `data` itself and fires
  `refreshQuarterPlan()` exactly once `data` has genuinely changed — i.e. once React has actually
  applied the forced flags — rather than in the same synchronous tick as the `upd()` call that
  scheduled them. Net effect for you: still one click on "Prioritise → fill 100%"; the correct
  sequencing now happens automatically instead of needing a second "Replan now" click.
- Checking a row now highlights its **Need** cell (amber background) — visual confirmation of
  which row is about to be pinned to 100% before you commit to Prioritise.

**Validation:** 81 tests pass, `npm run build` clean. Please re-test the full one-click flow
(check → Prioritise → confirm the replan prompt) and confirm the item no longer comes back Short.

## v2.59.12 — 2026-09-13

**Fix: "Prioritise → fill 100%" replanned against stale data — a real bug, not the UI**

- Root cause: `prioritiseSelected()` called `upd({...forced:true})` and then, in the same
  synchronous call, `refreshQuarterPlan()` — but `upd` schedules a React state update, it doesn't
  apply it immediately, and `refreshQuarterPlan` is a plain function in App.jsx closing over
  *that render's* `data`. Calling it right after `upd()` meant it ran the actual replan against
  the pre-update snapshot — the `forced:true` flag this function had just set wasn't visible to
  the replan supposed to apply it, so the real, persisted schedule never actually prioritised the
  item. That's why it came back "Short" — the replan genuinely never saw the flag.
- `setForced` (the per-item star-icon toggle, same file) already had this right: set
  `planStale:true` and stop, no chained replan call. `prioritiseSelected` now follows the same
  pattern — the flow is now check items → **Prioritise** (marks them, no longer force-replans
  itself) → the existing "Changes not applied yet — Replan now" banner appears → clicking it runs
  the replan as a separate click, by which point React has re-rendered and `refreshQuarterPlan`
  closes over real, current data.

**Validation:** 81 tests pass, `npm run build` clean. This was a genuine logic bug (not something
visual to eyeball) — please re-test the full flow (check → Prioritise → Replan now) and let me
know if the checkbox/indicator persistence issue was this same root cause or something separate.

## v2.59.11 — 2026-09-13

**Fix: unchecking a Plan status checkbox didn't dismiss its action button**

- Root cause: the checkbox column was 22px wide, but `DoneCheckbox` is 18x18px and `Td`'s own
  padding adds 16px horizontal on top of that — a real 34px minimum, 12px more than the column
  had. The checkbox was visibly bleeding into the Item column next to it, so what you saw didn't
  line up with what was actually catching the click — toggling it back off could land on
  something else in that space instead (the Item column's own star-icon handler, for one), so
  the underlying selection never actually cleared and the action button stayed visible.
- Widened col0 to 34px (the real minimum), Item gave back a few px to cover it (130→122).

**Validation:** 81 tests pass, `npm run build` clean.

## v2.59.10 — 2026-09-13

**Plan status: 2 follow-ups + a question answered**

- **Class divider was a run-length check, not real grouping** — it inserted a divider whenever
  the course changed from the row *directly above*, so a course whose items weren't already
  adjacent in the priority/date-sorted list could get split across multiple dividers instead of
  one clean section. Replaced with actual grouping (`groupByClass`): every item for a course is
  now listed together under exactly one divider — "one line for Class, then all its items, then
  the next divider" — using a `Map` to preserve first-appearance order, so the most urgent course
  still leads.
- **Item was too wide** — it went back to a fixed 130px column instead of the unconstrained
  `auto` column it became when Class was removed. `auto` meant it silently absorbed 100% of the
  freed space; every column here is now a deliberate, bounded width, so none of them is left to
  soak up arbitrary leftover room. Table `minWidth` 360→402 to match the fully-fixed sum.
- **The left checkbox isn't new** — it's original functionality, unrelated to any of this
  session's changes: on the Overdue table it stages items you've actually finished (via "Save"),
  on the Per-item table it selects items to force-prioritise in the next replan (via
  "Prioritise → fill 100%"). Likely just easier to notice now that the table isn't as visually
  crowded.

**Validation:** 81 tests pass, `npm run build` clean.

## v2.59.9 — 2026-09-13

**Plan status: Class moved from a column to a section-divider line**

- Class repeated the same course name down every row (rows are sorted by priority/due date, not
  grouped by course) — a whole column spent on a value that often didn't change row to row.
  Replaced with a `ClassDivider` row, inserted only where the course actually changes from the
  row before it — same information, without a dedicated column. Row order is unchanged; this
  doesn't regroup by course, it just stops repeating the name every row.
- Freed width split between Item (still gets the most, as the one `auto` column) and a bit more
  breathing room for Due/Diff/Priority/Short, per feedback that all the saved space shouldn't
  just go to one column. Table `minWidth` 390→360 to match.

**Validation:** 81 tests pass, `npm run build` clean.

## v2.59.8 — 2026-09-13

**Plan status drawer: column widths actually rebalanced, not just made scrollable**

v2.59.7 made the tables scroll instead of overflow the page; this pass fixes the columns
themselves per specific feedback on each one.

- **Dropped the trailing empty column** — both tables always rendered `<Td />` there; it never
  held content in either one, just 44px of dead space plus a column's worth of padding.
- **Due**: was showing the raw ISO date ("2026-09-20") in a 104px column. Now a compact "9/20" in
  44px — this alone was most of the "too much space, too generous a format" complaint.
- **Class/Diff shrunk** to what their real content needs (108px→50px, 62px→36px) — both already
  degrade safely at a tight width (Class truncates with an ellipsis, Diff wraps a rare "Very
  High" to two lines) rather than breaking, so there was genuinely spare room to give back.
- **Priority rounded to a whole number** ("129" not "128.7") and its column tightened — the extra
  decimal precision wasn't worth the width it cost in a compact diagnostic column.
- **Item** (the one column that was actually cramped) gets all the space freed up by the above —
  it's the only `auto`-width column, so every pixel reclaimed elsewhere goes straight to it.
- **Need** stays a deliberately generous 74px — `HoursInput` (components/shared/ui.jsx) has its
  own hardcoded 64px input; shrinking the column below that would just reintroduce the same
  bleed-into-neighbor bug fixed on the Exams table earlier this session.
- Table `minWidth` dropped 600→390, matching the new fixed-column sum (~310px) plus a reasonable
  minimum for Item — the table now genuinely fits most phone widths without scrolling at all;
  `overflow-x:auto` stays on purely as a fallback for the narrowest devices.

**Validation:** 81 tests pass, `npm run build` clean.

## v2.59.7 — 2026-09-13

**Plan status drawer too wide on mobile**

- The drawer's own width already handled mobile correctly (`width:"min(880px,100vw)"`), but its
  two data tables (Overdue, Per-item) didn't — 9 columns with a fixed-width sum around 566px,
  `width:"100%"` but no `overflowX:"auto"` wrapper and no `minWidth`, so on a ~380px-wide mobile
  drawer they had nowhere to go but overflow. Wrapped both in `overflow-x:auto` with
  `minWidth:600`, matching the same pattern already proven on the Academics tables.
- Also fixed while in here: the drawer's `top:92` assumed the old two-row header height — below
  768px the nav row is hidden (v2.58.0's hamburger menu) and the header is only 50px, so the
  drawer was leaving a 42px gap at its top on mobile, exposing whatever sat behind it. Moved to a
  `.plandrawer-panel` CSS class with the same 92→50 breakpoint `.header-spacer-nav` already uses.

**Validation:** 81 tests pass, `npm run build` clean.

## v2.59.6 — 2026-09-13

**Month grid: adjacent-month days no longer shown**

- Each month's grid was filling its leading/trailing cells with the previous/next month's actual
  dates (dimmed, since `monthsList` renders every month in the term as its own full section, that
  adjacent month already gets its own complete grid right above or below — showing it again here
  was just a redundant, non-interactive preview). Those cells are now blank, keeping the grid's
  weekday alignment intact without displaying another month's days inside this one.

**Validation:** 81 tests pass, `npm run build` clean.

## v2.59.5 — 2026-09-13

**3 small fixes to the nav and month view**

- Nav tab renamed "Weekly" → "Calendar" (App.jsx's `TABS`, so it updates everywhere the label is
  used — the desktop row and the hamburger dropdown both read from the same array).
- Removed the "Plan this week" button from the day-detail's amber status banner — it duplicated
  the Replan icon in the header above (both called `refreshWeekPlan` on the same week, with no
  indication they were the same action, reading as two different features). The banner is now
  just a status note ("Study time isn't planned for this week yet."), no redundant action.
- Action-icon group (Add / diagnostics / Replan) now sits `marginRight:6` off the pane's true edge
  instead of flush against it.

**Validation:** 81 tests pass, `npm run build` clean.

## v2.59.4 — 2026-09-13

**Month view: 3 fixes + action buttons added to the day-detail pane**

- **Sleep rows removed** from the day-detail list — it's not a schedulable activity, just the
  wake↔sleep boundary, and it was showing as two separate rows (midnight→wake, bedtime→midnight)
  that added nothing.
- **"Not planned yet" no longer hides the real schedule.** It used to replace the whole list with
  just a prompt whenever AI study blocks hadn't been generated for that week — but `buildBlocks`
  already includes the real fixed schedule (classes, meals, gym) regardless of AI-planning
  status, so a day with real class time was being hidden behind an unrelated gate. Now the list
  always shows; an amber banner above it (not a replacement) offers "Plan this week" only when
  actually relevant.
- **Action buttons added** — Add activity / plan diagnostics / Replan (this week, whole term, or
  clear) now live in the day-detail pane's header, scoped to the selected day/week. These existed
  only in the desktop grid's toolbar before, genuinely unreachable from month view since there's
  no path from here into that toolbar anymore (the grid itself isn't offered on mobile, v2.59.0).

**Not fixed here — needs your input:** the term-start date shown (8/21) not matching what you
typed (8/12) is very likely because `getTermRange()` prefers an active **College Calendar
quarter's** dates over the profile's typed Term Start field whenever one exists (`lib/data/
calendar.js`) — the month view is just the first place that visualizes that boundary directly.
Worth checking School Info → the college calendar's quarter dates if 8/21 isn't actually your
first day of classes; happy to dig further with specifics if that's not it.

**Validation:** 81 tests pass, `npm run build` clean.

## v2.59.3 — 2026-09-13

**Academics: 3 fixes, one a real regression from earlier this session**

- **Sub-tab bar**: below 480px, labels abbreviate (Assign/Exams/GPA/Diff/Sync) and padding
  tightens further, so all 6 tabs genuinely fit within the page width — not just scrollable
  in-place, actually fitting, per feedback that scrolling wasn't the answer here.
- **Exams table — a real regression from v2.57.10**: that change widened Topics to 220px but
  left the table's `minWidth` at 680 — the six *fixed* columns alone already summed to 734px, so
  the "flexible" Exam-title column had negative space to work with and collapsed to ~0, forcing
  every character onto its own line (the "overlapped, many lines" bug just reported). Topics
  brought back to a more reasonable 170px and `minWidth` raised to 850 — comfortably above the
  684px fixed-column sum, giving Exam title a genuine ~166px minimum.
- **GPA table**: Class was left as the one flexible column, which on the horizontal-scroll
  fallback ballooned to whatever was left over at the table's `minWidth`, pushing Grade %/
  Credits/Letter far enough right that Credits read as pinned to whichever edge was in view after
  scrolling. Converted to four fixed, tightly-sized columns instead (150/95/80/62, `minWidth`
  520→387) — no more ambiguity about who absorbs leftover space, and the table now needs far less
  scroll room on a phone. Course name gets ellipsis overflow as the safety net instead of room to
  grow, matching how Assignments/Exams already protect their own fixed columns.

**Validation:** 81 tests pass, `npm run build` clean.

## v2.59.2 — 2026-09-13

**Month view calendar pane: 5 tuning fixes**

- **Days outside the term are now disabled**, not just dimmed — a real `<button disabled>`, so
  they can't be selected or show a (nonexistent) activity list. Distinct from "outside this
  calendar month": a trailing day from next month still inside the term stays fully clickable,
  same as before — only the term's actual start/end boundary disables a day.
- **Today's circle is now amber/orange** (was blue), matching the app's actual orange accent.
- **Dots under each day now show one per distinct activity type present** (was a single generic
  dot for "any block exists"), colored via the same `tc(type).line` function as the day-detail
  list below it — so a day with both a class and study time shows an amber dot and a green dot,
  not one dot meaning nothing in particular. Capped at 4 and skips routine/filler types (sleep,
  commute, meals) that are on every day regardless of anything actually scheduled — Apple
  Calendar's dots represent real events, not routine state, and this follows that.
- Day-number font: 13px → 14px. Weekday header letters (S M T W T F S): 11px → 13px.

**Validation:** 81 tests pass, `npm run build` clean.

## v2.59.1 — 2026-09-13

**Month view's day-detail panel: plain chronological list instead of the 3-column Timeline grid**

- The day-detail pane was using the shared `Timeline` component — a graphical Morning/Afternoon/
  Evening 3-column grid with absolutely-positioned blocks, designed for a much wider surface. At
  the panel's actual width it would have rendered three ~110px columns, unusably cramped.
- Replaced with a plain top-to-bottom list: one row per activity, "9:30am – 10:30am  MATH180"
  format, sorted morning→evening. Built directly on `buildBlocks()` (the same function `Timeline`
  itself uses) — every real activity (classes, meals, gym, commute, sleep, actual study blocks)
  in one flat sorted list, no lane/overlap logic needed the way the graphical grid requires.
- **Same color code as everywhere else in the app**: each row's left edge is a 4px stripe in that
  block's `tc(type).line` color — the exact function `Timeline` and `WeekGrid` already use, so
  green study blocks, amber classes, purple gym, etc. all mean the same thing here as everywhere
  else. Sleep/commute rows are dimmed, completed blocks get a ✓, auto-shifted ones a ↻ — matching
  `Timeline`'s existing conventions rather than inventing new ones.
- A real cross-component bug caught in the process: giving each row `className="card"` without
  overriding its `margin-bottom:14px` would have doubled up with the list's own `gap:6` spacing —
  added `margin:0` on each row so only the intended 6px gap applies.

**Validation:** 81 tests pass, `npm run build` clean.

## v2.59.0 — 2026-09-13

**Weekly tab, mobile: rebuilt again — Apple-Calendar-style month view**

v2.58.0's expandable week cards had a real bug (its "Full grid" button led to the 7-column grid
with no way back) and, more fundamentally per Avishai's read: a phone can't usefully show "a
week" as a unit at all, in any form. Rebuilt around a different unit entirely — the month —
instead of iterating on the week concept again.

- Below 768px, Weekly now opens to a **month calendar**: a scrollable grid spanning every month
  in the current term (scroll up/down for adjacent months, like Apple Calendar's month view),
  auto-scrolled to the current month on open. Today's date sits in a solid filled circle; a small
  dot below any date marks a day with scheduled blocks; tapping a day selects it (amber tint).
- **Selecting a day shows its activities in a fixed panel below the calendar** — a real two-pane
  split (`display:flex; flex-direction:column`, each pane independently `overflow-y:auto`), not a
  long page, so the day's schedule is always on screen the moment you tap a date, never requiring
  a scroll to find it.
- **The 7-column grid is no longer offered on mobile at all** — directly answering "why do we
  offer grid view for mobile users if there's no way back": there isn't a path to it anymore, so
  there's nothing to get stuck in. Desktop's grid (`mode==="week"`) and the single-day drill-down
  reached by tapping a grid cell (`mode==="day"`) are both untouched — this only changes what
  narrow screens default into.
- The month grid uses `grid-template-columns:repeat(7,1fr)` with no fixed pixel widths anywhere —
  inherently immune to the class of overflow bug fixed in v2.57.9/v2.57.11, not just guarded by
  the global backstop.

**Validation:** 81 tests pass, `npm run build` clean. Still not visually verified live in this
session; worth checking on an actual phone before iterating further.

## v2.58.0 — 2026-09-13

**Weekly tab, mobile: new "expandable week cards" concept replaces the single-day default**

Rather than iterate again on the single-day-plus-day-picker-strip approach (v2.57.7), picked a
genuinely different concept with Avishai first (3 options presented, this one chosen): a week
gives more useful information as an overview than as one day at a time.

- Below 768px, Weekly now opens to a new **agenda** mode: all 7 days of the current week as
  stacked cards, each showing weekday/date/Today badge + a block-count and total-duration summary
  when collapsed. Tapping a card expands it inline into that day's full Timeline (accordion — one
  open at a time), collapsing whichever was open before. Today's card opens by default.
  - Gives the "shape of the week" at a glance — which days are packed vs. light — something the
    single-day view couldn't show at all without switching days repeatedly.
  - Week nav (prev/next arrows, "This week"/date-range label) sits above the cards, deliberately
    built with no fixed-width elements (unlike the grid toolbar's 300px week-select dropdown) so
    it can't reintroduce the page-overflow class of bug fixed in v2.57.9/v2.57.11.
  - "Full grid" still reaches the 7-column grid on purpose (e.g. desktop-like use on a tablet).
- The old single-day view (`mode==="day"`) is **not removed** — it's still what opens when you tap
  a specific day cell in the full grid (`WeekGrid`'s `onDay`), on desktop or mobile alike; only
  its role as the narrow-screen *default* changed. Desktop's default (the full grid) is untouched.

**Validation:** 81 tests pass, `npm run build` clean. Still not visually verified live in this
session; worth checking on an actual phone.

## v2.57.11 — 2026-09-13

**Global guard against page-level horizontal overflow, plus a full audit**

- Added `overflow-x:hidden` on both `html` and `body` (plus `max-width:100vw` on body) — a hard
  backstop so the page itself can never scroll or overflow left/right, regardless of what causes
  it. This doesn't replace fixing root causes (the acad-tabs-row bug was fixed properly, not
  papered over) — it's insurance against the *next* one: something that shouldn't scroll but
  would otherwise widen the page now clips instead of creating a page-wide scrollbar.
- Audited every `overflow-x`/`overflowX` container in the app (7 in Acad.jsx, one each in
  Week.jsx and globals.css's nav-row/onboard-stepbar/acad-tabs-row) for the exact flex-child +
  missing-`min-width:0` bug found in acad-tabs-row — none of the others are flex children of
  another flex row the same way, so that was genuinely isolated, not systemic.
- Also checked every modal (`width:100%` + `maxWidth` pattern throughout — already correctly
  responsive) and every fixed pixel width/min-width ≥300px in the codebase for narrow-viewport
  risk — nothing else stood out as a live bug. One dropdown menu (Week.jsx's "Replan options",
  right-anchored) could theoretically run off the left edge on an unusually narrow phone; the new
  global guard means that now clips harmlessly instead of breaking the page, so it's noted rather
  than separately reworked.

**Validation:** 81 tests pass, `npm run build` clean.

## v2.57.10 — 2026-09-13

**Exams table: Topics column crowding/overstepping into Due**

- Topics was the one unconstrained column (absorbing all leftover table width), which on a wide
  screen could balloon, and — since a single long unbroken token isn't force-wrapped by default —
  a long enough one could visually bleed past its own cell into Due instead of wrapping.
- Swapped which column flexes: **Exam** (title) now absorbs the slack instead of Topics — moving
  the flexible space to the left column, as asked. Topics gets a fixed, bounded 220px instead of
  an unbounded width. Both cells also get `overflow-wrap:break-word` as an independent guard, so
  even an unusually long single word wraps within its own column instead of bleeding into the next.

**Validation:** 81 tests pass, `npm run build` clean.

## v2.57.9 — 2026-09-13

**Fix: Academics tab row was overflowing the whole page, not just scrolling internally**

- Root cause: `.acad-tabs-row` (v2.57.7) has `overflow-x:auto`, but it's also a flex *child* of
  the tab-bar row in Acad.jsx — flex items default to `min-width:auto` ("never shrink below my
  own content"), which silently overrides `overflow-x:auto`. It couldn't be the thing that
  scrolls if it was never allowed to shrink in the first place, so instead of scrolling
  internally it just pushed past its container and overflowed the entire page horizontally.
  Added `min-width:0`, the standard fix for this exact flexbox interaction — the row now actually
  shrinks to available width and scrolls within itself as originally intended.
- Checked the other `overflow-x:auto` rows added this session (main nav, Exams/GPA tables,
  Week's day-picker strip, onboarding step-bar) for the same bug — none of them are flex children
  of another flex row the way `.acad-tabs-row` is, so this was an isolated case, not systemic.

**Validation:** 81 tests pass, `npm run build` clean.

## v2.57.8 — 2026-09-13

**Mobile nav, revised again: hamburger dropdown instead of the icon-row tab bar**

- v2.57.4's icon+tiny-label row technically fit all 8 tabs on one line, but read as cramped —
  and there was unused space to the right of it the whole time. Replaced below 768px with the
  standard mobile pattern instead: a "☰" (`ti-menu-2`) button in the top bar opens a dropdown
  listing all 8 tabs with full icon + label (not abbreviated), same visual style as the existing
  term-switcher dropdown in Academics. Selecting a tab closes the menu.
  - Desktop (≥768px) is completely unchanged — still the full labeled row, unaffected.
  - Bonus: the nav row (a full extra 42px-tall bar) now disappears entirely on mobile instead of
    just shrinking, so `.header-spacer-nav` shrinks to match — that's real vertical space back for
    content on every screen below 768px, not just a tidier tab bar.
  - Removed the now-dead short-label plumbing (`TABS[].short`, `.nav-tab-label-full/-short`) that
    the icon-row approach needed and the dropdown doesn't.

**Validation:** 81 tests pass, `npm run build` clean.

## v2.57.7 — 2026-09-13

**Landing copy + Week nav confusion + Academics tables/sub-tabs, all from live phone testing**

- **Landing page**: "...plans your study time for the semester..." → "...for the quarter/semester...",
  since StudyOS handles both term systems, not just semester schools.
- **Week tab landing on what looked like Today again**: tapping "Week" on a narrow screen (below
  768px, per v2.57.0 item #2) drops straight into a single day's Timeline with only a small
  "← Weekly" ghost button — visually indistinguishable from the Today tab, no week context
  anywhere. Added a "Week of <range>" label and a 7-day picker strip above the Timeline, so it
  reads as the Week tab (a week of days) and days can be switched without leaving to the 7-column
  grid at all. The grid is still one tap away, relabeled "Full grid" for clarity.
- **Academics sub-tabs (Courses/Assignments/Exams/GPA/Difficulty/Update Syllabus)**: 6 icon-less
  pills wrapped to a second line on narrow screens. Now scroll horizontally instead (matches the
  main nav's item #3 treatment) and shrink below 640px so they're not full desktop size on a
  phone either.
- **Exams table** had unclaimed empty space on the right; **GPA table**'s Credits/Letter columns
  bunched up against the right edge with dead space before them. Same root cause in both: no
  `table-layout:fixed`, so the column meant to flex (Topics; Class) didn't actually absorb the
  slack — auto-layout under-sized it instead. Fixed by copying the exact pattern the Assignments
  table already uses correctly (`table-layout:fixed` + an explicit `<colgroup>` with one
  unconstrained `<col/>`): added `EXAM_COLS`/`GPA_COLS`, applied to all four tables (Exams
  upcoming + completed, GPA). Exams' completed table was also missing the horizontal-scroll
  wrapper and `minWidth` its own upcoming table has — added for consistency.

**Validation:** 81 tests pass, `npm run build` clean. Still not visually verified live in this
session — these are direct fixes for issues Avishai found testing on his actual phone.

## v2.57.6 — 2026-09-13

**Web-Mobile Enablement item #5 — onboarding step-bar**

- 8 step circles + 7 connectors + a "`<Step name>` · n/N" label summed to well over 400px with no
  wrap or shrink handling — on a phone this either overflowed the card or ran off-screen with no
  way to see later steps. Below 640px, circles shrink 26px→20px, connectors 12px→7px, and the
  label swaps to a compact "n/N" (dropping the step name, which is redundant with the highlighted
  current circle). `overflow-x:auto` stays on as a safety net regardless of width, so a step is
  never truly unreachable even on the narrowest phones.
- Same pattern as items #3/#4: static sizing moved out of inline styles into `onboard-step-*` CSS
  classes so the media query can override them; only the per-step state colors (done/current/
  upcoming) stay inline.

**Validation:** 81 tests pass, `npm run build` clean. Still not visually verified live.

## v2.57.5 — 2026-09-13

**Web-Mobile Enablement item #4 — Today tab touch-target pass**

- The Focus Time play/pause/complete buttons — the control tapped most often on this tab — were
  28px, under Apple's/Google's ~44px recommended minimum tap target. New `.icon-btn-28` CSS class
  keeps them at 28px on desktop (a mouse doesn't need the margin) but bumps to 38px below 640px.
  Applied the same class to the header's bug-report and account buttons (App.jsx) for consistency
  — the account button in particular is the only way to sign out, so it's worth the same treatment.
- Rest of the Today tab (Deadline Awareness alignment, Focus Time row alignment, both fixed
  earlier this session) already covers the bulk of what this item asked for; this closes the
  remaining explicit "bump 28px tap targets" note from the MOBILE.md tracking table.

**Validation:** 81 tests pass, `npm run build` clean. Still not visually verified live.

## v2.57.4 — 2026-09-13

**Landing feature-box icon centering + mobile nav tabs get short labels instead of icon-only**

- **Landing page 4 feature boxes**: icon looked visibly above-center against its title text.
  Root cause: the small header icon uses both `feature-icon` and `feature-icon-sm` classes
  together, and `feature-icon` carries `margin-bottom:14px` (meant for the large standalone hero
  icon elsewhere on the page) that `feature-icon-sm` never overrode — the icon's taller margin-box
  threw off `align-items:center` on the row. Added `margin:0` to `feature-icon-sm`.
- **Mobile nav tabs, revised from v2.57.3**: that build went icon-only below 768px, relying on the
  existing "tt" tooltip to carry each label. Caught before shipping further: tooltips fire on
  `:hover`, which a touchscreen tap doesn't reliably trigger — icon-only would have left every tab
  unlabeled on exactly the phone-width breakpoint it targets. Replaced with the standard
  phone-tab-bar pattern instead: icon on top, a tiny (9px) short label below it ("Acad", "Prog",
  "Prefs", etc.) — still compact enough that all 8 tabs fit one row with no scrolling, but every
  icon stays identified without depending on hover.

**Validation:** 81 tests pass, `npm run build` clean. Still not visually verified live — same
in-session resize-tool limitation as prior mobile items; worth checking on an actual phone.

## v2.57.3 — 2026-09-13

**Web-Mobile Enablement item #4 — top bar + nav row, the last piece of the header genuinely
unusable on a phone**

Both rows packed desktop-density content into one line with no narrow-screen treatment at all —
worked around by horizontal scroll (nav) or just overflowing (top bar), neither a real fix.

- **Top bar**: below 640px, drops everything non-essential — greeting, term/finals badge, API
  connection status, version stamp — down to brand mark, the actionable missing-due-dates
  warning, and the account/bug-report buttons. Reduced side padding (20px→12px) and gap
  (12px→8px) to match. The missing-due-dates badge also gets a max-width + ellipsis safeguard so
  a long "N missing due dates" string can't itself force an overflow.
- **Nav tabs**: below 768px, labels disappear and tabs go icon-only — the existing "tt" tooltip
  (already used for the bug-report/account icon buttons) carries the label on hover/long-press,
  same pattern as those. All 8 tabs now fit in one row at phone width with no scrolling needed,
  instead of the horizontal-scroll workaround from item #3.
- Layout properties (padding/gap/etc.) for both rows moved from inline styles into two new CSS
  classes (`.topbar-row`, `.nav-row`, `.nav-tab-btn`) specifically so the media queries could
  override them cleanly — inline styles otherwise beat a CSS class and would have needed
  `!important`. Only the selection-state-dependent bits (active tab color/underline) stay inline.

**Validation:** 81 tests pass, `npm run build` clean. Not yet visually verified live — same
in-session limitation as items #1–3 (the browser automation's resize tool doesn't affect real
viewport width here) — needs a real check on an actual phone or via Chrome DevTools device mode.

## v2.57.2 — 2026-09-13

**Today tab: fixed two column-alignment bugs (Deadline Awareness + Focus Time), both root-caused to
missing fixed widths on variable-length text**

- **Deadline Awareness time tags**: the "3d"/"6d"/"in 6 days"/"⚠ Enter date" pill and the
  "✓ planned"/"not yet" status text after it had no fixed width, so a row with a wider tag (e.g.
  "in 6 days") pushed its own status text further right than rows with a short tag ("3d") — the
  whole trailing column looked staggered instead of aligned. Both now have a fixed `minWidth`, so
  every row's tag and status text start at the same x regardless of content length.
- **Focus Time play buttons**: root cause was the duration label ("30m" vs "1h") next to the play
  button having no fixed width — that changed the button+duration group's min-content size per
  row, which changed how much the task-text column to its left got squeezed (flex-shrink math),
  which visibly shifted the play button left/right row to row. Gave the duration label a fixed
  `minWidth` so the group's width — and therefore the button's position — is now identical on
  every row regardless of duration.
- Not yet visually re-verified live (the in-session browser resize tool still doesn't affect the
  actual page viewport — confirmed again this session via `window.innerWidth`) — worth a real
  check on an actual phone or via Chrome DevTools device mode.

## v2.57.0 — 2026-09-13

**Web-Mobile Enablement items #1–3** — see `MOBILE.md` (`docs/backlog` branch)

All three implemented as additive breakpoints/viewport checks — desktop rendering unaffected (verified live: Weekly still defaults to the full grid on desktop).

- **#1 `.g2/.g3/.g4` grid collapse**: below 480px, these shared 2/3/4-equal-column classes stack to one column instead of crushing labeled inputs to ~65-80px — fixes Preferences, Onboarding wizard, and Account modal simultaneously (they all share these classes).
- **#2 Weekly auto-day-mode**: below 768px, `Week.jsx` now defaults straight into the existing single-day agenda view (today) instead of forcing the 7-column time grid, which genuinely can't fit a phone screen. The "← Weekly" button still lets a narrow-screen user reach the grid on purpose.
- **#3 Top nav no longer clips tabs**: the tab row was `overflowX:"hidden"` — once tabs didn't fit a narrow screen, the excess ones were invisible and unreachable, not just cramped. Switched to `overflowX:"auto"` with `flexShrink:0` per tab, so it scrolls horizontally instead — nothing is ever unreachable again.

**Validation:** 81 tests pass, `npm run build` clean. Live-verified desktop is unaffected (Weekly still opens to the grid). The narrow-viewport behavior itself couldn't be visually verified this session — the browser resize tool isn't taking effect in this environment — worth a real check on an actual phone.

## v2.56.7 — 2026-09-13

**SMS opt-in: added "consent is optional" line, matching Twilio's web-form example 100%**

- Compared the real SMS opt-in screen (Preferences → SMS Reminders) against Twilio's official web-form opt-in example element-by-element — everything already matched except one: their example explicitly states consent isn't required to use the product ("Consent is not required to make a purchase"). Added the equivalent line: "Opting in is entirely optional — StudyOS works the same either way." `/sms-optin` evidence page's description updated to match.
- **Follow-up needed**: the public `/sms-optin-screenshot.png` evidence image still shows the form *before* this line was added — needs retaking from a live logged-in account before relying on it as Campaign proof.

**Validation:** 81 tests pass, `npm run build` clean.

## v2.56.6 — 2026-09-13

**Restored SMS-specific disclosures to Terms/Privacy — needed for A2P 10DLC Campaign review**

- The Terms & Conditions and Privacy Policy full rewrites (v2.56.0, v2.55.0) dropped SMS-specific language the old short versions had. Twilio's A2P 10DLC guide explicitly checks for this. New Terms §22 "SMS/Text Messaging Program": frequency, "Message and data rates may apply" (verbatim), HELP/STOP instructions, and "Carriers are not liable for delayed or undelivered messages" (verbatim, required). New Privacy §15 "SMS/Text Messaging Consent Data": the exact CTIA-required sentence — "text messaging originator opt-in data and consent... won't be shared with any third parties."

**Validation:** 81 tests pass, `npm run build` clean.

## v2.56.5 — 2026-09-13

**Flow arrow: filled arrowhead for visibility**

- The arrowhead's thin open-stroke hook was too faint to read clearly at actual size. Replaced with a small solid filled shape (same grey `var(--t3)`, rounded leaf/teardrop via curved edges) — much higher contrast, reads unambiguously as a pointer. Body curve and color unchanged.

**Validation:** 81 tests pass, `npm run build` clean, browser-verified live (zoomed screenshot).

## v2.56.4 — 2026-09-13

**Reverted the flow arrow to the wobble/grey style — v2.56.3's smooth amber redesign didn't land well**

- Back to the double-curve wobble path and `var(--t3)` grey. Kept one small refinement: the arrowhead's hook curve tightened (control point pulled in, endpoints narrowed) for a slightly rounder, more finished point than the original.

**Validation:** 81 tests pass, `npm run build` clean, browser-verified live.

## v2.56.3 — 2026-09-13

**Redesigned the landing flow arrow — smoother curve, rounded amber arrowhead**

- The wobbly hand-drawn double-curve (two direction reversals) read as odd/messy rather than "sketchy." Replaced with a single smooth rising arc (one quadratic curve, no reversal) ending in a small filled rounded arrowhead (a soft leaf/teardrop shape via curved path edges, not a straight-line chevron).
- Color changed from muted grey (`var(--t3)`) to `var(--amber)` — ties the connector visually to the amber icon badges above each card instead of reading as an unrelated grey mark.

**Validation:** 81 tests pass, `npm run build` clean, browser-verified live (zoomed screenshot).

## v2.56.2 — 2026-09-13

**Fix clipped tooltips on the top-right Bug Report/Account icons**

- Both icons sat at the very top-right corner of the fixed top bar and used the plain `.tt` tooltip variant, which renders centered above the element — for an element pinned to the corner, that pushes the tooltip off both the right edge (horizontal) and the top edge (no room above a fixed bar), so it never actually became visible. Switched both to `tt tt-below tt-right`, the same edge-anchored variant already used elsewhere for corner-pinned controls (e.g. Week.jsx's Replan menu button) — tooltip now opens below and right-anchored, growing inward instead of off-screen.

**Validation:** 81 tests pass, `npm run build` clean. Not browser-verified this time — only visible in the logged-in app view, which needs Avishai's own login; worth a quick confirm once he's back in.

**Visible "BETA" tag next to the StudyOS wordmark everywhere it appears**

- The Terms of Service now says StudyOS is Beta software (v2.56.0) — this makes that visible in the product itself, not only buried in a legal document. A small "BETA" tag (dimmed `var(--t3)`, letter-spaced, clearly smaller than the gradient wordmark) now sits next to "StudyOS" in all 4 places it appears: the landing page's top-left brand mark, the auth views' (sign in/up/reset/update) centered hero, the logged-in app's top bar, and the Terms/Privacy Policy page headers. Left `app/sms-optin/page.jsx` untouched — that's an internal Twilio-verification evidence page, not part of the product experience.

**Validation:** 81 tests pass, `npm run build` clean, browser-verified live on 4 of the 5 wordmark instances (landing, auth hero, /terms — the logged-in app top bar uses the identical pattern but couldn't be visually re-verified without live credentials).

## v2.56.0 — 2026-09-13

**Full Terms & Conditions rewrite — Beta framing + real liability protection**

Replaced the short informal Terms of Service with a full, professionally-structured version (user-provided draft), matching the Privacy Policy's numbered-section style. This is what the earlier "is the current setup sufficient from a legal/liability standpoint" question resolves to — directly addresses every gap flagged then:

- **Section 2, explicit Beta framing**: "StudyOS is currently provided as a Beta service... may contain errors, incomplete functionality... should not rely on StudyOS as your sole source of academic information."
- **Section 5, no guarantee of academic results** — explicit list (grades, deadlines, passing a course, etc.) of outcomes StudyOS doesn't promise.
- **Section 16, Disclaimer of Warranties** and **Section 17, Limitation of Liability** — real liability-limiting clauses (capped at the greater of amount paid in 12 months or US $100, since the app is free that's effectively a $100 cap), not just "as is" language.
- **Section 6, minimum age (13)**, **Section 19, Termination**, **Section 21, Governing Law** (California, Santa Clara County) — all previously missing.
- Sections 3/4/10/11 tie the liability protection to the actual risk that matters most for this app: AI-generated study plans/difficulty estimates/deadline extraction can be wrong, the student remains responsible for verifying against official sources, and StudyOS doesn't authorize academic-integrity violations.
- Cross-links to `/privacy` (Section 8) and from the Privacy Policy back to Terms (Section 3) both verified working.
- Contact: StudyOS · California, United States · support@studyos.io (Privacy Policy keeps its own `privacy@studyos.io` — a standard privacy/support split).

**Validation:** 81 tests pass, `npm run build` clean, browser-verified live (scrolled the full document, all 22 sections render correctly).

## v2.55.0 — 2026-09-13

**Full Privacy Policy rewrite — comprehensive, 15 numbered sections**

Replaced the short informal Privacy Policy with a full, professionally-structured version, formatted to match the site's existing legal-page style (wordmark header, numbered sections):

1. Information We Collect (account, academic/study data, uploaded content, usage/technical, connected services)
2. How We Use Information
3. Artificial Intelligence — including a direct statement that StudyOS does not permit third-party AI providers to use personal StudyOS content to train their general-purpose models (matches Anthropic's current commercial API terms — worth Avishai re-verifying against Anthropic's terms if those ever change)
4. How We Share Information (service providers, legal disclosures)
5. Student Data — no sale to data brokers/advertisers; explicitly states StudyOS doesn't engage in CCPA/CPRA "sharing" (true — the app has no ad-tech)
6. Cookies and Analytics
7. Data Retention
8. Your Privacy Rights
9. California Privacy Rights
10. Children's Privacy (under-13 statement)
11. Data Security
12. Educational Institutions / FERPA-adjacent scoping
13. International Users
14. Changes to This Policy
15. Contact Us — StudyOS · California, United States · privacy@studyos.io

**Validation:** 81 tests pass, `npm run build` clean, browser-verified live.

## v2.54.2 — 2026-09-13

**Landing/signup polish: new 4-step flow titles, readable box text, rounder sketch arrows, checkbox wording**

- Feature box titles/order now read as an explicit flow: "Upload Your Syllabus" → "We Classify Difficulties" → "We Build Your Study Plan" → "We Assist You Daily to Track the Plan" (was "Upload your syllabus" / "Study Plan Built for You" / "Class Difficulty, Based on Research" / "Stay on Track with Daily Check-ins" — reordered so difficulty classification comes before plan-building, matching the narrative). Icons moved with their concept. Body copy under each title unchanged.
- `.feature-card-body` color `var(--t3)` → `var(--t2)` — the detail text under each box title was too low-contrast.
- `SketchArrow` redrawn: smooth `Q`-curve S-shape (was a sharper `C`-curve zigzag) and a rounded hook-shaped arrowhead (was a straight angular chevron), stroke bumped 2px → 2.5px — reads as a nicer, rounder hand-drawn mark instead of a jagged one.
- Sign up's ToS checkbox now reads "I agree to the Terms of Service and acknowledge the Privacy Policy." (was "...and Privacy Policy") — distinguishes agreeing to a contract (Terms) from acknowledging a disclosure (Privacy Policy), a distinction commonly drawn in real consent checkboxes.

**Validation:** 81 tests pass, `npm run build` clean, browser-verified live.

## v2.54.1 — 2026-09-13

**Landing: smaller headline, dropped redundant bullets, aligned feature boxes**

- "Your Personal Study Assistant" sized down again: clamp(28,3.2vw,38) → clamp(23,2.5vw,30).
- Removed the 3-item compact bullet list under the CTA — it duplicated the 4 feature boxes' own titles one screen below.
- The 4 feature boxes are now genuinely uniform: `.feature-flow` switched from `align-items:center` (each card sized to its own content, so a 2-line title made that card taller than its neighbors) to `align-items:stretch`, so the grid stretches every card to the row's tallest. On top of that, `.feature-card-title` got a fixed 2-line `min-height` so a 1-line title and a 2-line title both leave their card's body text starting at the exact same row — actual row alignment, not just matching card heights.

**Validation:** 81 tests pass, `npm run build` clean, browser-verified live.

## v2.54.0 — 2026-09-13

**Landing feature boxes: one-row flow with hand-drawn connector arrows + new copy**

- The 4 feature cards now sit in a single row (`.feature-flow`, explicit `1fr auto 1fr auto 1fr auto 1fr` grid track list) connected by a hand-drawn-style `SketchArrow` — a wobbly curved SVG path with an open chevron head, not a crisp geometric arrow — showing the syllabus→plan→difficulty→check-ins flow explicitly. Collapses to a single stacked column below 820px, with the same arrows rotated 90° so the flow still reads top-to-bottom instead of breaking.
- Cards themselves are smaller (`.feature-card-sm`: 14px/16px padding vs 20px/22px) with a tightened internal hierarchy — bold 13px title on top, 11px muted body below (`.feature-card-title`/`.feature-card-body`), smaller 30px icon badge — so four of them fit one row without crowding.
- Copy updated: "A plan built for you" → "Study Plan Built for You", "Real difficulty research" → "Class Difficulty, Based on Research", "Daily check-ins" → "Stay on Track with Daily Check-ins" (also picked up by the compact bullet list in the hero, which shares the same `FEATURES` data).

**Validation:** 81 tests pass, `npm run build` clean, browser-verified live (including a zoomed check that the arrow's hand-drawn wobble reads clearly at actual size).

## v2.53.3 — 2026-09-13

**Landing hero headline sized down**

- "Your Personal Study Assistant" from clamp(36px,4.6vw,56px) → clamp(28px,3.2vw,38px) — was overpowering the page; still the largest, most prominent text (the visual anchor), just proportionate to the rest of the hero.

**Validation:** 81 tests pass, `npm run build` clean, browser-verified live.

## v2.53.2 — 2026-09-13

**Landing hero: swapped headline hierarchy**

- "Your Personal Study Assistant" is now the big H1 (clamp(36px,4.6vw,56px)) — was a small eyebrow line above the headline. "From Syllabus to a Complete Study Plan" moved to a small uppercase amber kicker line beneath it.

**Validation:** 81 tests pass, `npm run build` clean, browser-verified live.

## v2.53.1 — 2026-09-13

**Landing page: new hero copy**

- Eyebrow: "Your Personal Study Assistant" · Headline: "From Syllabus to a Complete Study Plan" · Body: "Upload your syllabus. StudyOS understands your courses, plans your study time for the semester, and helps you stay on track every day." · Primary CTA relabeled "Sign up" → "Get Started" (user-supplied copy).

**Validation:** 81 tests pass, `npm run build` clean, browser-verified live.

## v2.53.0 — 2026-09-13

**Landing page redesign — a real product preview instead of another icon-and-caption grid**

- The previous version (v2.52.1) was a fairly generic "centered hero + 2x2 feature card" template. Replaced with a two-column layout: headline + copy + CTA on the left, and on the right an honest small preview modeled directly on the real Today tab's Deadline Awareness list (colored course dot, due-in-N badge, ✓ planned, a streak line) — made-up example content, but the identical structure the product actually shows, so a visitor sees something concrete instead of reading abstractions. A slimmer 4-item feature grid still sits below for supporting detail.
- Headline set in the display font (Syne, already used for the wordmark) instead of the body font, for more visual character: "Your syllabus, turned into a study plan." — the actual mechanic, not generic motivational copy.
- Sign up is now the clear single primary CTA (button); "Already have an account? Log in" is a plain text link beside it, instead of two equal-weight buttons competing for attention.
- Small top-left brand mark instead of a big centered logo — reads more like a product page, less like an app's splash screen.
- Auth views (sign in/up/reset/update) are completely unchanged — still their own compact layout; the ToS/Privacy checkbox stays exactly where it was, on the Sign up form, required and active.

**Validation:** 81 tests pass, `npm run build` clean, browser-verified live (landing → sign up → back via wordmark).

## v2.52.1 — 2026-09-13

**Landing page design pass — matches the polish just applied to the auth card**

- The landing view now has its own hero treatment instead of reusing the compact wordmark+tagline shared with the sign-in/sign-up views: a real headline ("Get things done, on time.", clamp(28px,4.2vw,40px)/700) plus a one-sentence supporting line grounded in what's actually built (syllabus upload → planned term → daily schedule) instead of the terse two-line tagline. Auth views (sign in/up/reset) are untouched — still the original compact version, since screen space there is shared with the form.
- Feature cards get real depth (border + shadow, new `.feature-card` class) and a subtle hover lift, plus each icon now sits in an amber badge instead of floating bare — matches the "icon in a colored box" pattern common to polished product pages.
- Log in / Sign up buttons enlarged (bigger padding/font) to read as the page's actual call to action, not incidental buttons.

**Validation:** 81 tests pass, `npm run build` clean, browser-verified live.

## v2.52.0 — 2026-09-13

**Polished the sign-in/sign-up card to look more like a real product, less like a bare form**

- Two soft brand-colored ambient glows (blue/teal, matching the wordmark gradient) behind the page instead of a flat single-tone background.
- The auth card now has real depth — a subtle border + shadow — instead of blending flat into the page.
- Heading ("Log in to your account" etc.) bumped from 15px/600 to 20px/700 with tighter letter-spacing, more presence.
- "Forgot your password?" and the "Sign up"/"Log in" switch link, both previously boxed buttons, are now plain text links (new `.link-btn` utility class) — reads as secondary actions instead of competing with the real submit button.
- The Sign up form's Terms/Privacy checkbox replaced a bare unstyled native checkbox with the app's existing custom `.chk` toggle (same pattern used elsewhere, e.g. Progress's check-in rows) — green check, consistent sizing, matches the rest of the form's styling instead of looking like a stray browser default.

**Validation:** 81 tests pass, `npm run build` clean, browser-verified live (sign-in card, sign-up card + checkbox toggle).

## v2.51.1 — 2026-09-13

**Renamed "WhatsApp" everywhere it was used — nothing actually sends via WhatsApp**

- Today tab: the "View WhatsApp message" icon/tooltip → "View daily message"; the modal title "WhatsApp Morning Message" → "Morning Message"; the WhatsApp brand icon (green) → a generic message-circle icon (neutral, matching the calendar-preview icon beside it). Its own caption already said "Sends automatically via Twilio" — corrected to "via SMS" (the user-facing channel name, not the vendor).
- Internal field names to match: `whatsAppGreeting/whatsAppLines/whatsAppClosing` → `dailyGreeting/dailyLines/dailyClosing` (AI prompt + every read site), `.wapp` CSS class → `.daily-msg`. The version-gated brief cache (`briefVersion===APP_VERSION`) means this version bump self-invalidates any stale cached brief with the old field names — no migration needed.
- Two phone-number fields were also mislabeled "WhatsApp" (Account modal, onboarding Welcome step) — relabeled "Mobile phone," matching the Sign up form's own label.

**Validation:** 81 tests pass, `npm run build` clean.

## v2.51.0 — 2026-09-12

**Landing page** (launch-readiness item 5/6) **+ a real bug the smoke test caught**

- `components/Login.jsx` had an unused `"landing"` view documented in its own header comment but never built — the app just skipped straight to the login form. Built it: hero + tagline, Log in/Sign up buttons, four feature cards grounded in what's actually built (syllabus upload, the study planner, B-01's difficulty research, daily check-ins), Terms/Privacy footer. It's now the default view for a logged-out visitor (an active `?invite=CODE` link still jumps straight to Sign up, unchanged). Clicking the wordmark from any other view returns to it.
- Browser-verified live, not just built-and-assumed: landing page, sign up form, and the invite deep-link redirect all confirmed working end-to-end.
- **Real bug found via that same smoke test**: opening the Account modal's "Invite a friend" section threw *"JSON object requested, multiple (or no) rows returned"* — `get_or_create_my_invite_code()`'s check-then-insert wasn't atomic, so two near-simultaneous calls (React's dev-mode double-effect invocation surfaced this immediately) could each decide no code existed yet and both insert one, leaving two rows for one owner. Fixed: a unique constraint on `owner_id` plus an `insert ... on conflict (owner_id) do nothing` in the function makes creation atomic; `supabase/schema.sql` also self-heals any already-existing duplicate (deletes all but the oldest) before adding the constraint, so it's safe to re-run on the now-affected production database. Client-side `getMyInviteInfo()` also hardened to read the oldest row instead of hard-erroring if this class of bug ever recurs.
- **Manual step**: re-run `supabase/schema.sql`'s `invite_codes` section (the whole file, or just that section) in the Supabase SQL Editor to apply the dedupe + constraint + fixed function.

**Validation:** 81 tests pass, `npm run build` clean, live browser smoke test (landing → sign up → invite deep-link → account modal) — the last of which is what caught the race condition above.

## v2.50.1 — 2026-09-12

**RLS audit** (launch-readiness item 4/6) — clean, two accepted risks noted

Reviewed every table's RLS policy against every actual query site in the codebase (grepped, not just recalled) ahead of real strangers' data being in the system:

- **`user_data`**: SELECT/INSERT/UPDATE all correctly scoped to `auth.uid() = user_id`, including `with check` on writes — a crafted payload claiming someone else's `user_id` is rejected at the database level, not just trusted client-side.
- **`bug_reports`**: INSERT scoped to the reporter; SELECT/UPDATE correctly split (reporter reads own, admin-by-JWT-email reads/updates all).
- **`invite_codes`**: no direct INSERT/UPDATE policy for any role at all — writes only happen through the two `security definer` functions, both with `search_path` pinned (the standard hardening against the classic SECURITY DEFINER hijack). `redeem_invite_code`'s atomic `UPDATE ... WHERE use_count < max_uses` correctly prevents a race past a code's use limit.
- **No service-role key anywhere in the codebase** — confirmed by grep, not assumption.
- **Single signup entry point** — `components/Login.jsx` is the only `auth.signUp()` call site, so the ToS/invite gates can't be bypassed via another path.
- Fixed in passing: `.env.template` never actually listed `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`, despite the app requiring them.

**Two accepted risks, not fixed now** (noted in `CLAUDE.md`'s backlog):
1. Admin-seeded invite codes (`owner_id` null, e.g. `STUDYOS2026`) have no matching SELECT policy — their usage count isn't visible in-app, only via the Supabase dashboard directly. Not a leak, just a gap.
2. `redeem_invite_code` has no rate-limiting and is callable pre-auth — a scripted attacker could hammer it. Self-generated codes (~4.3 billion combinations) are impractical to brute-force; the human-shared launch code is a static secret with the usual sharing risk. Accepted for this launch's scale; revisit if abuse actually shows up.

**Validation:** 81 tests pass, `npm run build` clean.

## v2.50.0 — 2026-09-12

**Invite-gated signup + invite-a-friend links** (launch-readiness item 3/6)

- Sign up now requires a valid **invite code** — redeemed *before* the account is created, so an invalid/exhausted code never leaves an orphaned auth user behind. This is the cost/abuse gate ahead of wider sharing (Anthropic + Twilio usage isn't free), combined with a real feature: any signed-in user gets their own shareable invite link.
- **Account modal** → new "Invite a friend" section: your link (`studyos.app/?invite=CODE`), a Copy button, and how many people have used it out of its cap.
- Following a shared link (`?invite=CODE`) auto-fills the code and jumps straight to the Sign up view — one click, not "figure out where this goes."
- No service-role key or backend route: two Postgres `security definer` functions (`supabase/schema.sql`) do the only two things anyone's allowed to do — redeem one code atomically (so two people can't race past its use limit), or create-or-fetch the caller's own code. Reading your *own* code (for the Account modal display) goes through a plain RLS-gated table read; nothing ever exposes another user's code or full table.
- **Manual steps**: run the new `invite_codes` section of `supabase/schema.sql` in the Supabase SQL Editor, then seed at least one starting code (the file's last line has a ready-to-run example, e.g. `STUDYOS2026`) so the very first signups have something to use before anyone's generated their own.

**Validation:** 81 tests pass, `npm run build` clean. (No new unit tests — this feature is mostly thin wrappers over live Supabase RPC/table calls, same as the bug-reporting and password-change flows; verify live once the SQL is applied.)

## v2.49.0 — 2026-09-12

**Bug reporting + admin Bug Reports tab, one implementation** (launch-readiness item 2/6)

- New 🐛 icon in the top bar (next to Account, visible once onboarded) opens a small form — describe what happened, current tab and app version are captured automatically. Writes to a new `bug_reports` Supabase table (`lib/bugReports.js`).
- New **Bug Reports** tab, visible only to `lib/constants.js`'s `ADMIN_EMAILS` — lists Open reports first, Resolved below, with a one-click Resolve/Reopen toggle. No custom backend route or service-role key: `supabase/schema.sql`'s RLS policies enforce at the database level that only the reporter (their own rows) or the admin email (all rows) can read anything — a non-admin literally cannot query other users' reports, regardless of client code.
- **Manual step required**: run the new `bug_reports` section of `supabase/schema.sql` in the Supabase SQL Editor before this works in production — it wasn't auto-applied.

**Validation:** 81 tests pass, `npm run build` clean.

## v2.48.0 — 2026-09-12

**Signup now requires agreeing to Terms of Service + Privacy Policy** (launch-readiness item 1/6)

- First of the pre-launch checklist ahead of Itay's new term and wider student sharing: the Sign up form now has a required checkbox — "I agree to the Terms of Service and Privacy Policy," linking to the existing `/terms` and `/privacy` pages (opened in a new tab) — and **Create account** stays disabled until it's checked.
- Consent is also recorded on the account itself: `tos_agreed_at` (ISO timestamp) is stored in the user's Supabase auth metadata alongside `full_name`/`phone` at signup — a durable record of when each user actually agreed, not just a client-side gate.
- Re-checked inside `signUp()` itself, not just via the disabled button, since a form submit via Enter can bypass a disabled button.

**Validation:** 81 tests pass, `npm run build` clean.

## v2.47.2 — 2026-09-12

**Academics now lands on the Courses tab by default**

- Opening Academics previously defaulted to the Assignments sub-tab. Now defaults to Courses.

**Validation:** 81 tests pass, `npm run build` clean.

## v2.47.1 — 2026-09-12

**Moved "Reset academic data" into the Update Syllabus tab's header**

- Was sitting in the shared tab-bar row, visible no matter which Academics sub-tab was open. Moved into the **Update Syllabus** section's own title row (right side) — it's a destructive action about the term's academic data as a whole, and syllabus sync is where a student would reasonably go to start over.

**Validation:** 81 tests pass, `npm run build` clean.

## v2.47.0 — 2026-09-12

**Deterministic difficulty/hours consistency check + a "?" help on the Courses tab**

- New gap: `difficultyScore` and `weeklyHours` come back together in one AI response with no guarantee the two are actually coherent — nothing stopped a re-research from claiming "Heavy" with an implausibly low hours number, or vice versa, especially across two separate research calls for the same course.
- `expectedHoursRange(difficultyScore)` (`lib/planner/estimate.js`) is a plain, deterministic lookup table — Light/Medium/Heavy/Intense bands each mapped to a loose plausible weekly-hours window — used only as a sanity check, never to override anything. Wired into `ResearchPreview`: an ⚠ appears next to the hours pill when a fresh result's hours fall outside the expected range for its own difficulty score, with a tooltip explaining the mismatch. It never blocks Apply — it's a nudge to read the rationale before trusting the number. 3 new unit tests cover the bands and their boundaries.
- New **?** button on the Courses tab (matches the existing Study Preferences help) explaining the whole B-01 concept in one place: what difficulty score and weekly hours mean (and why they only loosely track each other), how to read the confidence/rationale tooltip, what the new unusual-combination flag means, and what re-researching does.

**Validation:** 81 tests pass (78 + 3 new), `npm run build` clean.

## v2.46.13 — 2026-09-12

**Lighter `--blue` token for better contrast on dark card backgrounds**

- `--blue` (#6aace0) had a measured contrast ratio of only ~2.9:1 against the `--card2` background (below WCAG AA's 3:1 floor even for large text/icons) and ~3.6:1 against `--card` — plain blue text/icons sitting directly on either surface (no own background chip, unlike `badge-blue`'s own dark `--blue-bg` pill) read as washed out, which is what showed up in the new re-research strip.
- Lightened it to `#8ec4f0` — contrast improves to ~3.8:1 on `--card2` and ~4.8:1 on `--card` (now meets AA for large text/UI components), and `badge-blue` text-on-pill contrast rises from ~6.9:1 to ~9:1. One CSS variable, so every use (badge-blue, `.sec-title` icons, `.card-accent` left border, stat dots) picks it up automatically — no per-component changes.

**Validation:** 78 tests pass, `npm run build` clean.

## v2.46.12 — 2026-09-12

**Re-research: "Confirm" instead of "Apply & Replan" when nothing actually changed**

- When a re-research comes back identical to the current estimate, the action button now reads **Confirm** (check icon) instead of **Apply & Replan** (sparkles), with a small "no replan needed" note beside it — since there's genuinely nothing for a replan to apply. `applyResearchAndReplan` already skipped the actual replan step in this case (v2.46.6); this just makes the button say what it's about to do.
- Toast on confirming an unchanged estimate now reads "Estimate confirmed — nothing changed" instead of the generic "Difficulty updated."

**Validation:** 78 tests pass, `npm run build` clean.

## v2.46.11 — 2026-09-12

**Re-research preview: full-bleed shaded strip, badges aligned under the row above, background-fill highlight**

- `ResearchPreview` is now a shaded strip (background color only, no border) that bleeds edge-to-edge with the card — a negative margin exactly cancels the card's own side padding, so once the strip's own padding is added back, its first badge lands at the same x position as the Difficulty badge in the row above it. New values sit exactly under the old ones, same order, same gap.
- Two lines: values + actions on line 1, the rationale sentence (when there is one) on line 2 underneath.
- Changed-field highlight is now a **background fill** (switches the pill to the amber badge style, same as Weekly hours/Exam prep already did) instead of an outline ring — Difficulty gets the same treatment when it changes.
- The **X** (cancel) now has more breathing room from **Apply & Replan** and is bigger (22px → 30px, 15px → 18px icon).

**Validation:** 78 tests pass, `npm run build` clean.

## v2.46.10 — 2026-09-12

**Re-research preview: plain line instead of a nested box, badges mirror the row above exactly, X to cancel**

- `ResearchPreview` no longer renders as a bordered/background panel ("a box in a box") — it's now a plain second line, same gap/wrap/alignment as the course's existing badge row directly above it, so the new Difficulty/Weekly-hours/Exam-prep badges sit exactly under the old ones.
- Dropped the arrow-comparison and "no change" tags from v2.46.6–.8 — with the new row sitting directly under the old one, position alone shows old vs new; only fields that actually changed get an amber highlight ring, so the eye goes straight to what moved.
- "Keep current estimate" text button replaced with a small **X** at the right, next to "Apply & Replan" — both actions now sit at the end of that one line.
- Confidence + rationale moved into the confidence badge's tooltip, matching how the course's own confidence badge (row above) already works, instead of a separate caption line.

**Validation:** 78 tests pass, `npm run build` clean.

## v2.46.9 — 2026-09-12

**Re-research result now expands inline under the course, not a popup modal**

- Replaced `ReResearchModal` (a centered popup) with `ResearchPreview` — an inline panel that expands directly under the course's own badge row in Academics → Courses, right where the Difficulty/Weekly-hours/Exam-prep badges it's about to update already are.
- Same field order as the badges above it (Difficulty, Weekly hours, Exam prep), same old→new pill treatment and "no change" tag per field from v2.46.8 — just laid out inline instead of in a dialog.
- Actions (**Keep current** / **Apply & Replan**) sit on the right of the panel, one line, no popup chrome or backdrop to dismiss.
- Confidence + rationale now show as a caption line under the fields instead of a header/quote block.

**Validation:** 78 tests pass, `npm run build` clean.

## v2.46.8 — 2026-09-12

**Every row in the re-research modal now says explicitly "changed" or "no change"**

- An unchanged Weekly hours/Exam prep row previously rendered as a single bare pill — same as a changed row's "new" pill, with nothing distinguishing "this is new" from "this didn't move." Now every unchanged row carries a small muted ✓ "no change" tag next to the pill, same treatment for Difficulty too, so all three rows explain their own result instead of only the changed ones speaking up.

**Validation:** 78 tests pass, `npm run build` clean.

## v2.46.7 — 2026-09-12

**Re-research modal cleanup + bigger, highlighted research button**

- `ReResearchModal`: Weekly hours and Exam prep now render as pills (old dimmed, new colored — amber only when actually changed), matching the Difficulty row's badge treatment instead of plain colored text — all three parameters read consistently now.
- Dropped the middle "Apply, replan later" option — just **Keep current estimate** and **Apply & Replan**, one line in the footer. (Apply & Replan now skips the actual replan step when nothing changed, since there'd be nothing for it to apply.)
- Added an **X** close button top-right of the header — same effect as "Keep current estimate" (discards the fresh result, applies nothing).
- The circular "Re-research this course's difficulty" button (Academics → Courses) was easy to miss — bumped from 22px to 28px and given an amber border/background so it reads as an available action, not a stray icon in the badge row.

**Validation:** 78 tests pass, `npm run build` clean.

## v2.46.6 — 2026-09-12

**Re-research now opens a review modal (old vs new, highlighted, Apply & Replan) instead of silently overwriting**

- v2.46.5 made a re-research flag the plan stale so the student *could* notice something needed attention — but they still had to go find it. This goes further: "Re-research this course's difficulty" (Academics → Courses) no longer writes the new estimate straight onto the course. It fetches the fresh web-search result, then opens `ReResearchModal` for review before anything is saved:
  - **Difficulty**, **Weekly hours**, and **Exam prep days** shown old → new, with an arrow and amber highlight only on whatever actually changed (a search that confirms the existing estimate shows no arrows and says so).
  - The confidence pill and rationale sentence from the search are shown too, same content as the tooltip badge, but now with the numbers it's judging.
  - Three ways to close it: **Keep current estimate** (discard the new numbers, nothing saved), **Apply, replan later** (saves it, flags `planStale` same as before), or **Apply & Replan** (saves it and immediately runs the full replan, mirroring the Sync-result modal's "Create study plan" flow).
- If the search just confirms the existing numbers, applying doesn't flag `planStale` or suggest a replan — nothing actually changed for the planner to react to.

**Validation:** 78 tests pass, `npm run build` clean.

## v2.46.5 — 2026-09-12

**Re-researching a course now flags the plan stale, and it's visible in Difficulty + Weekly**

- **Gap found**: clicking "Re-research this course's difficulty" (B-01) could change a course's weekly hours/difficulty estimate, but nothing signaled that the current plan was built on the old numbers — the student had to know to go hit Save & Replan on their own.
- `reResearchCourse` (Academics → Courses) now sets `planStale:true` on a changed estimate, same flag `setHoursOverride`/`saveDifficulty` already use — so the existing machinery lights up for free:
  - Academics → **Difficulty** tab's Save & Replan button (already amber-highlighted on `planStale`) and its "Current plan doesn't reflect your latest saved changes" banner now also trigger from a re-research, not just a manual hours edit.
  - Academics tab bar: the small red dot on the **Difficulty** tab (previously only for unsaved draft edits) now also lights up when `planStale`.
  - **Weekly view** (new): an amber dot on the "Plan status & diagnostics" stethoscope icon, and on the **Replan** button itself, when `planStale` — plus both tooltips explain why ("new estimates saved, not yet applied").
- Toast on re-research now says "...Save & Replan to apply the new estimate" instead of just "...difficulty updated".

**Validation:** 78 tests pass, `npm run build` clean.

## v2.46.4 — 2026-09-12

**Remove redundant "h" unit label in Difficulty table's Hours column**

- The Hours column of the Difficulty/Study Preferences table showed a small "h" after each hours input (e.g. "6 h") — redundant since the column header already reads "Hours". Removed it; the separate "↺ Xh" reset-to-suggested button (which needs the unit for context, since it stands alone next to the input) is unchanged.

**Validation:** 78 tests pass, `npm run build` clean.

## v2.46.3 — 2026-09-12

**Fix `.list-item` CSS (checkbox/title stacking) + generalize hardcoded "UCSD" labels**

- **Real bug found**: `.list-item` — the class used for every checkbox+title+badge row in Progress, History, Onboarding, and Preferences — had **no CSS definition anywhere**. Without `display:flex`, rows silently stacked in block flow (checkbox on its own line above the title) instead of sitting on one line. Added the missing rule (`app/globals.css`) once, fixing all four components' list rows at the source instead of patching each call site.
- **Generalized 3 hardcoded "UCSD" strings** in `components/Prog.jsx` (a stat card label, a habit-score message, and the "Readiness" section title) to generic "College ready" / "College-ready" / "College Readiness" — the underlying milestones (study streak, check-ins, gym habit, completion rate, exam prep) were already 100% generic; only the copy was wrongly locked to one school. Matches the standing non-school-specific principle.

**Validation:** 78 tests pass, `npm run build` clean. Browser-verified: Evening Check-in and College Readiness rows now sit on one line; Preferences → Gym Schedule rows (same CSS class) also confirmed fixed with no regression.

## v2.46.2 — 2026-09-12

**Collapse-all moved into the title row (icon-only) + Re-research course button**

Two follow-ups from the grouped Difficulty table:

- **Collapse/Expand-all** was its own full-width row above the table — moved into the Study Preferences title row alongside Save/Save & Replan/Help, as an icon-only circular button (chevrons, `data-tt` tooltip: "Collapse all classes" / "Expand all classes"), matching that row's existing convention instead of introducing a new one.
- **"Re-research this course" button** (Academics → Courses): a small icon next to each course's difficulty badges that re-runs the B-01 web-search lookup on an *existing* course and updates it in place — courses created before B-01 shipped (or anytime you want a refresh) get real confidence data without deleting/re-adding anything. Spinner while in flight, never touches assignments/exams/grades.

**Validation:** 78 tests pass, `npm run build` clean. Browser-verified end-to-end, including a live re-research call: DSC 10's difficulty updated in place (6→5/10, 6h→8h/wk) with a new "medium confidence" badge and full rationale in the tooltip.

## v2.46.1 — 2026-09-12

**Study Preferences (Difficulty tab): grouped by class, foldable**

The Class column repeated the same text on every row — wasted width, and directly worked against a mobile-friendly future. Replaced with foldable per-class sections.

- **Class column removed.** Rows now sit under a class-header row (color dot + name + item count + next-due date), foldable by clicking it.
- **Groups start fully expanded** on entering the tab; folding is a per-viewer, per-session preference (`sessionStorage`) — survives switching between tabs, resets to all-expanded on a fresh visit so a stale fold state from days ago never causes confusion.
- **"Collapse all" / "Expand all"** control. Fully collapsed, the table is just N one-line class summaries — exactly the compact overview requested.
- Fold indicator is both a chevron icon and small "See more"/"See less" text, not icon-only.
- **Sorting still works globally, just reorganized**: the Due/Weight/Priority sort now orders each class's *rows*, and the *groups themselves* are ordered by their own most-urgent item under that same criterion — so "what needs attention first" still surfaces immediately, just grouped by class instead of interleaved row-by-row.

**Validation:** 78 tests pass, `npm run build` clean. Browser-verified: grouping/folding/collapse-all all work, fold state survives a Today→Academics round-trip (sessionStorage), no console errors.

## v2.46.0 — 2026-09-12

**B-01: web-researched course difficulty**

`/api/course-info` now runs real web search (grades/workload discussion, reviews) instead of pure model guesswork, and self-reports how much it actually found — real CAPE-style data is usually login-gated, so the estimate is honest about its own confidence rather than presented as fact.

- **`/api/course-info`**: added the `web_search_20250305` tool; removed the hardcoded "De Anza College" (now takes the student's real `schoolName`); response now includes `confidence` (low/medium/high) and a one-sentence `rationale`. JSON extraction pulls the `{...}` object out of the model's final text block rather than assuming the whole block is clean JSON — live-tested, the model does sometimes preface it with a sentence.
- **`CI()`** (`lib/api.js`) takes a `school` param, forwarded from both call sites (`Onboard.jsx` schedule import, `Acad.jsx` syllabus sync) — still one call per *new course*, not per assignment.
- **Academics → Courses**: a small confidence badge (🔍 *low/medium/high confidence*) next to each course's difficulty, tooltip carrying the rationale. Inline with the existing badge row — no new column, wraps naturally on narrow/mobile widths.
- **Removed `webDifficultySignal()`** — a per-assignment stub from an earlier design superseded by researching the course once, at creation time (what `course.difficulty` already reflects). Dead code, no behavior change.

**Validation:** 78 tests pass, `npm run build` clean, **live-tested against the real endpoint**: a real UCSD course returned `high` confidence with a specific cited rationale (found actual syllabi); a fabricated course/school correctly returned `low` confidence with an honest "nothing found" rationale. Browser-verified no regression on existing (pre-B-01) courses.

## v2.45.6 — 2026-09-12

**Warn when a new/edited term overlaps the current one**

`getActiveTermAndSchool()`/`termScopedForPlanning()` only ever treat ONE term as "current" — an overlap between two terms doesn't merge planning across both, it silently drops one term's courses. This is the same bug class that originally broke Itay's account (a dateless term), just via a different door.

- **`datesOverlap()`** (`lib/data/terms.js`) — pure inclusive-range overlap check, 5 new tests.
- **School Info → Add term / Edit term**: if the dates overlap the term currently driving the planner, a confirm dialog explains why before saving — worded differently for same-school (almost always a mistake) vs. cross-school (a real scenario like dual enrollment/study abroad, but one the planner can't actually schedule across yet). Not a hard block — "Continue anyway" still works, since the student may have a real reason.

**Tabled for backlog:** true concurrent multi-term planning (scheduling two simultaneously-active terms together, e.g. dual enrollment) — a real, bigger feature, not a validation tweak.

**Validation:** 78 tests pass, `npm run build` clean, full flow browser-tested (overlap warning fires correctly, Cancel aborts cleanly with form data preserved).

## v2.45.5 — 2026-09-12

**Public SMS opt-in evidence page, for A2P Campaign re-submission**

Twilio rejected the Campaign for "issues verifying the Call to Action" — the Google Drive screenshot link given as evidence apparently couldn't be reliably verified. Replaced it with a same-domain page instead of a third-party file host.

- **`/sms-optin`** — new public, unauthenticated page: describes the real in-app opt-in flow step by step, and embeds a screenshot of the live consent screen (phone field, frequency/rate disclosure, STOP/HELP, ToS/Privacy links, checked consent box, submit button). Links to `/terms` and `/privacy`, same as the flow itself does.
- The screenshot uses a **placeholder phone number**, not the real account's — the original capture briefly showed the real number, caught before publishing and re-shot with `+15551234567` after temporarily swapping the field (restored to the real number immediately after, verified).

**Next:** resubmit the Campaign with the CTA/consent-evidence field pointing to `https://www.studyos.io/sms-optin` instead of the Drive link.

**Validation:** 73 tests pass, `npm run build` clean, page verified locally.

## v2.45.4 — 2026-09-11

**Account modal: minimal, unified styling**

- Removed the "Danger zone" uppercase label above Reset all data — it was the only section in the modal with that kind of heading; Change password and Sign out sit as plain bordered sections with no label, so Reset now matches.
- Reset's password field was a bare `<input type="password">` sitting right below Change Password's eye-toggle fields — swapped it for the same `PasswordInput` component, plus a `<label>` matching the Change Password fields' formatting.
- Added Enter-to-submit on both password flows' last field (`PasswordInput` now forwards `onKeyDown`/`autoFocus`).

**Validation:** 73 tests pass, `npm run build` clean, browser-verified.

## v2.45.3 — 2026-09-11

**Change password, in Account**

- New **"Change password"** action in the Account modal: current password (re-verified via `signInWithPassword`, same trick used for the reset-data gate — Supabase has no separate password-check call), new password (min 8 chars), confirm — then `updateUser({password})`.
- `PasswordInput` (the show/hide eye-toggle field from Login) is now a shared component (`components/shared/ui.jsx`) instead of living only inside `Login.jsx`, so the Account modal reuses the exact same field.

**Validation:** 73 tests pass, `npm run build` clean. Browser-verified: form renders in the right place (between account details and Sign out), eye toggle works, Login screen unaffected by the refactor.

## v2.45.2 — 2026-09-11

**"Reset all data" moved to Account, now password + are-you-sure gated**

Was a plain button at the bottom of Preferences with a single confirm dialog — too easy to hit by accident given what it does (wipes courses, assignments, exams, grades, plan, history, and preferences back to a blank slate).

- Moved into the **Account modal**, under a new **Danger zone** section below Sign out.
- **Two real gates**: (1) re-enter your account password — checked via `signInWithPassword` (Supabase has no separate "verify password" call, so re-authenticating *is* the check); wrong password stops it right there. (2) An explicit are-you-sure naming exactly what gets erased.
- Resets data only — the Supabase login/account itself is never touched, so this can't lock anyone out.

**Validation:** 73 tests pass, `npm run build` clean. Browser-verified: button gone from Preferences, present in Account's Danger zone, wrong password correctly rejected before anything happens (didn't test a real erase against the live account).

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
