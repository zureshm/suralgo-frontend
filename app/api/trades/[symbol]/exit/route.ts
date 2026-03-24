import { NextResponse } from "next/server";
import { manualExit } from "@/lib/trade-engine";

// POST /api/trades/[symbol]/exit — manual exit
export async function POST(request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  try {
    const { symbol } = await params;
    const body = await request.json();
    manualExit(decodeURIComponent(symbol), body.exitPrice, body.lastCandleTime);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
