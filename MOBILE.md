# Sub-project: Web-Mobile Enablement

Tracking table for enabling mobile access. All fixes here are additive — implemented via
`@media (max-width: …)` breakpoints or a viewport-width check — so **desktop rendering is
unaffected above the breakpoint**. This is a responsive-web pass, not a redesign: no native app,
no PWA yet (that's a cheap follow-on once this list is done — an installable icon + offline shell,
no architecture change).

- **Priority** — Essential · Medium · Nice-to-have · Deferred
- **Effort** — Low (hours) · Mid (part of a day) · High (multi-day / real redesign)
- **Status** — Not started · In progress · Done

## Priority table

| # | Item | Priority | Effort | Status | Notes |
|--:|------|----------|:------:|--------|-------|
| 1 | `.g2/.g3/.g4` grid collapse | Essential | Low | Not started | One CSS media-query fix — cascades to Preferences, Onboarding wizard, and Account modal at once (all currently crush inputs into ~80px columns on phone) |
| 2 | Weekly: auto-default to Day/agenda mode on narrow screens | Essential | Low | Not started | Reuses the existing single-day Timeline view already built (`mode==="day"` in Week.jsx) — just changes the default under a width check, no new UI |
| 3 | Top nav fix (currently clips tabs off-screen) | Essential | Low–Mid | Not started | `overflowX:"hidden"` on the tab row means excess tabs are invisible + unreachable on narrow screens, not just hard to tap — real blocker, not polish |
| 4 | Today tab verification + touch-target pass | Essential | Low | Not started | Already a responsive card stack (`auto-fit,minmax` stat grid) — confirm live at phone width, bump 28px tap targets where cramped |
| 5 | Onboarding wizard step-bar check | Medium | Low–Mid | Not started | Inherits #1 automatically; step-bar's 8 circular icons + connectors may need a wrap/shrink check |
| 6 | Account modal verification | Medium | Low | Not started | Inherits #1 automatically, likely fine after that alone |
| 7 | Progress tab verification | Nice-to-have | Low | Not started | Same responsive patterns as Today, likely already close to fine |
| 8 | History tab | Low priority | Low | Not started | Already benefits from the earlier `.list-item` CSS fix; rarely used |
| 9 | School Info tab | Low priority | Low | Not started | Occasional-use form; inherits #1 "for free" |
| 10 | Academics tables (Courses/Assignments/Difficulty) — real mobile redesign | Medium value, **deferred** | High | Deferred | Already has a working `overflow-x:auto` fallback — usable in a pinch today. A real card-based mobile redesign is a bigger project, not v1 |

## Confirmed already in reasonable shape (no action needed yet)

- **Login / Signup / landing page** — built with real responsive patterns (`repeat(auto-fit,minmax(...))` grids, `clamp()` sizing, a centered card that shrinks to fit). Not live-verified at actual phone width yet — worth a real check on a device once items 1–4 land.

## Session log

- 2026-09-13 — List created, prioritized, and confirmed with Avishai. Nothing built yet.
