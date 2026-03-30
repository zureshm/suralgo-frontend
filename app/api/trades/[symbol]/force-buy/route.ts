import { NextResponse } from "next/server";
import { forceBuyWaitingTrade } from "@/lib/trade-engine";

// POST /api/trades/[symbol]/force-buy — force activate a waiting trade at current LTP
export async function POST(_request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  try {
    const { symbol } = await params;
    await forceBuyWaitingTrade(decodeURIComponent(symbol));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
