// College calendar lookup via Claude's web_search tool. Ported verbatim from the old
// server.js; logic and parsing comments unchanged.
export async function POST(req) {
  try {
    const { schoolName } = await req.json();
    if (!schoolName) return Response.json({ error: "schoolName is required" }, { status: 400 });
    if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.includes("your-api-key-here")) {
      return Response.json({ error: "Add your API key to the .env file" }, { status: 500 });
    }
    const today = new Date().toISOString().split("T")[0];
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
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
        messages: [
          {
            role: "user",
            content: `Today's date is ${today}. Search for "${schoolName}"'s official academic calendar. Prefer the school's own .edu domain over aggregator sites. Find:
1. The school's main campus mailing address.
2. Whether it runs on a semester or quarter academic system.
3. The CURRENT term if one is in progress today, otherwise the NEXT upcoming term — its name, start date, and end date (the end date must be the LAST DAY OF FINALS, not the last day of regular classes).
4. Every official holiday or break that falls within that term window (federal holidays the school observes, plus any school-specific breaks like Thanksgiving break, spring recess, etc).

After searching, respond with ONLY a single JSON object in exactly this shape, no other text before or after it:
{
  "address": "street address, city, state zip",
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
    return Response.json(parsed);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
