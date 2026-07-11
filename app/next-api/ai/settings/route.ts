import { NextResponse } from "next/server";
import { getAiGuardSettings, setAiGuardSettings } from "@/lib/ai-guard";

// GET /next-api/ai/settings — return current AI guard settings (real apiKey for cross-device visibility)
export async function GET() {
  const settings = getAiGuardSettings();
  return NextResponse.json(settings);
}

// POST /next-api/ai/settings — save AI guard settings from frontend
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const rawKeys = String(body.apiKeys || body.apiKey || "");
    const apiKeys = rawKeys.split("\n").map((k: string) => k.trim()).filter(Boolean);
    setAiGuardSettings({
      enabled: Boolean(body.enabled),
      entryGuardEnabled: Boolean(body.entryGuardEnabled),
      autoExitEnabled: Boolean(body.autoExitEnabled),
      confidenceThreshold: Number(body.confidenceThreshold) || 70,
      candlesCount: Number(body.candlesCount) || 120,
      recentCandlesCount: Number(body.recentCandlesCount) || 30,
      provider: String(body.provider || "groq"),
      model: String(body.model || "llama-3.1-8b-instant"),
      apiKeys,
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
