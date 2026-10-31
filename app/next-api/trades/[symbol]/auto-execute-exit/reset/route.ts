import { NextResponse } from "next/server";
import { resetAutoExecuteExitPrice } from "@/lib/trade-engine";

// POST /next-api/trades/[symbol]/auto-execute-exit/reset — reset/clear auto execute exit price
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  try {
    const { symbol } = await params;
    const ok = resetAutoExecuteExitPrice(decodeURIComponent(symbol));
    return NextResponse.json({ ok });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
