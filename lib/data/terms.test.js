import { describe, it, expect } from "vitest";
import { repairTermLinkageIfNeeded, migrateLegacyTermIfNeeded, datesOverlap, canDeleteTerm, computeTermStatuses, migrateTermStatusIfNeeded, syncActiveTermToProfilePatch, backfillTermsInitializedIfNeeded, scrubTermSchedule } from "./terms";

// Term end far in the future — status is now a stored field (not date-derived), so the fixture
// term is explicitly marked "current" rather than relying on date math to make it so.
const FUTURE = "2099-06-01";
const mk = (over = {}) => ({
  profile: { termStart: "2026-08-22", termEnd: FUTURE, schoolName: "u" },
  schools: [{ id: "sch1", name: "u" }],
  terms: [{ id: "term1", schoolId: "sch1", name: "Fall", start: "2026-08-22", end: FUTURE, status: "current" }],
  courses: [{ id: "c1", name: "MATH 180A", termId: "term1" }],
  assignments: [], exams: [],
  ...over,
});

describe("repairTermLinkageIfNeeded", () => {
  it("no-op when the term has dates and every course is linked", () => {
    expect(repairTermLinkageIfNeeded(mk())).toBeNull();
  });

  it("links orphan courses (termId null) to the current term", () => {
    const fix = repairTermLinkageIfNeeded(mk({
      courses: [{ id: "c1", name: "MATH 180A", termId: null }, { id: "c2", name: "DSC 10" }],
    }));
    expect(fix.courses.every(c => c.termId === "term1")).toBe(true);
    expect(fix.terms).toBeUndefined(); // dates were fine
  });

  it("fills a dateless term from the profile, then links courses", () => {
    const fix = repairTermLinkageIfNeeded(mk({
      terms: [{ id: "term1", schoolId: "sch1", name: "Current term", start: "", end: "", status: "current" }],
      courses: [{ id: "c1", name: "MATH 180A", termId: null }],
    }));
    expect(fix.terms[0].start).toBe("2026-08-22");
    expect(fix.terms[0].end).toBe(FUTURE);
    expect(fix.courses[0].termId).toBe("term1");
  });

  it("relinks a course pointing at a term that no longer exists", () => {
    const fix = repairTermLinkageIfNeeded(mk({
      courses: [{ id: "c1", name: "MATH 180A", termId: "term_deleted" }],
    }));
    expect(fix.courses[0].termId).toBe("term1");
  });

  it("returns null when there are no terms to link to", () => {
    expect(repairTermLinkageIfNeeded(mk({ terms: [] }))).toBeNull();
  });
});

describe("migrateLegacyTermIfNeeded", () => {
  const legacy = (profileOver = {}, over = {}) => ({
    onboarded: false,
    terms: [],
    courses: [],
    profile: {
      schoolName: "UCSD", termName: "Fall 2026",
      termStart: "2026-09-25", termEnd: "2026-12-12",
      ...profileOver,
    },
    ...over,
  });

  it("does nothing until school + term name + both dates are all present", () => {
    expect(migrateLegacyTermIfNeeded(legacy({ termStart: "" }))).toBeNull();
    expect(migrateLegacyTermIfNeeded(legacy({ schoolName: "" }))).toBeNull();
  });

  it("waits for the Term step to be saved during first-run onboarding", () => {
    expect(migrateLegacyTermIfNeeded(legacy())).toBeNull(); // onboarded:false, no onboardTermSaved
    const patch = migrateLegacyTermIfNeeded(legacy({ onboardTermSaved: true }));
    expect(patch.terms).toHaveLength(1);
    expect(patch.terms[0].name).toBe("Fall 2026");
    expect(patch.schools[0].name).toBe("UCSD");
  });

  it("still migrates an already-onboarded legacy account with no onboarding flags", () => {
    const patch = migrateLegacyTermIfNeeded(legacy({}, { onboarded: true }));
    expect(patch.terms[0].name).toBe("Fall 2026");
  });

  it("marks the synthesized term Current — it's the account's one existing active term", () => {
    const patch = migrateLegacyTermIfNeeded(legacy({}, { onboarded: true }));
    expect(patch.terms[0].status).toBe("current");
  });

  it("uses termName over the college-calendar quarter name", () => {
    const patch = migrateLegacyTermIfNeeded(legacy({
      onboardTermSaved: true,
      collegeCalendar: { quarters: [{ name: "Autumn Quarter" }] },
    }));
    expect(patch.terms[0].name).toBe("Fall 2026");
  });

  it("marks termsInitialized so a later deletion can never re-trigger this migration", () => {
    const patch = migrateLegacyTermIfNeeded(legacy({}, { onboarded: true }));
    expect(patch.termsInitialized).toBe(true);
  });

  // Real, shipped bug: "I deleted all terms, and still showing term." Deleting the last term
  // leaves terms:[] while the profile mirror fields are still present (cleared by a separate,
  // independently-timed effect) — this function used to read that as "legacy account, not yet
  // migrated" and resynthesized a brand-new term from the stale fields, resurrecting the term the
  // student just deleted. `termsInitialized` is a permanent, one-way marker precisely so this
  // never happens again, no matter what the profile mirror still says.
  it("never resurrects a deleted term — termsInitialized blocks migration even with terms:[] and stale legacy profile fields", () => {
    const data = legacy({ onboardTermSaved: true }, { onboarded: true, termsInitialized: true });
    expect(migrateLegacyTermIfNeeded(data)).toBeNull();
  });
});

