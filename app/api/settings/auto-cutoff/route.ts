import { NextResponse } from "next/server";
import { getAutoCutoffSettings, setAutoCutoffSettings } from "@/lib/trade-engine";

export async function GET() {
  try {
    const settings = getAutoCutoffSettings();
    return NextResponse.json(settings);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch auto cutoff settings" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    setAutoCutoffSettings(body);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Failed to update auto cutoff settings" }, { status: 500 });
  }
}
