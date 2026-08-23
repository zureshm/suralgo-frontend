import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  return NextResponse.json({ time: `${h}:${m}:${s}`, hours: now.getHours(), minutes: now.getMinutes(), seconds: now.getSeconds() });
}
