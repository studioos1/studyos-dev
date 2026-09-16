import { createClient } from "@supabase/supabase-js";

// College calendar lookup via Claude's web_search tool.
//
// Shared cross-user cache (2026-09-15): checks public.college_calendar_cache BEFORE ever calling
// Anthropic, and upserts a fresh result into it after a real call — so the SAME school+anchor
// combo only ever costs a real, paid web-search call once (reused until that cached term's own
// end date passes), not once per user per lookup. Requires the caller to be signed in (same
// Bearer-token pattern as /api/sms/send) so the per-request Supabase client can read/write the
// cache table under RLS (see "authenticated read/insert/update calendar cache" in
// supabase/schema.sql) — every real caller (Onboard, SchoolInfo) already has a session by the
// time this route is ever hit, so this doesn't change real usage, just closes an open route.
//
// Prompt shape (2026-09-15 revision): leads with a single, simple, human-style search query
// ("what is the current or upcoming term at X?") instead of front-loading every field the app
// needs before any search happens. Empirically verified via direct API calls (not just guessed):
// the original multi-ask-up-front prompt gave UCSD specifically an inconsistent/wrong result
// across repeated runs — once silently null, once confidently pulling term dates from UCSD
// Extended Studies (a different calendar than the regular undergraduate one) — because a school
// with several *.edu-domain calendars (main campus vs. extension/professional programs) gives the
// model no signal on which is authoritative when the prompt's own first move is a broad, compound
// search. Leading with the simple, targeted query instead got the correct date (2026-12-12,
// matching UCSD's real Fall 2026 finals end) and the correct source (blink.ucsd.edu, not
// Extended Studies) consistently across 3 repeated test runs. Address dropped entirely per
// explicit product decision — it wasn't actually needed here.
//
// Optional `afterDate`: for a school the user is already enrolled at (adding their NEXT term, not
// their first), "current or upcoming" would just re-fetch the term they already have on record.
// Passing the end date of their latest known term anchors the search on the term that comes AFTER
// it instead — same query-first principle, just anchored to a specific date rather than "today."
//
// max_uses:2 (was 5) — real reported complaint ("it took >20 sec"). Empirically verified via
// direct, repeated API calls (not guessed): with the query-first prompt, a real answer typically
// resolves in exactly 2 searches, and the model just keeps searching for extra confirmation up to
// whatever cap it's given rather than stopping once it already has one. Capped runs (2 searches)
// returned IDENTICAL dates/holidays/source to uncapped runs (up to 4 searches) on the same hardest
// case tested (UCSD's afterDate lookup) in ~11s vs. ~21s — no accuracy loss observed. Worst-case
// degradation for a genuinely harder-to-find school is more `null` fields (the prompt already
// says to use null rather than guess), not wrong data — a safe tradeoff.
export async function POST(req) {
  try {
    const { schoolName, afterDate } = await req.json();
    if (!schoolName) return Response.json({ error: "schoolName is required" }, { status: 400 });
    if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.includes("your-api-key-here")) {
      return Response.json({ error: "Add your API key to the .env file" }, { status: 500 });
    }

    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return Response.json({ error: "Not signed in." }, { status: 401 });
    // Forwards the caller's own JWT so RLS evaluates cache reads/writes as that signed-in user,
    // rather than a service-role key with no per-row policy at all.
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: authUser, error: authErr } = await db.auth.getUser(token);
    if (authErr || !authUser?.user) return Response.json({ error: "Not signed in." }, { status: 401 });

    const today = new Date().toISOString().split("T")[0];
    const cacheKey = afterDate || "";
    const { data: cached } = await db.from("college_calendar_cache").select("*")
      .eq("school_name", schoolName).eq("after_date", cacheKey).maybeSingle();
    // A cached row is only reused while its OWN term hasn't ended yet — a deterministic staleness
    // signal (the exact thing that would be wrong to keep serving), not a fixed TTL. A row with no
    // term_end (the earlier lookup couldn't find one) is never reused — better to try again live
    // than keep serving a known-incomplete result.
    if (cached?.term_end && cached.term_end >= today) {
      return Response.json({
        scheduleType: cached.schedule_type, termName: cached.term_name,
        termStart: cached.term_start, termEnd: cached.term_end,
        holidays: cached.holidays, sourceUrl: cached.source_url,
      });
    }
    const searchLine = afterDate
      ? `Search: what is the term at ${schoolName} that comes right after the term ending ${afterDate}?`
      : `Search: what is the current or upcoming term at ${schoolName}?`;
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 2000,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }],
        messages: [
          {
            role: "user",
            content: `Today's date is ${today}. ${searchLine}

Then also find:
- Whether the school runs on a semester or quarter academic system.
- The end date of that term must be the LAST DAY OF FINALS, not the last day of regular classes.
- Every official holiday or break that falls within that term window (federal holidays the school observes, plus any school-specific breaks like Thanksgiving break, spring recess, etc).

Prefer the school's own primary undergraduate academic calendar over a different department's calendar (e.g. Extension, Summer Session, a professional/graduate program) or a third-party aggregator site.

After searching, respond with ONLY a single JSON object in exactly this shape, no other text before or after it:
{
  "scheduleType": "semester" or "quarter",
  "termName": "e.g. Fall 2026",
  "termStart": "YYYY-MM-DD",
  "termEnd": "YYYY-MM-DD",
  "holidays": [
    {"name": "...", "date": "YYYY-MM-DD"},
    {"name": "...", "start": "YYYY-MM-DD", "end": "YYYY-MM-DD"}
  ],
  "sourceUrl": "the official page you found this on"
}
If you genuinely cannot find reliable current information for a field, use null for that field rather than guessing.`,
          },
        ],
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      return Response.json({ error: data?.error?.message || "API error" }, { status: response.status });
    }
    // When web search is used, Claude emits a SEPARATE narration text block before the search
    // and the actual final answer in a LATER text block. Only the LAST text block is the answer.
    const textBlocks = data.content?.filter((b) => b.type === "text").map((b) => b.text || "") || [];
    const lastText = textBlocks[textBlocks.length - 1] || "{}";
    // Extra safety net: pull out just the {...} substring in case stray prose surrounds it.
    const jsonMatch = lastText.match(/\{[\s\S]*\}/);
    const cleaned = jsonMatch ? jsonMatch[0] : lastText.replace(/```json|```/g, "").trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error("StudyOS: college-calendar JSON parse failed. Raw model output:", lastText);
      throw parseErr;
    }
    // Cache the result for the next person who looks up this exact school+anchor — a write
    // failure here shouldn't fail the actual request (the student still gets their answer), just
    // means the NEXT lookup pays for a fresh call too, so it's logged, not thrown.
    const { error: upsertErr } = await db.from("college_calendar_cache").upsert({
      school_name: schoolName, after_date: cacheKey,
      schedule_type: parsed.scheduleType, term_name: parsed.termName,
      term_start: parsed.termStart, term_end: parsed.termEnd,
      holidays: parsed.holidays, source_url: parsed.sourceUrl,
      fetched_at: new Date().toISOString(),
    });
    if (upsertErr) console.error("StudyOS: college-calendar cache upsert failed —", upsertErr.message);
    return Response.json(parsed);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
