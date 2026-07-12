import { NextResponse } from "next/server";
import { getEngineState, addWaitingTrade, updateWaitingTrade, ensureEngineRunning, flushSoundEvents } from "@/lib/trade-engine";

// GET /next-api/trades — returns current engine state for frontend to display
export async function GET() {
  try {
    ensureEngineRunning();
    const state = getEngineState();
    const soundEvents = flushSoundEvents();
    return NextResponse.json({ ...state, soundEvents });
  } catch (error) {
    console.error("[API] GET /next-api/trades error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /next-api/trades — add a new waiting trade
export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.symbol || !/^NIFTY\d{2}[A-Z]{3}\d{2}\d+(CE|PE)$/.test(body.symbol) &&
        !/^SENSEX\d{2}[A-Z]{3}\d+(CE|PE)$/.test(body.symbol) &&
        !/^SENSEX\d{2}\d{1}\d{2}\d+(CE|PE)$/.test(body.symbol)) {
      return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });
    }
    addWaitingTrade(body);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

// PUT /next-api/trades — update an existing waiting trade's config
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const updated = updateWaitingTrade(body);
    if (!updated) {
      return NextResponse.json({ error: "Waiting trade not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
