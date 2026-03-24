import { NextResponse } from "next/server";
import { removeHistoryEntry } from "@/lib/trade-engine";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  removeHistoryEntry(decodeURIComponent(id));
  return NextResponse.json({ ok: true });
}
