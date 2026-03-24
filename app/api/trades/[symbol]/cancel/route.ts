import { NextResponse } from "next/server";
import { cancelWaitingTrade } from "@/lib/trade-engine";

// POST /api/trades/[symbol]/cancel — cancel a waiting trade
export async function POST(_request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  try {
    const { symbol } = await params;
    cancelWaitingTrade(decodeURIComponent(symbol));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
