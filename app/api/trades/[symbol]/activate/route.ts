import { NextResponse } from "next/server";
import { activateWaitingTradeFromClient } from "@/lib/trade-engine";

// POST /api/trades/[symbol]/activate — activate a waiting trade (called by frontend on BUY signal)
export async function POST(request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  try {
    const { symbol } = await params;
    const body = await request.json();
    const { entryPrice, logLine, candleSize } = body;
    activateWaitingTradeFromClient(decodeURIComponent(symbol), entryPrice, logLine, candleSize);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
