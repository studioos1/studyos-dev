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
| 1 | `.g2/.g3/.g4` grid collapse | Essential | Low | **Done (v2.57.0)** | Below 480px, stacks to one column — cascades to Preferences, Onboarding wizard, and Account modal at once |
| 2 | Weekly: auto-default to Day/agenda mode on narrow screens | Essential | Low | **Done (v2.57.0)** | Below 768px, defaults into the existing single-day Timeline view (`mode==="day"` in Week.jsx) instead of forcing the grid |
| 3 | Top nav fix (currently clips tabs off-screen) | Essential | Low–Mid | **Done (v2.57.0)** | `overflowX` hidden → auto + `flexShrink:0` per tab — scrolls into view instead of being clipped invisible |
| 4 | Today tab verification + touch-target pass | Essential | Low | Not started | Already a responsive card stack (`auto-fit,minmax` stat grid) — confirm live at phone width, bump 28px tap targets where cramped |
| 5 | Onboarding wizard step-bar check | Medium | Low–Mid | Not started | Inherits #1 automatically; step-bar's 8 circular icons + connectors may need a wrap/shrink check |
| 6 | Account modal verification | Medium | Low | Not started | Inherits #1 automatically, likely fine after that alone |
| 7 | Progress tab verification | Nice-to-have | Low | Not started | Same responsive patterns as Today, likely already close to fine |
| 8 | School Info tab | Low priority | Low | Not started | Occasional-use form; inherits #1 "for free" |
| 9 | Academics tables (Courses/Assignments/Difficulty) — real mobile redesign | **Essential** (sequenced last — high effort) | High | Deferred | Genuinely important — it's just the one item that needs a real card-based redesign, not a quick fix. Has a working `overflow-x:auto` fallback in the meantime, usable in a pinch |
| 10 | History tab | **Lowest priority** | Low | Not started | Already benefits from the earlier `.list-item` CSS fix; rarely used |

## Confirmed already in reasonable shape (no action needed yet)

- **Login / Signup / landing page** — built with real responsive patterns (`repeat(auto-fit,minmax(...))` grids, `clamp()` sizing, a centered card that shrinks to fit). Not live-verified at actual phone width yet — worth a real check on a device once items 1–4 land.

## Session log

- 2026-09-13 — List created, prioritized, and confirmed with Avishai. Nothing built yet.
- 2026-09-13 — Items #1–3 shipped (v2.57.0). Desktop verified unaffected live. Narrow-viewport rendering itself not yet visually verified — the browser resize tool wasn't working in this session's environment; needs a real check on an actual phone before considering these fully confirmed.
