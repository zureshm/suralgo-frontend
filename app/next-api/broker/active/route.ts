import { NextResponse } from "next/server";
import { setActiveBrokerUrl, getActiveBrokerUrl } from "@/lib/trade-engine";

// GET /next-api/broker/active — returns current active broker URL
export async function GET() {
  return NextResponse.json({ url: getActiveBrokerUrl() });
}

// POST /next-api/broker/active — set active broker execution URL
export async function POST(request: Request) {
  try {
    const { url } = await request.json();
    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "Missing url" }, { status: 400 });
    }
    setActiveBrokerUrl(url);
    return NextResponse.json({ ok: true, url });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

// DELETE /next-api/broker/active — reset to default (Angel One)
export async function DELETE() {
  const defaultUrl = process.env.NEXT_PUBLIC_TRADE_EXECUTION_URL || "http://localhost:5000";
  setActiveBrokerUrl(defaultUrl);
  return NextResponse.json({ ok: true, url: defaultUrl });
}
