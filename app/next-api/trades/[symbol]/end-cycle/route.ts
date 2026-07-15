import { NextResponse } from "next/server";
import { manualEndCycle } from "@/lib/trade-engine";

// POST /next-api/trades/[symbol]/end-cycle — manually end current buy cycle (sell at LTP, keep trade active)
export async function POST(_request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  try {
    const { symbol } = await params;
    await manualEndCycle(decodeURIComponent(symbol));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