describe("backfillTermsInitializedIfNeeded", () => {
  it("flags an account that already has a term but predates the termsInitialized marker", () => {
    const data = { terms: [{ id: "t1", status: "current" }] };
    expect(backfillTermsInitializedIfNeeded(data)).toEqual({ termsInitialized: true });
  });

  it("no-op once already flagged", () => {
    const data = { terms: [{ id: "t1", status: "current" }], termsInitialized: true };
    expect(backfillTermsInitializedIfNeeded(data)).toBeNull();
  });

  it("no-op when there are no terms yet — nothing to protect, and a genuinely legacy account must still be able to migrate", () => {
    expect(backfillTermsInitializedIfNeeded({ terms: [] })).toBeNull();
  });
});

describe("datesOverlap", () => {
  it("true when ranges genuinely overlap", () => {
    expect(datesOverlap("2026-09-01", "2026-12-01", "2026-11-15", "2027-01-15")).toBe(true);
  });
  it("true when one range fully contains the other", () => {
    expect(datesOverlap("2026-01-01", "2026-12-31", "2026-06-01", "2026-06-30")).toBe(true);
  });
  it("true when ranges touch on a shared boundary day", () => {
    expect(datesOverlap("2026-09-01", "2026-12-01", "2026-12-01", "2027-03-01")).toBe(true);
  });
  it("false for genuinely back-to-back, non-overlapping ranges", () => {
    expect(datesOverlap("2026-09-01", "2026-11-30", "2026-12-01", "2027-03-01")).toBe(false);
  });
  it("false when either range is missing a date", () => {
    expect(datesOverlap("", "2026-12-01", "2026-11-15", "2027-01-15")).toBe(false);
    expect(datesOverlap("2026-09-01", "2026-12-01", "2026-11-15", "")).toBe(false);
  });
});

describe("canDeleteTerm", () => {
  const upcoming = { id: "term_up", status: "upcoming" };
  const current = { id: "term_cur", status: "current" };
  const archived = { id: "term_done", status: "archived" };

  it("deletable: an upcoming term with no attached courses", () => {
    expect(canDeleteTerm(upcoming, [])).toEqual({ deletable: true, reason: null });
  });

  it("blocked: a current term, even with no courses", () => {
    const r = canDeleteTerm(current, []);
    expect(r.deletable).toBe(false);
    expect(r.reason).toMatch(/current/);
  });

  it("blocked: an archived term", () => {
    const r = canDeleteTerm(archived, []);
    expect(r.deletable).toBe(false);
    expect(r.reason).toMatch(/archived/);
  });

  it("blocked: an upcoming term with one attached course — singular wording", () => {
    const r = canDeleteTerm(upcoming, [{ id: "c1", termId: "term_up" }]);
    expect(r.deletable).toBe(false);
    expect(r.attachedCourses).toBe(1);
    expect(r.reason).toMatch(/1 course/);
    expect(r.reason).not.toMatch(/courses/); // singular, not "1 courses"
  });

  it("blocked: an upcoming term with multiple attached courses — plural wording", () => {
    const r = canDeleteTerm(upcoming, [
      { id: "c1", termId: "term_up" }, { id: "c2", termId: "term_up" },
    ]);
    expect(r.deletable).toBe(false);
    expect(r.attachedCourses).toBe(2);
    expect(r.reason).toMatch(/2 courses/);
  });

  it("deletable: courses exist but belong to a DIFFERENT term", () => {
    expect(canDeleteTerm(upcoming, [{ id: "c1", termId: "term_cur" }])).toEqual({ deletable: true, reason: null });
  });

  it("handles a missing term", () => {
    const r = canDeleteTerm(null, []);
    expect(r.deletable).toBe(false);
  });
});

