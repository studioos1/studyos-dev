import { serviceClient, verifyCronAuth, todayInTZ, CRON_TZ } from "@/lib/sms/cronSend";
import { runNotifyUrgentItems } from "@/lib/data/notifications";

// Manual-testing entry point for runNotifyUrgentItems() (lib/data/notifications.js — see that
// function's own comment for what it does and why). Not wired into its own separate scheduled
// trigger in .github/workflows/scheduled-reminders.yml — app/api/cron/daily-summary calls the
// same shared function directly, on that same 8:30am trigger, reusing the one Supabase read both
// jobs need rather than fetching every row twice. This route stays here so the job can still be
// triggered on its own (same CRON_SECRET auth) independent of the SMS send, e.g. for testing.
// Same maxDuration reasoning as daily-summary/route.js — this loops every user's row too.
export const maxDuration = 60;

export async function GET(req) {
  if (!verifyCronAuth(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const supabase = serviceClient();
    const { data: rows, error } = await supabase.from("user_data").select("user_id, data");
    if (error) return Response.json({ error: error.message }, { status: 500 });
    const today = todayInTZ(CRON_TZ);
    const results = await runNotifyUrgentItems(supabase, rows, today);
    return Response.json({ ok: true, date: today, results });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
