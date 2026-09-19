import { serviceClient, verifyCronAuth, sendSms, eligibleUsers, todayInTZ, CRON_TZ } from "@/lib/sms/cronSend";
import { buildDailySummaryMessage } from "@/lib/sms/dailySummary";
import { runNotifyUrgentItems } from "@/lib/data/notifications";

// Fires once a day (see vercel.json's crons entry) — the "Daily summary" SMS reminder
// (Preferences → Notifications → notifyDailySummary, "8:30am — today's plan"), THEN the bell-log
// write (runNotifyUrgentItems — see that file's own comment for why it rides on this same trigger
// instead of being its own vercel.json cron entry). Every user's whole data blob lives in one
// user_data.data jsonb column (supabase/schema.sql) — service-role reads every row once (this is
// the one place in the app that legitimately needs to see across users) and both jobs share it.
export async function GET(req) {
  if (!verifyCronAuth(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  // Whole-handler try/catch — serviceClient() throws synchronously when
  // SUPABASE_SERVICE_ROLE_KEY isn't set, and an uncaught throw here crashes to Next's generic
  // error page (an EMPTY body, verified live) instead of a diagnosable JSON error — real, caught
  // in review before this route ever ran on a real schedule.
  try {
    const supabase = serviceClient();
    const { data: rows, error } = await supabase.from("user_data").select("user_id, data");
    if (error) return Response.json({ error: error.message }, { status: 500 });

    const today = todayInTZ(CRON_TZ);
    const results = [];
    for (const row of eligibleUsers(rows, "notifyDailySummary")) {
      const p = row.data.profile;
      // Idempotency guard — never send today's summary twice, however this route ends up
      // re-triggered (a manual re-run, a Vercel retry). Written back after a confirmed send below.
      if (p.lastDailySummarySentDate === today) {
        results.push({ user: row.user_id, skipped: "already sent today" });
        continue;
      }
      try {
        const message = buildDailySummaryMessage(row.data, today);
        const sid = (await sendSms({ to: p.phone, message })).sid;
        // Update the in-memory row, not just the DB — runNotifyUrgentItems below reuses this same
        // `rows` array for the SAME users; without this, its own write would read the pre-SMS-loop
        // snapshot and silently overwrite lastDailySummarySentDate back to its old value.
        row.data = { ...row.data, profile: { ...p, lastDailySummarySentDate: today } };
        await supabase.from("user_data").update({ data: row.data }).eq("user_id", row.user_id);
        results.push({ user: row.user_id, sent: true, sid });
      } catch (err) {
        // One user's failure (bad number, Twilio hiccup) never stops the rest of the batch.
        results.push({ user: row.user_id, error: err.message });
      }
    }

    const urgentItemsResults = await runNotifyUrgentItems(supabase, rows, today);
    return Response.json({ ok: true, date: today, results, urgentItemsResults });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
