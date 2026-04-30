import { NextResponse } from "next/server";
import { getWatchlist, addWatchlistSymbol, removeWatchlistSymbol } from "@/lib/trade-engine";

// GET /api/watchlist — returns current watchlist symbols
export async function GET() {
  return NextResponse.json({ symbols: getWatchlist() });
}

// POST /api/watchlist — add a symbol  { symbol: "NIFTY..." }
export async function POST(request: Request) {
  try {
    const { symbol } = await request.json();
    if (!symbol || typeof symbol !== "string") {
      return NextResponse.json({ error: "Missing symbol" }, { status: 400 });
    }
    addWatchlistSymbol(symbol);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

// DELETE /api/watchlist — remove a symbol  { symbol: "NIFTY..." }
export async function DELETE(request: Request) {
  try {
    const { symbol } = await request.json();
    if (!symbol || typeof symbol !== "string") {
      return NextResponse.json({ error: "Missing symbol" }, { status: 400 });
    }
    removeWatchlistSymbol(symbol);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
