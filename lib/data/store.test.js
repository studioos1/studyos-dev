import { describe, it, expect } from "vitest";
import { migrate } from "./store";

describe("migrate — energyPeak -> energyPeakTime carry-forward", () => {
  // energyPeak (a morning/afternoon/evening bucket) was replaced by energyPeakTime (a real clock
  // time) when the duplicate "study session length" preference was removed. An existing account's
  // stored profile still has the old field with no energyPeakTime — without this migration, the
  // Preferences time picker would render empty and silently reset the user's preference instead
  // of carrying it forward.
  it("converts each old bucket to a representative time", () => {
    expect(migrate({ profile: { energyPeak: "morning" } }).profile.energyPeakTime).toBe("09:00");
    expect(migrate({ profile: { energyPeak: "afternoon" } }).profile.energyPeakTime).toBe("14:00");
    expect(migrate({ profile: { energyPeak: "evening" } }).profile.energyPeakTime).toBe("19:00");
  });

  it("does not touch an already-migrated profile — real time value passes through untouched", () => {
    const d = migrate({ profile: { energyPeak: "evening", energyPeakTime: "16:45" } });
    expect(d.profile.energyPeakTime).toBe("16:45");
  });

  it("leaves a brand-new profile (no old field at all) with no energyPeakTime added — schema.js's own default covers that case", () => {
    const d = migrate({ profile: { wakeTime: "07:00" } });
    expect(d.profile.energyPeakTime).toBeUndefined();
  });

  it("is a no-op when there's no profile at all", () => {
    expect(migrate({ courses: [] }).profile).toBeUndefined();
  });

  it("passes null/undefined straight through", () => {
    expect(migrate(null)).toBeNull();
  });
});

describe("migrate — remindersOn -> per-type browser toggles carry-forward", () => {
  // remindersOn (a single master switch) was split into three per-type toggles
  // (notifyBrowserPriorities/Sessions/Breaks). Everywhere those are read, "unset" already means
  // "on" — right for an account that never touched remindersOn — but an account that had
  // explicitly turned it OFF needs that off-state carried forward once, or it would silently get
  // all three back on the moment they're read as unset.
  it("carries an explicit off forward to all three new toggles", () => {
    const d = migrate({ profile: { remindersOn: false } });
    expect(d.profile.notifyBrowserPriorities).toBe(false);
    expect(d.profile.notifyBrowserSessions).toBe(false);
    expect(d.profile.notifyBrowserBreaks).toBe(false);
  });

  it("leaves the new toggles unset when remindersOn was true (or unset) — schema.js's own default of true already matches", () => {
    expect(migrate({ profile: { remindersOn: true } }).profile.notifyBrowserPriorities).toBeUndefined();
    expect(migrate({ profile: { wakeTime: "07:00" } }).profile.notifyBrowserPriorities).toBeUndefined();
  });

  it("does not touch an already-migrated profile — a real per-type choice passes through untouched even if remindersOn was off", () => {
    const d = migrate({ profile: { remindersOn: false, notifyBrowserPriorities: true, notifyBrowserSessions: false, notifyBrowserBreaks: true } });
    expect(d.profile.notifyBrowserPriorities).toBe(true);
    expect(d.profile.notifyBrowserSessions).toBe(false);
    expect(d.profile.notifyBrowserBreaks).toBe(true);
  });
});
