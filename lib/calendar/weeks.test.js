import { describe, it, expect } from "vitest";
import { iso } from "@/lib/time";
import { weekStartOf, catchUpDays, catchUpMarkComplete, CATCHUP_DAYS } from "./weeks";

// Dates built relative to iso() (today), not hardcoded — catchUpDays/catchUpMarkComplete are
// both windows measured from "today", so a fixture built off a fixed past date would silently
// drift out of the catch-up window as time passes and these tests would stop testing anything.
const daysAgo = (n) => { const d = new Date(iso() + "T12:00:00"); d.setDate(d.getDate() - n); return iso(d); };

// Minimal studyPlan.weeks fixture: one block on `date`, completed or not.
function mkData(entries) {
  const weeks = {};
  entries.forEach(({ date, id, completed }) => {
    const ws = weekStartOf(date);
    weeks[ws] = weeks[ws] || { days: {} };
    weeks[ws].days[date] = [
      ...(weeks[ws].days[date] || []),
      { id, s: 600, e: 660, label: `Session ${id}`, kind: "study", courseId: "c1", course: "MATH 180A", completed: !!completed, source: {} },
    ];
  });
  return { studyPlan: { weeks } };
}

describe("catchUpDays", () => {
  it("surfaces an unmarked block from yesterday", () => {
    const data = mkData([{ date: daysAgo(1), id: "b1", completed: false }]);
    const out = catchUpDays(data);
    expect(out).toHaveLength(1);
    expect(out[0].date).toBe(daysAgo(1));
    expect(out[0].blocks.map(b => b.id)).toEqual(["b1"]);
  });

  it("excludes already-completed blocks", () => {
    const data = mkData([{ date: daysAgo(1), id: "b1", completed: true }]);
    expect(catchUpDays(data)).toHaveLength(0);
  });

  it("excludes today — that's the live Focus Time path, not catch-up", () => {
    const data = mkData([{ date: iso(), id: "b1", completed: false }]);
    expect(catchUpDays(data)).toHaveLength(0);
  });

  it("excludes days older than the window", () => {
    const data = mkData([{ date: daysAgo(CATCHUP_DAYS + 1), id: "b1", completed: false }]);
    expect(catchUpDays(data)).toHaveLength(0);
  });

  it("includes a day exactly at the window edge", () => {
    const data = mkData([{ date: daysAgo(CATCHUP_DAYS), id: "b1", completed: false }]);
    expect(catchUpDays(data)).toHaveLength(1);
  });

  it("lists multiple days newest first", () => {
    const data = mkData([
      { date: daysAgo(3), id: "b3", completed: false },
      { date: daysAgo(1), id: "b1", completed: false },
      { date: daysAgo(2), id: "b2", completed: false },
    ]);
    expect(catchUpDays(data).map(d => d.date)).toEqual([daysAgo(1), daysAgo(2), daysAgo(3)]);
  });
});

describe("catchUpMarkComplete", () => {
  it("marks a single item complete and stamps completedAt", () => {
    const data = mkData([{ date: daysAgo(1), id: "b1", completed: false }]);
    let patch = null;
    catchUpMarkComplete(data, (p) => { patch = p; }, [{ date: daysAgo(1), blockId: "b1" }]);
    const ws = weekStartOf(daysAgo(1));
    const block = patch.studyPlan.weeks[ws].days[daysAgo(1)][0];
    expect(block.completed).toBe(true);
    expect(block.completedAt).toBeTruthy();
  });

  // The regression this test guards: catching up multiple sessions must be ONE upd() call
  // building the complete result, not a loop of separate calls each computed from the same
  // stale `data` — a loop would have each call's patch overwrite the previous one's studyPlan
  // key (upd()'s merge in App.jsx is shallow: {...prev,...p}), so only the LAST item would ever
  // actually end up marked done. This is exactly the bug catchUpMarkComplete's single-pass
  // design exists to avoid.
  it("marks multiple items across different days in one pass — none lost", () => {
    const data = mkData([
      { date: daysAgo(1), id: "b1", completed: false },
      { date: daysAgo(2), id: "b2", completed: false },
      { date: daysAgo(3), id: "b3", completed: false },
    ]);
    let patch = null;
    catchUpMarkComplete(data, (p) => { patch = p; }, [
      { date: daysAgo(1), blockId: "b1" },
      { date: daysAgo(2), blockId: "b2" },
      { date: daysAgo(3), blockId: "b3" },
    ]);
    [1, 2, 3].forEach((n) => {
      const ws = weekStartOf(daysAgo(n));
      const block = patch.studyPlan.weeks[ws].days[daysAgo(n)].find(b => b.id === `b${n}`);
      expect(block.completed).toBe(true);
    });
  });

  it("refuses an item outside the catch-up window", () => {
    const data = mkData([{ date: daysAgo(CATCHUP_DAYS + 1), id: "b1", completed: false }]);
    let called = false;
    catchUpMarkComplete(data, () => { called = true; }, [{ date: daysAgo(CATCHUP_DAYS + 1), blockId: "b1" }]);
    expect(called).toBe(false); // no upd() call at all — nothing in range to apply
  });

  it("refuses today — that goes through the live saveBlockToDay path instead", () => {
    const data = mkData([{ date: iso(), id: "b1", completed: false }]);
    let called = false;
    catchUpMarkComplete(data, () => { called = true; }, [{ date: iso(), blockId: "b1" }]);
    expect(called).toBe(false);
  });

  it("never overwrites an existing completedAt", () => {
    const data = mkData([{ date: daysAgo(1), id: "b1", completed: false }]);
    data.studyPlan.weeks[weekStartOf(daysAgo(1))].days[daysAgo(1)][0].completedAt = "2020-01-01T00:00:00.000Z";
    let patch = null;
    catchUpMarkComplete(data, (p) => { patch = p; }, [{ date: daysAgo(1), blockId: "b1" }]);
    const ws = weekStartOf(daysAgo(1));
    expect(patch.studyPlan.weeks[ws].days[daysAgo(1)][0].completedAt).toBe("2020-01-01T00:00:00.000Z");
  });
});
