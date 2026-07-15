import { NextResponse } from "next/server";
import { forceBuyActiveTrade } from "@/lib/trade-engine";

// POST /api/trades/[symbol]/force-buy-active — force buy an active trade that is between cycles
export async function POST(_request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  try {
    const { symbol } = await params;
    await forceBuyActiveTrade(decodeURIComponent(symbol));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
