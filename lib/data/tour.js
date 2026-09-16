// One-time repair: an already-onboarded account created before the onboarding tour shipped has
// no tourOfferedAt at all (undefined, not null) — without this, App.jsx's auto-trigger effect
// (gated on `!tourOfferedAt`) would treat every existing account as "never offered" and pop the
// tour on their next login, surprising someone who's already been using the app for weeks.
// Silently backfills it (no tour shown) for anyone already onboarded; a brand-new signup goes
// through the real onboarding flow instead, which sets it via the real auto-trigger, not this.
// Idempotent — returns null once tourOfferedAt is already set (including by this function itself).
export function backfillTourOfferedIfNeeded(data){
  if(!data.onboarded)return null; // still mid-signup — the real trigger handles this once they finish
  if(data.profile.tourOfferedAt)return null; // already set (backfilled or genuinely offered)
  return {tourOfferedAt:"backfilled"};
}
