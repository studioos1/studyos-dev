import { serviceClient, verifyCronAuth, sendSms, eligibleUsers, todayInTZ, CRON_TZ } from "@/lib/sms/cronSend";

// Fires once a day at 8:00pm (see .github/workflows/scheduled-reminders.yml — Vercel Cron Jobs
// turned out to be silently unavailable on the Hobby plan) — a flat, fixed-text evening nudge to
// check in and report what got done. Deliberately NOT built from real data the way the morning summary is —
// the whole point of this one is just "go do the check-in," not a report of what's pending (the
// morning message's own "Pending Report Items" line already covers that). Gated on the same
// notifyPastDueNudge toggle Preferences already exposes for an evening-timed reminder — see the
// note in components/Sett.jsx about that toggle's label needing a matching update (was "6:00pm").
// "StudyOS 🎓" as the opening line stands in for a title/sender name — SMS has no separate title
// field, and with MessagingServiceSid sends the "From" is just a phone number, not a friendly
// name, so this is the one place the text itself identifies who it's from. 🎓 matches the same
// graduation-cap icon already used for classes elsewhere (lib/sms/dailySummary.js).
const MESSAGE = "StudyOS 🎓\nGreat work today — time to report completion. Open Check-in and keep the pace. You're doing awesome! 🎉";

export async function GET(req) {
  if (!verifyCronAuth(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  // Whole-handler try/catch — see the matching note in daily-summary/route.js: without this, a
  // missing SUPABASE_SERVICE_ROLE_KEY crashes to an empty-body 500 instead of a diagnosable error.
  try {
    const supabase = serviceClient();
    const { data: rows, error } = await supabase.from("user_data").select("user_id, data");
    if (error) return Response.json({ error: error.message }, { status: 500 });

    const today = todayInTZ(CRON_TZ);
    const results = [];
    for (const row of eligibleUsers(rows, "notifyPastDueNudge")) {
      const p = row.data.profile;
      if (p.lastEveningCheckinSentDate === today) {
        results.push({ user: row.user_id, skipped: "already sent today" });
        continue;
      }
      try {
        const sid = (await sendSms({ to: p.phone, message: MESSAGE })).sid;
        await supabase.from("user_data")
          .update({ data: { ...row.data, profile: { ...p, lastEveningCheckinSentDate: today } } })
          .eq("user_id", row.user_id);
        results.push({ user: row.user_id, sent: true, sid });
      } catch (err) {
        results.push({ user: row.user_id, error: err.message });
      }
    }
    return Response.json({ ok: true, date: today, results });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
