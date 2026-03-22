import { NextResponse } from "next/server";
import { getEngineState, addWaitingTrade, ensureEngineRunning } from "@/lib/trade-engine";

// GET /api/trades — returns current engine state for frontend to display
export async function GET() {
  ensureEngineRunning();
  const state = getEngineState();
  return NextResponse.json(state);
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
