import { NextResponse } from "next/server";
import { setAiSymbolEnabled } from "@/lib/trade-engine";

// POST /next-api/ai/symbol-toggle — enable/disable AI Guard for a specific symbol
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const symbol = String(body.symbol || "");
    const enabled = Boolean(body.enabled);
    if (!symbol) {
      return NextResponse.json({ error: "Symbol required" }, { status: 400 });
    }
    setAiSymbolEnabled(symbol, enabled);
    return NextResponse.json({ ok: true, symbol, enabled });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
