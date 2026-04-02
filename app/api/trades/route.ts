import { NextResponse } from "next/server";
import { getEngineState, addWaitingTrade, updateWaitingTrade, ensureEngineRunning } from "@/lib/trade-engine";

// GET /api/trades — returns current engine state for frontend to display
export async function GET() {
  try {
    ensureEngineRunning();
    const state = getEngineState();
    return NextResponse.json(state);
  } catch (error) {
    console.error("[API] GET /api/trades error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/trades — add a new waiting trade
export async function POST(request: Request) {
  try {
    const body = await request.json();
    addWaitingTrade(body);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

// PUT /api/trades — update an existing waiting trade's config
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
