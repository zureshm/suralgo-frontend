import { NextResponse } from "next/server";
import { forceInitSymbol } from "@/lib/trade-engine";

// POST /next-api/trades/[symbol]/force-init — force symbol into initialized set (skip history check)
export async function POST(_request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  try {
    const { symbol } = await params;
    forceInitSymbol(decodeURIComponent(symbol));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
