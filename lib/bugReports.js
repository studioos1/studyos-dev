import { supabase } from "@/lib/supabase";

// Bug reporting (launch-readiness item 2/6) — a student hits an issue, taps the bug icon, and it's
// written straight to Supabase; the admin reads/resolves them from the in-app Bug Reports tab
// (components/BugReports.jsx), gated by lib/constants.js's ADMIN_EMAILS. No custom backend route:
// RLS (supabase/schema.sql) enforces who can see what, the same way user_data already does.

export async function submitBugReport({ message, page, appVersion }) {
  const { data: { session } } = await supabase.auth.getSession();
  const uid = session?.user?.id;
  if (!uid) throw new Error("You must be signed in to report a bug.");
  const { error } = await supabase.from("bug_reports").insert({
    user_id: uid,
    user_email: session.user.email || null,
    message: message.trim(),
    page: page || null,
    app_version: appVersion || null,
  });
  if (error) throw error;
}

export async function fetchBugReports() {
  const { data, error } = await supabase
    .from("bug_reports")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("StudyOS: failed to load bug reports —", error.message);
    return [];
  }
  return data || [];
}

export async function updateBugReportStatus(id, status) {
  const { error } = await supabase.from("bug_reports").update({ status }).eq("id", id);
  if (error) console.error("StudyOS: failed to update bug report status —", error.message);
}
