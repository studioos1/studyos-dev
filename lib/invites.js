import { supabase } from "@/lib/supabase";

// Invite codes (launch-readiness item 3/6) — signup requires a valid code, and any signed-in user
// can get their own to share. Both operations go through Postgres functions (supabase/schema.sql),
// not direct table reads/writes — see that file for why (redeeming has to work pre-auth, and both
// need to never leak other rows). Client code here is a thin wrapper, same shape as lib/bugReports.js.

// Called from Login.jsx BEFORE supabase.auth.signUp() — an invalid/exhausted code blocks account
// creation entirely. Returns true/false only; never throws for "just wrong code" (that's an
// expected outcome, not an error) — only a real network/DB failure throws.
export async function redeemInviteCode(code) {
  const { data, error } = await supabase.rpc("redeem_invite_code", { p_code: code });
  if (error) throw error;
  return data === true;
}

// Returns { code, use_count, max_uses } for the signed-in user, creating one on first call.
export async function getMyInviteInfo() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  // .limit(1) + array (not .maybeSingle()) is deliberate defense-in-depth: the DB now enforces one
  // row per owner_id (see supabase/schema.sql), but if that ever somehow doesn't hold, this reads
  // the oldest row instead of hard-erroring the whole "Invite a friend" section over it.
  const { data: rows, error: selectError } = await supabase
    .from("invite_codes")
    .select("code,use_count,max_uses")
    .eq("owner_id", session.user.id)
    .order("created_at", { ascending: true })
    .limit(1);
  if (selectError) {
    console.error("StudyOS: failed to read invite code —", selectError.message);
    return null;
  }
  if (rows?.length) return rows[0];

  const { data: code, error: rpcError } = await supabase.rpc("get_or_create_my_invite_code");
  if (rpcError) {
    console.error("StudyOS: failed to create invite code —", rpcError.message);
    return null;
  }
  return { code, use_count: 0, max_uses: 20 };
}
