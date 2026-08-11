import { NextResponse } from "next/server";
import { retryHistoryFetch } from "@/lib/trade-engine";

// POST /next-api/trades/[symbol]/retry-history — retry history fetch for a force-initialized symbol
export async function POST(_request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  try {
    const { symbol } = await params;
    retryHistoryFetch(decodeURIComponent(symbol));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
