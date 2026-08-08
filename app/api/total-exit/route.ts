import { NextResponse } from "next/server";
import { getTotalExitSettings, setTotalExitSettings } from "@/lib/trade-engine";

export async function GET() {
  try {
    const settings = getTotalExitSettings();
    return NextResponse.json(settings);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch total exit settings" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    setTotalExitSettings(body);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Failed to update total exit settings" }, { status: 500 });
  }
}
