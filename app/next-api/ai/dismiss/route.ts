import { NextResponse } from "next/server";
import { dismissAiSuggestion } from "@/lib/trade-engine";

// POST /next-api/ai/dismiss — dismiss AI suggestion for a symbol
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { symbol } = body;
    if (!symbol) {
      return NextResponse.json({ error: "Symbol required" }, { status: 400 });
    }
    dismissAiSuggestion(String(symbol));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