// Real request: "remove the function to close current term... instead we need a function to set
// a term to Active. That requires: add a field to manage the term states: Current, Upcoming,
// Archive." Status is now a STORED field the student sets explicitly — never derived from dates.
describe("computeTermStatuses", () => {
  it("reads each term's own stored status, untouched", () => {
    const terms = [
      { id: "t1", status: "current" },
      { id: "t2", status: "archived" },
      { id: "t3", status: "upcoming" },
    ];
    expect(computeTermStatuses(terms).map(t => t.status)).toEqual(["current", "archived", "upcoming"]);
  });

  it("defaults a term with no stored status to upcoming — never silently current", () => {
    expect(computeTermStatuses([{ id: "t1" }])[0].status).toBe("upcoming");
  });

  it("never infers status from dates — an already-past end date does not become archived on its own", () => {
    const terms = [{ id: "t1", status: "current", start: "2000-01-01", end: "2000-06-01" }];
    expect(computeTermStatuses(terms)[0].status).toBe("current");
  });

  it("handles no terms at all", () => {
    expect(computeTermStatuses(undefined)).toEqual([]);
  });
});

describe("migrateTermStatusIfNeeded", () => {
  it("no-op once every term already has its own stored status", () => {
    const data = { terms: [{ id: "t1", start: "2026-08-01", end: "2026-12-01", status: "current" }] };
    expect(migrateTermStatusIfNeeded(data)).toBeNull();
  });

  it("no-op when there are no terms at all", () => {
    expect(migrateTermStatusIfNeeded({ terms: [] })).toBeNull();
  });

  it("backfills using the OLD date-derived rule: earliest-starting non-past term becomes current", () => {
    // Dates chosen safely in the past/future of any realistic test-run date (this repo is
    // actively 2026) — migrateTermStatusIfNeeded computes "today" internally via iso(), no inject
    // point needed for this to stay deterministic.
    const data = {
      terms: [
        { id: "past", start: "2020-01-01", end: "2020-06-01" },   // already ended — archived
        { id: "now", start: "2020-08-01", end: "2099-12-01" },    // earliest still-open — current
        { id: "next", start: "2099-01-01", end: "2099-06-01" },   // upcoming
      ],
    };
    const patch = migrateTermStatusIfNeeded(data);
    const byId = Object.fromEntries(patch.terms.map(t => [t.id, t.status]));
    expect(byId.past).toBe("archived");
    expect(byId.now).toBe("current");
    expect(byId.next).toBe("upcoming");
  });

  it("only backfills terms that are missing a status — leaves already-set ones exactly as they are", () => {
    const data = {
      terms: [
        { id: "t1", start: "2000-01-01", end: "2099-01-01", status: "archived" }, // explicitly archived despite a future end date — must stay archived
        { id: "t2", start: "2026-01-01", end: "2020-01-01" }, // no status, clearly past — gets backfilled
      ],
    };
    const patch = migrateTermStatusIfNeeded(data);
    const byId = Object.fromEntries(patch.terms.map(t => [t.id, t.status]));
    expect(byId.t1).toBe("archived");
    expect(byId.t2).toBe("archived");
  });
});

