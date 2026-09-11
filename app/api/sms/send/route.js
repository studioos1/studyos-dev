import { createClient } from "@supabase/supabase-js";

// Server-side SMS sender via Twilio. This is a PAID, abusable action (arbitrary phone number +
// message text), so unlike /api/ai it is never left open to anonymous callers — the caller must
// present a valid Supabase session, proving they're a real logged-in StudyOS user. That's enough
// gating for this route's actual job: a user explicitly sending a message on their own behalf
// (e.g. "send me a test text" in Preferences). It does NOT restrict `to` to the caller's own
// stored phone number — the client already only ever passes profile.phone. Phase 2's scheduled
// reminders run from a separate service-role cron route, not through this one.
export async function POST(req) {
  try {
    const { to, message } = await req.json();
    if (!to || !message) return Response.json({ error: "Missing 'to' or 'message'." }, { status: 400 });
    const to164 = String(to).replace(/[\s()-]/g, "");
    if (!/^\+?[1-9]\d{7,14}$/.test(to164))
      return Response.json({ error: "That doesn't look like a valid phone number — use +1XXXXXXXXXX." }, { status: 400 });
    if (message.length > 480) return Response.json({ error: "Message is too long." }, { status: 400 });

    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return Response.json({ error: "Not signed in." }, { status: 401 });
    const authClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const { data: { user }, error: authErr } = await authClient.auth.getUser(token);
    if (authErr || !user) return Response.json({ error: "Not signed in." }, { status: 401 });

    const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = process.env;
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER)
      return Response.json({ error: "SMS isn't configured on the server yet." }, { status: 500 });

    const body = new URLSearchParams({ To: to164, From: TWILIO_FROM_NUMBER, Body: message });
    const twilioRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: "Basic " + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64"),
        },
        body,
      }
    );
    const twilioData = await twilioRes.json();
    if (!twilioRes.ok) return Response.json({ error: twilioData?.message || "Twilio error" }, { status: twilioRes.status });
    return Response.json({ ok: true, sid: twilioData.sid });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
