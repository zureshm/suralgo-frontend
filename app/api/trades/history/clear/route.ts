import { NextResponse } from "next/server";
import { clearHistory } from "@/lib/trade-engine";

export async function POST() {
  clearHistory();
  return NextResponse.json({ ok: true });
}
