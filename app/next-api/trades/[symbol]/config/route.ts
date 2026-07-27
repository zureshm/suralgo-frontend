import { NextResponse } from "next/server";
import { updateActiveTradeConfig } from "@/lib/trade-engine";

// PUT /next-api/trades/[symbol]/config — override active trade config (safe fields only)
export async function PUT(request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  try {
    const { symbol } = await params;
    const body = await request.json();
    const updated = updateActiveTradeConfig(decodeURIComponent(symbol), body);
    if (!updated) {
      return NextResponse.json({ error: "Active trade not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
