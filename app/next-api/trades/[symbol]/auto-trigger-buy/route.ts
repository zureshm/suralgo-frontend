import { NextResponse } from "next/server";
import { setAutoTriggerBuyPrice } from "@/lib/trade-engine";

// POST /next-api/trades/[symbol]/auto-trigger-buy — set auto trigger buy price for a waiting or active trade
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
    const ok = setAutoTriggerBuyPrice(decodeURIComponent(symbol), triggerPrice);
    return NextResponse.json({ ok, autoTriggerBuyPrice: triggerPrice });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
