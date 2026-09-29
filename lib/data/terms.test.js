import { describe, it, expect } from "vitest";
import { repairDatelessTermIfNeeded, migrateLegacyTermIfNeeded, datesOverlap, canDeleteTerm, computeTermStatuses, migrateTermStatusIfNeeded, syncActiveTermToProfilePatch, backfillTermsInitializedIfNeeded, applyTermScopedPatch, migrateTermDataIsolationIfNeeded, migrateCourseDataNestingIfNeeded, termScopedForPlanning, termAsProfile, projectTermForPlanning } from "./terms";

// Term end far in the future — status is now a stored field (not date-derived), so the fixture
// term is explicitly marked "current" rather than relying on date math to make it so.
const FUTURE = "2099-06-01";
const mk = (over = {}) => ({
  profile: { termStart: "2026-08-22", termEnd: FUTURE, schoolName: "u" },
  schools: [{ id: "sch1", name: "u" }],
  terms: [{ id: "term1", schoolId: "sch1", name: "Fall", start: "2026-08-22", end: FUTURE, status: "current" }],
  ...over,
});

// unify-term-course-data refactor, step 6/6: renamed from repairTermLinkageIfNeeded — this used
// to ALSO relink orphan courses (a missing/dangling termId) to the current term, moot now that a
// course's "term" is which term.courses array it lives in, not a termId foreign key that can
// dangle. Only the dateless-term repair remains.
describe("repairDatelessTermIfNeeded", () => {
  it("no-op when every term already has dates", () => {
    expect(repairDatelessTermIfNeeded(mk())).toBeNull();
  });

  it("fills a dateless term from the profile", () => {
    const fix = repairDatelessTermIfNeeded(mk({
      terms: [{ id: "term1", schoolId: "sch1", name: "Current term", start: "", end: "", status: "current" }],
    }));
    expect(fix.terms[0].start).toBe("2026-08-22");
    expect(fix.terms[0].end).toBe(FUTURE);
  });

  it("returns null when there are no terms at all", () => {
    expect(repairDatelessTermIfNeeded(mk({ terms: [] }))).toBeNull();
  });

  it("returns null when a term is dateless but the profile has no dates to fill from either", () => {
    const fix = repairDatelessTermIfNeeded(mk({
      profile: { schoolName: "u" }, // no termStart/termEnd
      terms: [{ id: "term1", schoolId: "sch1", name: "Current term", start: "", end: "", status: "current" }],
    }));
    expect(fix).toBeNull();
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

  // unify-term-course-data refactor, step 6/6: any course/assignment/exam that predates the whole
  // terms system unambiguously belongs to this — the account's first and only term at the moment
  // it's synthesized — so they're adopted directly into its own nested copy, not tagged with a
  // termId (no such field exists anymore) for a later pass to link up.
  it("adopts any pre-existing courses/assignments/exams directly into the new term's own nested copy", () => {
    const patch = migrateLegacyTermIfNeeded(legacy({ onboardTermSaved: true }, {
      courses: [{ id: "c1", name: "MATH 180A" }],
      assignments: [{ id: "a1", courseId: "c1" }],
      exams: [{ id: "e1", courseId: "c1" }],
    }));
    expect(patch.terms[0].courses).toEqual([{ id: "c1", name: "MATH 180A" }]);
    expect(patch.terms[0].assignments).toEqual([{ id: "a1", courseId: "c1" }]);
    expect(patch.terms[0].exams).toEqual([{ id: "e1", courseId: "c1" }]);
  });

  it("gives the new term genuinely empty course data when there's nothing pre-existing to adopt", () => {
    const patch = migrateLegacyTermIfNeeded(legacy({ onboardTermSaved: true }));
    expect(patch.terms[0].courses).toEqual([]);
    expect(patch.terms[0].assignments).toEqual([]);
    expect(patch.terms[0].exams).toEqual([]);
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

// unify-term-course-data refactor, step 6/6: canDeleteTerm now takes just `term` — attached
// courses are read from its own nested `courses` field, not a separately-passed list filtered by
// a termId tag (a course belonging to a DIFFERENT term simply isn't in THIS term's own array to
// begin with, so that old "deletable: courses exist but belong to a different term" case is no
// longer even expressible as a test — there's nothing to construct wrong here anymore).
describe("canDeleteTerm", () => {
  const upcoming = { id: "term_up", status: "upcoming", courses: [] };
  const current = { id: "term_cur", status: "current", courses: [] };
  const archived = { id: "term_done", status: "archived", courses: [] };

  it("deletable: an upcoming term with no attached courses", () => {
    expect(canDeleteTerm(upcoming)).toEqual({ deletable: true, reason: null });
  });

  it("blocked: a current term, even with no courses", () => {
    const r = canDeleteTerm(current);
    expect(r.deletable).toBe(false);
    expect(r.reason).toMatch(/current/);
  });

  it("blocked: an archived term", () => {
    const r = canDeleteTerm(archived);
    expect(r.deletable).toBe(false);
    expect(r.reason).toMatch(/archived/);
  });

  it("blocked: an upcoming term with one attached course — singular wording", () => {
    const r = canDeleteTerm({ ...upcoming, courses: [{ id: "c1" }] });
    expect(r.deletable).toBe(false);
    expect(r.attachedCourses).toBe(1);
    expect(r.reason).toMatch(/1 course/);
    expect(r.reason).not.toMatch(/courses/); // singular, not "1 courses"
  });

  it("blocked: an upcoming term with multiple attached courses — plural wording", () => {
    const r = canDeleteTerm({ ...upcoming, courses: [{ id: "c1" }, { id: "c2" }] });
    expect(r.deletable).toBe(false);
    expect(r.attachedCourses).toBe(2);
    expect(r.reason).toMatch(/2 courses/);
  });

  it("handles a missing term", () => {
    const r = canDeleteTerm(null);
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

describe("applyTermScopedPatch", () => {
  const mk = (over = {}) => ({
    terms: [
      { id: "tA", schoolId: "s1", status: "current", start: "2026-09-24", end: "2026-12-15", studyPlan: { weeks: { wA: "planA" } }, completionLog: ["logA"], pomodoroLogs: [], gymLogs: [], dailyLogs: [], adhoc: [], briefCache: "briefA", briefPeriod: "p1", quarterPlan: null, planStale: false, notifications: [], lastSyllabusSync: { at: "2026-09-01" } },
      { id: "tB", schoolId: "s1", status: "archived", start: "2026-01-01", end: "2026-06-01", studyPlan: { weeks: { wB: "planB" } }, completionLog: ["logB"], pomodoroLogs: [], gymLogs: [], dailyLogs: [], adhoc: [], briefCache: "briefB", briefPeriod: "p2", quarterPlan: null, planStale: false, notifications: [], lastSyllabusSync: { at: "2026-01-01" } },
    ],
    schools: [{ id: "s1", name: "UCSD" }],
    studyPlan: { weeks: { wA: "planA" } }, // mirror of the current term (tA), as it would be after load
    completionLog: ["logA"],
    lastSyllabusSync: { at: "2026-09-01" },
    ...over,
  });

  it("mirrors a flat scoped-field write into the current term's own copy, leaving other terms untouched", () => {
    const n = applyTermScopedPatch(mk(), { studyPlan: { weeks: { wA: "updated" } } });
    expect(n.studyPlan).toEqual({ weeks: { wA: "updated" } }); // flat mirror updated
    expect(n.terms.find(t => t.id === "tA").studyPlan).toEqual({ weeks: { wA: "updated" } }); // real copy updated
    expect(n.terms.find(t => t.id === "tB").studyPlan).toEqual({ weeks: { wB: "planB" } }); // other term untouched
  });

  // Step 4/6 of the unify-term-course-data refactor: courses/assignments/exams (COURSE_DATA_KEYS,
  // lib/data/schema.js) route through this SAME mechanism as TERM_SCOPED_KEYS — checked as a
  // separate, parallel list (not merged into TERM_SCOPED_KEYS itself, so migrateTermDataIsolation
  // IfNeeded's different adopt-into-current-only-empty-elsewhere semantic stays untouched by course
  // data ever being added here).
  it("routes courses (a COURSE_DATA_KEYS key) into the current term's own copy, same as studyPlan", () => {
    const n = applyTermScopedPatch(mk(), { courses: [{ id: "c1" }] });
    expect(n.courses).toEqual([{ id: "c1" }]); // flat mirror updated
    expect(n.terms.find(t => t.id === "tA").courses).toEqual([{ id: "c1" }]); // real copy updated
    expect(n.terms.find(t => t.id === "tB").courses).toBeUndefined(); // other term untouched
  });

  it("re-derives every mirrored field from the NEW current term when a `terms` patch changes who's current", () => {
    const prev = mk();
    const newTerms = prev.terms.map(t => ({ ...t, status: t.id === "tB" ? "current" : "archived" }));
    const n = applyTermScopedPatch(prev, { terms: newTerms });
    expect(n.studyPlan).toEqual({ weeks: { wB: "planB" } }); // now mirrors tB, not tA
    expect(n.completionLog).toEqual(["logB"]);
    expect(n.lastSyllabusSync).toEqual({ at: "2026-01-01" });
  });

  it("re-derives mirrors even when the `terms` patch content didn't actually change the current term's data (idempotent)", () => {
    const prev = mk();
    const n = applyTermScopedPatch(prev, { terms: prev.terms });
    expect(n.studyPlan).toEqual({ weeks: { wA: "planA" } });
  });

  it("falls back to TERM_DATA_DEFAULTS for a scoped key the current term doesn't have yet", () => {
    const prev = mk();
    prev.terms = prev.terms.map(t => t.id === "tA" ? { ...t, quarterPlan: undefined } : t);
    const n = applyTermScopedPatch(prev, { terms: prev.terms });
    expect(n.quarterPlan).toBe(null); // TERM_DATA_DEFAULTS.quarterPlan
  });

  it("is a no-op passthrough when there's no current term at all", () => {
    const noTermData = { terms: [], studyPlan: { weeks: { x: 1 } } };
    const n = applyTermScopedPatch(noTermData, { studyPlan: { weeks: { x: 2 } } });
    expect(n.studyPlan).toEqual({ weeks: { x: 2 } }); // flat merge still happened
    expect(n.terms).toEqual([]); // nothing to route into
  });

  // targetTermId — the term-viewer's "run/clear a plan for a term I'm looking at, which isn't
  // necessarily current" path.
  it("targetTermId routes a scoped write into that term's own copy WITHOUT touching Current's flat mirror", () => {
    const n = applyTermScopedPatch(mk(), { studyPlan: { weeks: { wB: "updated" } } }, "tB");
    expect(n.terms.find(t => t.id === "tB").studyPlan).toEqual({ weeks: { wB: "updated" } }); // target term updated
    expect(n.terms.find(t => t.id === "tA").studyPlan).toEqual({ weeks: { wA: "planA" } }); // current term's own copy untouched
    expect(n.studyPlan).toEqual({ weeks: { wA: "planA" } }); // flat mirror still reflects Current, not the write
  });

  it("targetTermId equal to the current term's id behaves exactly like omitting it", () => {
    const withTarget = applyTermScopedPatch(mk(), { studyPlan: { weeks: { wA: "updated" } } }, "tA");
    const withoutTarget = applyTermScopedPatch(mk(), { studyPlan: { weeks: { wA: "updated" } } });
    expect(withTarget).toEqual(withoutTarget);
  });

  it("falls back to plain flat merge when targetTermId doesn't match any term", () => {
    const n = applyTermScopedPatch(mk(), { studyPlan: { weeks: { x: 1 } } }, "nonexistent");
    expect(n.studyPlan).toEqual({ weeks: { x: 1 } }); // flat merge still happened (matches the "no current term" no-op case)
    expect(n.terms).toEqual(mk().terms); // no term was touched
  });
});

describe("migrateTermDataIsolationIfNeeded", () => {
  it("is a no-op with no terms at all", () => {
    expect(migrateTermDataIsolationIfNeeded({ terms: [] })).toBeNull();
  });

  it("is a no-op once every term already has its own studyPlan field", () => {
    const data = { terms: [{ id: "t1", status: "current", studyPlan: { weeks: {} } }] };
    expect(migrateTermDataIsolationIfNeeded(data)).toBeNull();
  });

  it("seeds the CURRENT term from the old flat top-level fields, and every other term with empty defaults", () => {
    const data = {
      terms: [
        { id: "t1", status: "archived", start: "2026-01-01", end: "2026-06-01" },
        { id: "t2", status: "current", start: "2026-09-01", end: "2026-12-01" },
      ],
      studyPlan: { weeks: { real: "plan" } },
      completionLog: ["done1"],
      pomodoroLogs: [{ date: "2026-09-10" }],
    };
    const fix = migrateTermDataIsolationIfNeeded(data);
    const t1 = fix.terms.find(t => t.id === "t1");
    const t2 = fix.terms.find(t => t.id === "t2");
    expect(t2.studyPlan).toEqual({ weeks: { real: "plan" } }); // current term adopts the flat data
    expect(t2.completionLog).toEqual(["done1"]);
    expect(t1.studyPlan).toEqual({ weeks: {} }); // other term starts genuinely empty
    expect(t1.completionLog).toEqual([]);
  });

  it("never touches a term that's already been migrated", () => {
    const data = {
      terms: [
        { id: "t1", status: "current", studyPlan: { weeks: { already: "migrated" } }, completionLog: ["keep-me"] },
      ],
      studyPlan: { weeks: { flat: "stale" } }, // should NOT overwrite the already-migrated term
    };
    expect(migrateTermDataIsolationIfNeeded(data)).toBeNull();
  });
});

// Step 1/6 of the unify-term-course-data refactor — see lib/data/schema.js's COURSE_DATA_KEYS
// comment for the full rationale. Unlike migrateTermDataIsolationIfNeeded above (adopt-into-current,
// empty-elsewhere), this migration is a genuine re-PARTITION: every term (current or not) already
// owns real courses/assignments/exams today via termId tagging, so each one adopts its own real
// slice, not an empty default.
describe("migrateCourseDataNestingIfNeeded", () => {
  const data = {
    terms: [
      { id: "t1", status: "current" },
      { id: "t2", status: "upcoming" },
    ],
    courses: [
      { id: "c1", name: "MATH 180A", termId: "t1" },
      { id: "c2", name: "DSC 10", termId: "t1" },
      { id: "c3", name: "LING 8", termId: "t2" },
    ],
    assignments: [
      { id: "a1", courseId: "c1", title: "HW1" },
      { id: "a2", courseId: "c3", title: "HW2" },
    ],
    exams: [
      { id: "e1", courseId: "c2", title: "Final" },
    ],
  };

  it("is a no-op with no terms at all", () => {
    expect(migrateCourseDataNestingIfNeeded({ terms: [], courses: [] })).toBeNull();
  });

  it("is a no-op once every term already has its own courses field", () => {
    const already = { terms: [{ id: "t1", courses: [], assignments: [], exams: [] }], courses: [] };
    expect(migrateCourseDataNestingIfNeeded(already)).toBeNull();
  });

  it("partitions each term's own real courses/assignments/exams by termId/courseId — not adopt-current/empty-elsewhere", () => {
    const fix = migrateCourseDataNestingIfNeeded(data);
    const t1 = fix.terms.find(t => t.id === "t1");
    const t2 = fix.terms.find(t => t.id === "t2");
    expect(t1.courses.map(c => c.id)).toEqual(["c1", "c2"]);
    expect(t1.assignments.map(a => a.id)).toEqual(["a1"]);
    expect(t1.exams.map(e => e.id)).toEqual(["e1"]);
    expect(t2.courses.map(c => c.id)).toEqual(["c3"]);
    expect(t2.assignments.map(a => a.id)).toEqual(["a2"]);
    expect(t2.exams).toEqual([]);
  });

  it("never touches a term that's already been migrated", () => {
    const already = {
      terms: [{ id: "t1", courses: [{ id: "stale" }], assignments: [], exams: [] }],
      courses: [{ id: "fresh", termId: "t1" }], // should NOT overwrite the already-migrated term
    };
    expect(migrateCourseDataNestingIfNeeded(already)).toBeNull();
  });
});

describe("termScopedForPlanning with an explicit term", () => {
  // Step 3/6 of the unify-term-course-data refactor: termScopedForPlanning now reads each term's
  // own NESTED courses/assignments/exams (as migrateCourseDataNestingIfNeeded would have populated
  // them, kept fresh incrementally by every write since step 4), not a live filter over the flat
  // top-level arrays by termId — so the fixture below carries that nested data directly, matching
  // real post-migration account shape.
  const data = {
    profile: {},
    courses: [{ id: "c1", termId: "tA" }, { id: "c2", termId: "tB" }], // legacy flat arrays — no longer read by this function, kept here only to prove that
    assignments: [{ id: "a1", courseId: "c1" }, { id: "a2", courseId: "c2" }],
    exams: [{ id: "e1", courseId: "c1" }, { id: "e2", courseId: "c2" }],
    terms: [
      { id: "tA", status: "current", courses: [{ id: "c1", termId: "tA" }], assignments: [{ id: "a1", courseId: "c1" }], exams: [{ id: "e1", courseId: "c1" }] },
      { id: "tB", status: "upcoming", courses: [{ id: "c2", termId: "tB" }], assignments: [{ id: "a2", courseId: "c2" }], exams: [{ id: "e2", courseId: "c2" }] },
    ],
  };

  it("scopes to the current term by default (unchanged behavior)", () => {
    const scoped = termScopedForPlanning(data);
    expect(scoped.courses.map(c => c.id)).toEqual(["c1"]);
  });

  it("scopes to an explicitly-passed term instead of current", () => {
    const scoped = termScopedForPlanning(data, data.terms[1]);
    expect(scoped.courses.map(c => c.id)).toEqual(["c2"]);
    expect(scoped.assignments.map(a => a.id)).toEqual(["a2"]);
    expect(scoped.exams.map(e => e.id)).toEqual(["e2"]);
  });

  it("re-resolves against the LIVE data.terms rather than trusting a stale passed-in term object", () => {
    const staleTermRef = { id: "tB", status: "upcoming" }; // no nested fields — as if captured before a later write refreshed it
    const scoped = termScopedForPlanning(data, staleTermRef);
    expect(scoped.courses.map(c => c.id)).toEqual(["c2"]); // still correct — resolved tB fresh from data.terms
  });

  it("falls back to the passed-in term's own fields if it genuinely isn't in data.terms at all", () => {
    const detachedTerm = { id: "ghost", courses: [{ id: "cX" }], assignments: [], exams: [] };
    const scoped = termScopedForPlanning(data, detachedTerm);
    expect(scoped.courses.map(c => c.id)).toEqual(["cX"]);
  });
});

describe("termAsProfile", () => {
  it("returns null for no term", () => {
    expect(termAsProfile(null, null)).toBeNull();
  });

  it("builds a profile-shaped object from a term + school", () => {
    const term = { name: "Fall 2026", start: "2026-09-24", end: "2026-12-15", holidays: [{ date: "2026-11-26" }], type: "quarter" };
    const school = { name: "UCSD", address: "La Jolla, CA" };
    const p = termAsProfile(term, school);
    expect(p).toEqual({
      termName: "Fall 2026", termStart: "2026-09-24", termEnd: "2026-12-15",
      schoolName: "UCSD", schoolAddress: "La Jolla, CA", schoolType: "quarter",
      collegeCalendar: { quarters: [{ name: "Fall 2026", start: "2026-09-24", end: "2026-12-15" }], holidays: [{ date: "2026-11-26" }], source: null, fetchedAt: null },
    });
  });

  it("omits collegeCalendar when the term has no dates yet", () => {
    const p = termAsProfile({ name: "Winter 2027", start: "", end: "" }, null);
    expect(p.collegeCalendar).toBeNull();
  });
});

describe("projectTermForPlanning", () => {
  const school = { id: "s1", name: "UCSD" };
  // Step 3/6 of the unify-term-course-data refactor: courses/assignments/exams below are each
  // term's own NESTED copy (as migrateCourseDataNestingIfNeeded would have populated them) — the
  // thing projectTermForPlanning's own termScopedForPlanning call now actually reads.
  const currentTerm = { id: "tA", schoolId: "s1", status: "current", name: "Fall 2026", start: "2026-09-24", end: "2026-12-15", studyPlan: { weeks: { wA: 1 } }, quarterPlan: { x: "a" }, courses: [{ id: "c1", termId: "tA" }], assignments: [], exams: [] };
  const upcomingTerm = { id: "tB", schoolId: "s1", status: "upcoming", name: "Winter 2027", start: "2027-01-04", end: "2027-03-15", studyPlan: { weeks: { wB: 2 } }, quarterPlan: null, courses: [{ id: "c2", termId: "tB" }], assignments: [], exams: [] };
  const data = {
    profile: { termName: "Fall 2026", termStart: "2026-09-24", termEnd: "2026-12-15", schoolName: "UCSD" },
    schools: [school],
    terms: [currentTerm, upcomingTerm],
    courses: [{ id: "c1", termId: "tA" }, { id: "c2", termId: "tB" }],
    assignments: [], exams: [],
    studyPlan: { weeks: { wA: 1 } }, // flat mirror of current
    quarterPlan: { x: "a" },
  };

  it("returns data unchanged when no term is given", () => {
    expect(projectTermForPlanning(data, null, null)).toBe(data);
  });

  it("projecting the current term matches the live flat data", () => {
    const proj = projectTermForPlanning(data, currentTerm, school);
    expect(proj.studyPlan).toEqual(data.studyPlan);
    expect(proj.quarterPlan).toEqual(data.quarterPlan);
    expect(proj.profile.termStart).toBe(data.profile.termStart);
    expect(proj.courses.map(c => c.id)).toEqual(["c1"]);
  });

  it("projecting a non-current term shows ITS OWN data, not Current's", () => {
    const proj = projectTermForPlanning(data, upcomingTerm, school);
    expect(proj.studyPlan).toEqual({ weeks: { wB: 2 } });
    expect(proj.quarterPlan).toBeNull(); // TERM_DATA_DEFAULTS fallback, term.quarterPlan is explicitly null
    expect(proj.profile.termStart).toBe("2027-01-04");
    expect(proj.profile.termName).toBe("Winter 2027");
    expect(proj.courses.map(c => c.id)).toEqual(["c2"]);
  });

  // Real, shipped bug this locks in: an earlier version only projected studyPlan/quarterPlan, so
  // Today.jsx (once it also started using this) saw a mismatched mix — the viewed term's own
  // assignments/schedule against CURRENT's completionLog/notifications/etc.
  it("projects every OTHER TERM_SCOPED_KEYS field too, not just studyPlan/quarterPlan", () => {
    const withLogs = {
      ...data,
      terms: [
        { ...currentTerm, completionLog: ["doneA"], notifications: ["notifA"], planStale: false },
        { ...upcomingTerm, completionLog: ["doneB"], notifications: ["notifB"], planStale: true },
      ],
      completionLog: ["doneA"], notifications: ["notifA"], planStale: false, // flat mirror of current
    };
    const proj = projectTermForPlanning(withLogs, withLogs.terms[1], school);
    expect(proj.completionLog).toEqual(["doneB"]);
    expect(proj.notifications).toEqual(["notifB"]);
    expect(proj.planStale).toBe(true);
  });

  it("falls back to TERM_DATA_DEFAULTS for a scoped field the viewed term doesn't have at all", () => {
    const bareTerm = { id: "tC", schoolId: "s1", status: "upcoming", name: "Spring 2027" };
    const proj = projectTermForPlanning(data, bareTerm, school);
    expect(proj.completionLog).toEqual([]);
    expect(proj.studyPlan).toEqual({ weeks: {} });
  });
});
