import { NextResponse } from "next/server";
import { getWatchdogSettings, setWatchdogSettings } from "@/lib/trade-engine";

export async function GET() {
  try {
    const settings = getWatchdogSettings();
    return NextResponse.json(settings);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch watchdog settings" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    setWatchdogSettings(body);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Failed to update watchdog settings" }, { status: 500 });
  }
}
