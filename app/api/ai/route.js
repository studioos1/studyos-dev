// Server-side proxy to the Anthropic API — keeps the key off the client.
// Ported verbatim from the old server.js; logic unchanged.
export async function POST(req) {
  try {
    const { system, prompt, maxTokens = 1500, temperature, model } = await req.json();
    if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.includes("your-api-key-here")) {
      return Response.json({ error: "Add your API key to the .env file" }, { status: 500 });
    }
    const messages = system
      ? [{ role: "user", content: `[INSTRUCTIONS]\n${system}\n\n[REQUEST]\n${prompt}` }]
      : [{ role: "user", content: prompt }];
    const body = { model: model || "claude-sonnet-4-5", max_tokens: maxTokens, messages };
    // temperature is opt-in per call — most calls benefit from the model's default variety;
    // extraction/classification calls pass temperature:0 explicitly to minimize run-to-run drift.
    if (temperature !== undefined) body.temperature = temperature;
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) {
      return Response.json({ error: data?.error?.message || "API error" }, { status: response.status });
    }
    const text = data.content?.map((b) => b.text || "").join("") || "";
    return Response.json({ text });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
