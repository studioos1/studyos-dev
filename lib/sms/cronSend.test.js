import { describe, it, expect } from "vitest";
import { todayInTZ, eligibleUsers } from "./cronSend";

describe("todayInTZ", () => {
  it("returns an ISO date string in the given zone", () => {
    // 2026-01-15T05:00:00Z is 2026-01-14 21:00 Pacific (still the day before, UTC-8 in January).
    const d = new Date("2026-01-15T05:00:00Z");
    expect(todayInTZ("America/Los_Angeles", d)).toBe("2026-01-14");
  });

  it("crosses the date line correctly once it's past midnight in the zone", () => {
    // 2026-01-15T09:00:00Z is 2026-01-15 01:00 Pacific — already the 15th locally.
    const d = new Date("2026-01-15T09:00:00Z");
    expect(todayInTZ("America/Los_Angeles", d)).toBe("2026-01-15");
  });
});

describe("eligibleUsers", () => {
  const base = { phone: "+15551234567", smsVerifiedPhone: "+15551234567", smsEnabled: true };

  it("includes a user with the switch on, the toggle not explicitly off, and a verified number", () => {
    const rows = [{ user_id: "u1", data: { profile: { ...base } } }];
    expect(eligibleUsers(rows, "notifyDailySummary")).toHaveLength(1);
  });

  it("excludes a user with the master SMS switch off", () => {
    const rows = [{ user_id: "u1", data: { profile: { ...base, smsEnabled: false } } }];
    expect(eligibleUsers(rows, "notifyDailySummary")).toHaveLength(0);
  });

  it("excludes a user who turned this specific reminder off", () => {
    const rows = [{ user_id: "u1", data: { profile: { ...base, notifyDailySummary: false } } }];
    expect(eligibleUsers(rows, "notifyDailySummary")).toHaveLength(0);
  });

  it("excludes a number that was typed in but never test-verified", () => {
    const rows = [{ user_id: "u1", data: { profile: { ...base, smsVerifiedPhone: null } } }];
    expect(eligibleUsers(rows, "notifyDailySummary")).toHaveLength(0);
  });

  it("excludes a number that changed after it was verified", () => {
    const rows = [{ user_id: "u1", data: { profile: { ...base, phone: "+15559999999" } } }];
    expect(eligibleUsers(rows, "notifyDailySummary")).toHaveLength(0);
  });

  it("excludes a row with no profile at all rather than throwing", () => {
    const rows = [{ user_id: "u1", data: {} }, { user_id: "u2", data: { profile: { ...base } } }];
    expect(eligibleUsers(rows, "notifyDailySummary")).toHaveLength(1);
  });

  it("handles an empty/undefined row list", () => {
    expect(eligibleUsers([], "notifyDailySummary")).toEqual([]);
    expect(eligibleUsers(undefined, "notifyDailySummary")).toEqual([]);
  });
});
