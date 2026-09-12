// Course difficulty lookup — B-01. Runs web search so the estimate is grounded in real signal
// (course reviews, grade-distribution discussion, workload reports) rather than pure model
// guesswork, and self-reports how much it actually found — real CAPE-style data is usually gated
// behind a school login, so this is meant to be a starting point the student can override, never
// presented as authoritative. Called once per NEW course (schedule import / syllabus sync), never
// per assignment — see lib/api.js's CI().
export async function POST(req) {
  try {
    const { courseName, courseCode, schoolName } = await req.json();
    const school = schoolName?.trim() || "the student's college";
    const searchRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 1200,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
        messages: [
          {
            role: "user",
            content: `You are a college academic advisor helping a student plan their study time. Search the web for real information about this specific course before answering — reviews, grade-distribution or workload discussion (e.g. Reddit, RateMyProfessor, course forums), anything that speaks to actual difficulty at this school.

School: ${school}
Course: ${courseName} ${courseCode ? `(${courseCode})` : ""}

After searching, return ONLY valid JSON (no other text), in this exact shape:
{
  "difficultyScore": 7,
  "difficultyLabel": "Heavy",
  "weeklyStudyHours": 8,
  "startExamPrepDays": 7,
  "description": "one sentence about what makes this course challenging or manageable, based on what you found",
  "tips": ["one specific study tip for this subject"],
  "confidence": "medium",
  "rationale": "one sentence on what evidence you actually found — cite it if real (e.g. a specific source/claim), or say plainly that little was found and this is a general estimate"
}

difficultyScore 1-10: 1-3=Light, 4-6=Medium, 7-8=Heavy, 9-10=Intense
weeklyStudyHours: realistic hours needed outside class
startExamPrepDays: how many days before exam to start studying
confidence: "low" | "medium" | "high" — "high" only if you found real, course-specific evidence (grade distributions, detailed reviews); "low" if you're mostly reasoning from the subject/level with little or no course-specific evidence`,
          },
        ],
      }),
    });
    const data = await searchRes.json();
    // Take the LAST text block, not every block joined — with web search on, the response
    // interleaves server_tool_use/web_search_tool_result blocks with the model's own reasoning
    // text between searches; only the final text block is the actual JSON answer.
    const textBlocks = (data.content || []).filter((b) => b.type === "text");
    const text = textBlocks.at(-1)?.text || "{}";
    // Even when told to return ONLY JSON, the model sometimes prefaces it with a sentence of
    // its own (more likely after a multi-search reasoning chain) — pull out just the {...}
    // object rather than assuming the whole block is clean JSON.
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const info = JSON.parse((jsonMatch?.[0] || text).replace(/```json|```/g, "").trim());
    return Response.json(info);
  } catch (err) {
    console.error("StudyOS: course-info lookup failed —", err);
    return Response.json({
      difficultyScore: 5,
      difficultyLabel: "Medium",
      weeklyStudyHours: 6,
      startExamPrepDays: 5,
      confidence: "low",
      rationale: "Automatic fallback — the web lookup failed.",
    });
  }
}