// Real reported bug: "I deleted all terms, and still showing term" — the profile mirror used to
// only ever get WRITTEN when there was an active term, never cleared when there wasn't one, so a
// deleted term's name/dates/calendar kept showing in the header (and anywhere else reading these
// fields) indefinitely.
describe("syncActiveTermToProfilePatch — no active term", () => {
  const dataWithNoTerms = (profileOver = {}) => ({
    terms: [],
    schools: [],
    profile: {
      termName: "Fall 2026 TEST", termStart: "2026-08-22", termEnd: "2026-09-23",
      schoolName: "UCSD", schoolAddress: "La Jolla, CA",
      collegeCalendar: { quarters: [{ name: "Fall 2026 TEST", start: "2026-08-22", end: "2026-09-23" }] },
      ...profileOver,
    },
  });

  it("clears every mirrored field once there is no active term at all", () => {
    const patch = syncActiveTermToProfilePatch(dataWithNoTerms());
    expect(patch).toEqual({
      termName: "", termStart: "", termEnd: "",
      schoolName: "", schoolAddress: "",
      collegeCalendar: null,
    });
  });

  it("no-op once the mirror is already clear — doesn't loop forever re-writing empty strings", () => {
    const patch = syncActiveTermToProfilePatch(dataWithNoTerms({
      termName: "", termStart: "", termEnd: "", schoolName: "", schoolAddress: "", collegeCalendar: null,
    }));
    expect(patch).toBeNull();
  });

  it("same clearing behavior when every term exists but none is Current (all archived/upcoming)", () => {
    const data = {
      terms: [{ id: "t1", schoolId: "s1", status: "archived", start: "2020-01-01", end: "2020-06-01" }],
      schools: [{ id: "s1", name: "UCSD" }],
      profile: dataWithNoTerms().profile,
    };
    expect(syncActiveTermToProfilePatch(data)).toEqual({
      termName: "", termStart: "", termEnd: "",
      schoolName: "", schoolAddress: "",
      collegeCalendar: null,
    });
  });
});

describe("scrubTermSchedule", () => {
  const term = { start: "2026-09-24", end: "2026-12-15" };
  const dataWithSchedule = (over = {}) => ({
    studyPlan: {
      weeks: {
        "2026-09-28": {
          days: {
            "2026-09-29": [{ courseId: "c1", title: "In range, course match" }],
            "2027-01-05": [{ courseId: "c9", title: "Out of range, different course — kept" }],
          },
        },
      },
    },
    completionLog: [
      { courseId: "c1", actualCompletedAt: "2026-10-01T12:00:00Z" },
      { courseId: "c9", actualCompletedAt: "2027-02-01T12:00:00Z" },
    ],
    pomodoroLogs: [{ date: "2026-10-01" }, { date: "2027-02-01" }],
    ...over,
  });

  it("drops a studyPlan block matching the term's course ids", () => {
    const r = scrubTermSchedule(dataWithSchedule(), term, new Set(["c1"]));
    const kept = r.studyPlan.weeks["2026-09-28"]?.days || {};
    expect(kept["2026-09-29"]).toBeUndefined();
    expect(kept["2027-01-05"]).toHaveLength(1); // different course, out of range — kept
  });

  it("drops a studyPlan block by date range even with no course match (empty Set — the new-term case)", () => {
    const r = scrubTermSchedule(dataWithSchedule(), term, new Set());
    const kept = r.studyPlan.weeks["2026-09-28"]?.days || {};
    expect(kept["2026-09-29"]).toBeUndefined(); // in range, dropped despite no courseId match
    expect(kept["2027-01-05"]).toHaveLength(1); // out of range — kept
  });

  it("filters completionLog by course id OR date range", () => {
    const r = scrubTermSchedule(dataWithSchedule(), term, new Set(["c1"]));
    expect(r.completionLog).toHaveLength(1);
    expect(r.completionLog[0].courseId).toBe("c9");
  });

  it("filters pomodoroLogs by date range only (no course reference)", () => {
    const r = scrubTermSchedule(dataWithSchedule(), term, new Set());
    expect(r.pomodoroLogs).toEqual([{ date: "2027-02-01" }]);
  });

  it("removes a week entirely once every day under it is scrubbed", () => {
    const r = scrubTermSchedule(dataWithSchedule({
      studyPlan: { weeks: { "2026-09-28": { days: { "2026-09-29": [{ courseId: "c1" }] } } } },
    }), term, new Set(["c1"]));
    expect(r.studyPlan.weeks["2026-09-28"]).toBeUndefined();
  });

  it("is a no-op scrub when the term has no start/end (dateless) and no course ids match", () => {
    const r = scrubTermSchedule(dataWithSchedule(), { start: null, end: null }, new Set());
    const kept = r.studyPlan.weeks["2026-09-28"]?.days || {};
    expect(kept["2026-09-29"]).toHaveLength(1);
    expect(kept["2027-01-05"]).toHaveLength(1);
  });
});
