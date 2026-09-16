# StudyOS Changelog

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

