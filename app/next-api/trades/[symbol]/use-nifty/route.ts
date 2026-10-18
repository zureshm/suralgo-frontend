import { NextResponse } from "next/server";
import { bindNiftySignal, unbindNiftySignal } from "@/lib/trade-engine";

// POST /next-api/trades/[symbol]/use-nifty — bind symbol to the FAKE_CE/FAKE_PE
// index signal stream; body { enabled: false } reverts to its own candles.
export async function POST(request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  try {
    const { symbol } = await params;
    const decoded = decodeURIComponent(symbol);
    const body = await request.json().catch(() => ({}));
    if (body?.enabled === false) unbindNiftySignal(decoded);
    else bindNiftySignal(decoded);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
