import { NextResponse } from "next/server";
import { getAiGuardSettings, buildCompactCandles, buildMarketMetrics, buildSystemPrompt, getProviderConfig, getNextApiKey } from "@/lib/ai-guard";

// POST /next-api/ai/TEMP_analyze-test — parse pasted CSV candle data, build prompt, call AI provider
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { candleText, symbol, apiKey } = body;

    if (!candleText || typeof candleText !== "string") {
      return NextResponse.json({ error: "No candle data provided" }, { status: 400 });
    }

    const settings = getAiGuardSettings();
    const effectiveApiKey = apiKey || getNextApiKey();
    const provider = settings.provider || "groq";
    const config = getProviderConfig(provider);
    if (!effectiveApiKey) {
      return NextResponse.json({ error: `No API key configured. Set your ${config.providerName} API key in AI Guard settings first.` }, { status: 400 });
    }

    // Parse CSV lines: time,open,high,low,close,volume
    const lines = candleText.trim().split("\n");
    const candles: { time: string; open: number; high: number; low: number; close: number }[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.toLowerCase().startsWith("time,") || trimmed.toLowerCase().startsWith("date,")) continue;

      const parts = trimmed.split(",");
      if (parts.length < 5) continue;

      const time = parts[0].trim();
      const o = parseFloat(parts[1]);
      const h = parseFloat(parts[2]);
      const l = parseFloat(parts[3]);
      const cl = parseFloat(parts[4]);

      if (isNaN(o) || isNaN(h) || isNaN(l) || isNaN(cl)) continue;

      candles.push({ time, open: o, high: h, low: l, close: cl });
    }

    if (candles.length === 0) {
      return NextResponse.json({ error: "No valid candle data found. Expected format: time,open,high,low,close[,volume]" }, { status: 400 });
    }

    const candleCount = settings.candlesCount || 120;
    const recentCandlesCount = settings.recentCandlesCount || 30;
    const displaySymbol = symbol || "TEST_SYMBOL";

    // Build the same prompt structure as production
    const metrics = buildMarketMetrics(candles, candleCount, recentCandlesCount);
    const compactCandles = buildCompactCandles(candles, candleCount);

    let userPrompt = `Symbol: ${displaySymbol}\n`;
    userPrompt += `${metrics}\n\n`;
    userPrompt += `Candles (${Math.min(candles.length, candleCount)}, 1-min OHLC, format: time,open,high,low,close):\n${compactCandles}`;

    // Call AI provider
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(config.url, {
      method: "POST",
      headers: config.headers(effectiveApiKey),
      body: JSON.stringify(config.buildBody(buildSystemPrompt(recentCandlesCount), userPrompt, 200)),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return NextResponse.json({
        error: `${config.providerName} API error: ${res.status} ${res.statusText}`,
        rawResponse: errText,
      }, { status: 502 });
    }

    const data = await res.json();
    const content = config.parseContent(data);

    let parsed: unknown = null;
    try {
      parsed = JSON.parse(content);
    } catch {
      // AI returned non-JSON
    }

    return NextResponse.json({
      candleCount: candles.length,
      usedCount: Math.min(candles.length, candleCount),
      promptSent: userPrompt,
      rawResponse: content,
      parsed,
      model: settings.model || "llama-3.1-8b-instant",
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return NextResponse.json({ error: "AI API timeout (15s)" }, { status: 504 });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
