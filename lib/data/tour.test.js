import { describe, it, expect } from "vitest";
import { backfillTourOfferedIfNeeded } from "./tour";

describe("backfillTourOfferedIfNeeded", () => {
  it("backfills a silent marker for an already-onboarded account with no tourOfferedAt", () => {
    const data = { onboarded: true, profile: { tourOfferedAt: null } };
    expect(backfillTourOfferedIfNeeded(data)).toEqual({ tourOfferedAt: "backfilled" });
  });

  it("no-op once tourOfferedAt is already set (backfilled or genuinely offered)", () => {
    expect(backfillTourOfferedIfNeeded({ onboarded: true, profile: { tourOfferedAt: "backfilled" } })).toBeNull();
    expect(backfillTourOfferedIfNeeded({ onboarded: true, profile: { tourOfferedAt: "2026-09-15T12:00:00.000Z" } })).toBeNull();
  });

  it("no-op for an account still mid-signup — the real onboarding-finish trigger handles that case, not this", () => {
    expect(backfillTourOfferedIfNeeded({ onboarded: false, profile: { tourOfferedAt: null } })).toBeNull();
  });
});
