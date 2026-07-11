import { NextResponse } from "next/server";
import { testApiKey, setAiConnected } from "@/lib/ai-guard";

// POST /next-api/ai/test — test API key validity
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const provider = String(body.provider || "groq");
    const rawKeys = String(body.apiKeys || body.apiKey || "");
    const firstKey = rawKeys.split("\n").map((k: string) => k.trim()).filter(Boolean)[0] || "";

    if (!firstKey) {
      return NextResponse.json({ connected: false, error: "No API key provided" });
    }

    const result = await testApiKey(provider, firstKey);
    setAiConnected(result.connected);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ connected: false, error: "Invalid request" }, { status: 400 });
  }
}
