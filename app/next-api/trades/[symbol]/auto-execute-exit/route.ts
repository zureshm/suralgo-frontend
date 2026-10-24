import { NextResponse } from "next/server";
import { setAutoExecuteExitPrice } from "@/lib/trade-engine";

// POST /next-api/trades/[symbol]/auto-execute-exit — arm auto execute exit at a price for an in-position active trade
export async function POST(
  request: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  try {
    const { symbol } = await params;
    const body = await request.json();
    const triggerPrice = Number(body?.triggerPrice);
    if (!Number.isFinite(triggerPrice) || triggerPrice <= 0) {
      return NextResponse.json({ error: "Invalid trigger price" }, { status: 400 });
    }
    const ok = setAutoExecuteExitPrice(decodeURIComponent(symbol), triggerPrice);
    if (!ok) {
      return NextResponse.json({ ok, error: "No active in-position trade for symbol" }, { status: 409 });
    }
    return NextResponse.json({ ok, autoExecuteExitPrice: triggerPrice });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
