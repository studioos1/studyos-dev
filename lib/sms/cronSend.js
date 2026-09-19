import { createClient } from "@supabase/supabase-js";

// Server-only helpers shared by the scheduled SMS cron routes (app/api/cron/*). Deliberately kept
// out of lib/supabase.js — that file's own comment says "the real secret [service-role key] is
// never referenced anywhere in this codebase," and this file is the one deliberate exception. It
// must never be imported from anything that ships to the client (a component, a client-side lib
// module) — only from a server route.

// Single-user app right now, no per-user timezone stored anywhere yet — every scheduled send
// treats "today" and the cron's own fire time as this fixed zone. Real known limitation: the
// Vercel Cron schedule itself (vercel.json) is a static UTC time, so the actual fire time drifts
// by an hour across a DST transition until the UTC value is manually adjusted twice a year — this
// zone (used for what DATE counts as "today" when building the message) stays DST-correct via
// Intl regardless, so a drifted fire time still sends the right day's content, just not exactly
// at 8:30/8:00 on the two DST-transition days each year.
export const CRON_TZ = "America/Los_Angeles";

export function todayInTZ(tz = CRON_TZ, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t) => parts.find(p => p.type === t).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` on every Cron Job invocation
// when a CRON_SECRET env var is set — this is what stops the route from being a public "text
// every opted-in user right now" endpoint anyone could hit.
export function verifyCronAuth(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return (req.headers.get("authorization") || "") === `Bearer ${secret}`;
}

export function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service-role isn't configured on the server yet.");
  // persistSession:false — this is a short-lived server process, not a browser session to keep alive.
  return createClient(url, key, { auth: { persistSession: false } });
}

// Same Twilio call as app/api/sms/send/route.js's, factored out so the two never drift apart —
// this one just has no signed-in-user check, since a cron job isn't triggered by anyone's session.
export async function sendSms({ to, message }) {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, TWILIO_MESSAGING_SERVICE_SID } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !(TWILIO_MESSAGING_SERVICE_SID || TWILIO_FROM_NUMBER))
    throw new Error("SMS isn't configured on the server yet.");
  const body = new URLSearchParams({
    To: to, Body: message,
    ...(TWILIO_MESSAGING_SERVICE_SID ? { MessagingServiceSid: TWILIO_MESSAGING_SERVICE_SID } : { From: TWILIO_FROM_NUMBER }),
  });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64"),
    },
    body,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.message || "Twilio error");
  return json;
}

// Same trust bar Preferences already enforces for the manual "Send me a test text" button: the
// master switch on, this specific reminder not individually turned off, AND the number actually
// test-verified — not just typed in (p.phone === p.smsVerifiedPhone, same check Sett.jsx's own
// phoneVerified uses). A user who never finished verifying never gets an automatic text.
export function eligibleUsers(rows, toggleKey) {
  return (rows || []).filter(({ data }) => {
    const p = data?.profile;
    if (!p || !p.smsEnabled) return false;
    if (p[toggleKey] === false) return false;
    if (!p.phone || p.phone !== p.smsVerifiedPhone) return false;
    return true;
  });
}
