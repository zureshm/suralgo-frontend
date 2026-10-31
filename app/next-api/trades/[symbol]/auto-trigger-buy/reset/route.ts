import { NextResponse } from "next/server";
import { resetAutoTriggerBuyPrice } from "@/lib/trade-engine";

// POST /next-api/trades/[symbol]/auto-trigger-buy/reset — reset/clear auto trigger buy price
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  try {
    const { symbol } = await params;
    const ok = resetAutoTriggerBuyPrice(decodeURIComponent(symbol));
    return NextResponse.json({ ok });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
