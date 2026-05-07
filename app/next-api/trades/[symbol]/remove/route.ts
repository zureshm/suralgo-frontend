import { NextResponse } from "next/server";
import { removeCompletedTrade } from "@/lib/trade-engine";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params;
  removeCompletedTrade(decodeURIComponent(symbol));
  return NextResponse.json({ ok: true });
}
