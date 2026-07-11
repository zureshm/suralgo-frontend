import { NextResponse } from "next/server";
import { getAiLogs } from "@/lib/ai-guard";

// GET /next-api/ai/logs — return AI Guard log lines (500-line ring buffer)
export async function GET() {
  return NextResponse.json({ logs: getAiLogs() });
}
