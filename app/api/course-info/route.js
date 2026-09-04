// Course difficulty lookup. Ported verbatim from the old server.js; logic unchanged.
// NOTE: still hard-codes "De Anza College" in the prompt — fixing that is a later step (C4).
export async function POST(req) {
  try {
    const { courseName, courseCode } = await req.json();
    const searchRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 500,
        messages: [
          {
            role: "user",
            content: `You are a college academic advisor. Rate this De Anza College course for difficulty and study time needed.

Course: ${courseName} ${courseCode ? `(${courseCode})` : ""}

Return ONLY valid JSON:
{
  "difficultyScore": 7,
  "difficultyLabel": "Heavy",
  "weeklyStudyHours": 8,
  "startExamPrepDays": 7,
  "description": "one sentence about what makes this course challenging or manageable",
  "tips": ["one specific study tip for this subject"]
}

difficultyScore 1-10: 1-3=Light, 4-6=Medium, 7-8=Heavy, 9-10=Intense
weeklyStudyHours: realistic hours needed outside class
startExamPrepDays: how many days before exam to start studying`,
          },
        ],
      }),
    });
    const data = await searchRes.json();
    const text = data.content?.map((b) => b.text || "").join("") || "{}";
    const info = JSON.parse(text.replace(/```json|```/g, "").trim());
    return Response.json(info);
  } catch (err) {
    return Response.json({
      difficultyScore: 5,
      difficultyLabel: "Medium",
      weeklyStudyHours: 6,
      startExamPrepDays: 5,
    });
  }
}
