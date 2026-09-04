export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    status: "ok",
    hasApiKey: !!(
      process.env.ANTHROPIC_API_KEY &&
      !process.env.ANTHROPIC_API_KEY.includes("your-api-key-here")
    ),
    time: new Date().toISOString(),
  });
}
