// AI Guard — server-side module for Groq API calls and settings storage

import fs from "fs";
import path from "path";

const AI_SETTINGS_PATH = path.join(process.cwd(), "data", "ai-guard-settings.json");

// ---- Log capture (2000-line ring buffer, same as angel-feed server) ----
const MAX_AI_LOG_LINES = 2000;
const _g = globalThis as unknown as { __aiLogBuffer?: string[] };
if (!_g.__aiLogBuffer) _g.__aiLogBuffer = [];
const aiLogBuffer: string[] = _g.__aiLogBuffer;

export function addAiLog(line: string) {
  aiLogBuffer.push(line);
  if (aiLogBuffer.length > MAX_AI_LOG_LINES) aiLogBuffer.shift();
  console.log(line);
}

export function addAiErrorLog(line: string) {
  aiLogBuffer.push(line);
  if (aiLogBuffer.length > MAX_AI_LOG_LINES) aiLogBuffer.shift();
  console.error(line);
}

export function getAiLogs(): string[] {
  return [...aiLogBuffer];
}

export function clearAiLogs(): void {
  aiLogBuffer.length = 0;
}

export type AiGuardSettings = {
  enabled: boolean;
  entryGuardEnabled: boolean;
  autoExitEnabled: boolean;
  confidenceThreshold: number;
  candlesCount: number;
  recentCandlesCount: number;
  considerVolume: boolean;
  useHeikinAshi: boolean;
  provider: string;
  model: string;
  apiKeys: string[];
};

export const GROQ_MODELS = [
  { value: "openai/gpt-oss-20b", label: "GPT OSS 20B — fast, low cost" },
  { value: "openai/gpt-oss-120b", label: "GPT OSS 120B — highest quality (recommended)" },
  { value: "qwen/qwen3.6-27b", label: "Qwen 3.6 27B — preview" },
];

export type AiAnalysisResult = {
  marketRegime: string;
  blockEntry: boolean;
  suggestExit: boolean;
  confidence: number;
  reason: string;
  rangeHigh?: number;
  rangeLow?: number;
};

export type AiSuggestion = {
  symbol: string;
  type: "ENTRY_BLOCKED" | "EXIT_SUGGESTED";
  marketRegime: string;
  confidence: number;
  reason: string;
  timestamp: string;
  dismissed: boolean;
};

const DEFAULT_SETTINGS: AiGuardSettings = {
  enabled: false,
  entryGuardEnabled: false,
  autoExitEnabled: false,
  confidenceThreshold: 70,
  candlesCount: 120,
  provider: "groq",
  model: "openai/gpt-oss-120b",
  recentCandlesCount: 30,
  considerVolume: false,
  useHeikinAshi: true,
  apiKeys: [],
};

let aiGuardSettings: AiGuardSettings = { ...DEFAULT_SETTINGS };
let aiConnected = false;

export function getAiGuardSettings(): AiGuardSettings {
  return { ...aiGuardSettings };
}

export function setAiGuardSettings(settings: Partial<AiGuardSettings>) {
  aiGuardSettings = { ...aiGuardSettings, ...settings };
  saveAiSettingsToDisk();
}

export function loadAiSettingsFromDisk() {
  try {
    if (fs.existsSync(AI_SETTINGS_PATH)) {
      const raw = fs.readFileSync(AI_SETTINGS_PATH, "utf-8");
      const data = JSON.parse(raw);
      aiGuardSettings = { ...DEFAULT_SETTINGS, ...data };
      // Migrate old single apiKey to apiKeys array
      if (typeof (data as Record<string, unknown>).apiKey === "string" && !aiGuardSettings.apiKeys?.length) {
        const oldKey = (data as Record<string, unknown>).apiKey as string;
        if (oldKey) aiGuardSettings.apiKeys = [oldKey];
      }
      addAiLog(`[ai-guard] Loaded settings from disk (provider: ${aiGuardSettings.provider}, keys: ${aiGuardSettings.apiKeys?.length || 0})`);
    }
  } catch (e) {
    addAiErrorLog("[ai-guard] Failed to load settings from disk: " + String(e));
  }
}

function saveAiSettingsToDisk() {
  try {
    const dir = path.dirname(AI_SETTINGS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(AI_SETTINGS_PATH, JSON.stringify(aiGuardSettings, null, 2), "utf-8");
  } catch (e) {
    addAiErrorLog("[ai-guard] Failed to save settings to disk: " + String(e));
  }
}

export function isAiConnected(): boolean {
  return aiConnected;
}

export function setAiConnected(connected: boolean) {
  aiConnected = connected;
}

export function isAiGuardActive(): boolean {
  return aiGuardSettings.enabled && (aiGuardSettings.apiKeys?.length || 0) > 0 && aiConnected;
}

let apiKeyIndex = 0;
export function getNextApiKey(): string {
  const keys = aiGuardSettings.apiKeys || [];
  if (keys.length === 0) return "";
  const key = keys[apiKeyIndex % keys.length];
  apiKeyIndex++;
  return key;
}

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-3-5-haiku-20241022";

type ProviderConfig = {
  url: string;
  model: string;
  headers: (apiKey: string) => Record<string, string>;
  buildBody: (systemPrompt: string, userPrompt: string, maxTokens: number) => Record<string, unknown>;
  parseContent: (data: { choices?: { message?: { content?: string } }[]; content?: { text?: string }[] }) => string;
  providerName: string;
};

const PROVIDERS: Record<string, ProviderConfig> = {
  groq: {
    url: GROQ_URL,
    model: "",
    headers: (apiKey) => ({ "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }),
    buildBody: (systemPrompt, userPrompt, maxTokens) => ({
      model: aiGuardSettings.model || "openai/gpt-oss-120b",
      temperature: 0,
      max_completion_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
    parseContent: (data) => data?.choices?.[0]?.message?.content || "",
    providerName: "Groq",
  },
  claude: {
    url: ANTHROPIC_URL,
    model: ANTHROPIC_MODEL,
    headers: (apiKey) => ({ "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" }),
    buildBody: (systemPrompt, userPrompt, maxTokens) => ({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [
        { role: "user", content: userPrompt },
      ],
    }),
    parseContent: (data) => data?.content?.[0]?.text || "",
    providerName: "Claude",
  },
};

export function getProviderConfig(provider: string): ProviderConfig {
  return PROVIDERS[provider] || PROVIDERS.groq;
}

export function convertToHeikinAshi(candles: { time?: string; open: number; high: number; low: number; close: number }[]): { time?: string; open: number; high: number; low: number; close: number }[] {
  const ha: { time?: string; open: number; high: number; low: number; close: number }[] = [];
  for (let i = 0; i < candles.length; i++) {
    const o = Number(candles[i].open);
    const h = Number(candles[i].high);
    const l = Number(candles[i].low);
    const c = Number(candles[i].close);
    const haClose = (o + h + l + c) / 4;
    const haOpen = i === 0 ? (o + c) / 2 : (ha[i - 1].open + ha[i - 1].close) / 2;
    const haHigh = Math.max(h, haOpen, haClose);
    const haLow = Math.min(l, haOpen, haClose);
    ha.push({ time: candles[i].time, open: haOpen, high: haHigh, low: haLow, close: haClose });
  }
  return ha;
}

export function buildSystemPrompt(recentCandles: number, useHA: boolean = true): string {
  const candleNote = useHA
    ? "Note: Candle data is in Heikin-Ashi format (smoothed OHLC). Consecutive same-color candles indicate trend; small bodies with both wicks indicate sideways."
    : "Note: Candle data is in raw OHLC format. Consecutive same-color candles indicate trend; small bodies with both wicks indicate sideways.";
  const primaryLine = useHA
    ? "Primary analysis: Read the Heikin-Ashi candle data. Look at the actual price action — are candles making higher highs and higher lows (upwards), lower highs and lower lows (downwards), or bouncing between the same levels (sideways)?"
    : "Primary analysis: Read the raw OHLC candle data. Look at the actual price action — are candles making higher highs and higher lows (upwards), lower highs and lower lows (downwards), or bouncing between the same levels (sideways)?";
  return `You are a market regime classifier for Nifty option symbols on 1-minute charts.

Classify the market into one of three regimes:
- UPWARDS: Price making higher highs and higher lows with upward momentum. blockEntry=false, suggestExit=false.
- SIDEWAYS: Price oscillating in a range without clear direction. This is the default when there is no sustained trend. blockEntry=true, suggestExit=true.
- DOWNWARDS: Price making lower highs and lower lows with downward momentum. blockEntry=true, suggestExit=true.

${candleNote}

${primaryLine}

Secondary: Use the pre-computed metrics as supplementary context only. They are raw facts, not signals.

You receive two metric windows:
- Full window: shows the overall session context
- Recent ${recentCandles} candles: shows the current immediate price action

If the recent ${recentCandles} candles show a different regime than the full window, weight the recent window a bit more heavily — the current regime matters more for trade decisions than what happened before ${recentCandles} minutes.

Key: Nifty option premiums are volatile. A 4% net move on a ₹100 option is just 4 points and may still be sideways. Judge by the actual candle pattern, not by percentage thresholds.

Return ONLY valid JSON:
{
  "marketRegime": "UPWARDS" | "SIDEWAYS" | "DOWNWARDS",
  "blockEntry": boolean,
  "suggestExit": boolean,
  "confidence": number (0-100),
  "reason": "brief explanation",
  "rangeHigh": number or null,
  "rangeLow": number or null
}`;
}

export const SYSTEM_PROMPT = buildSystemPrompt(30);

export function buildSystemPromptWithVolume(recentCandles: number, useHA: boolean = true): string {
  const candleNote = useHA
    ? "Note: Candle data is in Heikin-Ashi format (smoothed OHLC) with volume. Consecutive same-color candles indicate trend; small bodies with both wicks indicate sideways."
    : "Note: Candle data is in raw OHLC format with volume. Consecutive same-color candles indicate trend; small bodies with both wicks indicate sideways.";
  const primaryLine = useHA
    ? "Primary analysis: Read the Heikin-Ashi candle data. Look at the actual price action — are candles making higher highs and higher lows (upwards), lower highs and lower lows (downwards), or bouncing between the same levels (sideways)?"
    : "Primary analysis: Read the raw OHLC candle data. Look at the actual price action — are candles making higher highs and higher lows (upwards), lower highs and lower lows (downwards), or bouncing between the same levels (sideways)?";
  return `You are a market regime classifier for Nifty option symbols on 1-minute charts.

Classify the market into one of three regimes:
- UPWARDS: Price making higher highs and higher lows with upward momentum. blockEntry=false, suggestExit=false.
- SIDEWAYS: Price oscillating in a range without clear direction. This is the default when there is no sustained trend. blockEntry=true, suggestExit=true.
- DOWNWARDS: Price making lower highs and lower lows with downward momentum. blockEntry=true, suggestExit=true.

${candleNote}

${primaryLine}

Volume analysis (use as confirmation):
- High volume on directional candles = stronger trend conviction.
- Low volume on price moves = likely sideways or fakeout.
- Volume divergence (price rising but volume falling) can signal an impending reversal.
- Volume spikes at turning points confirm reversals.

Secondary: Use the pre-computed metrics (including volume metrics) as supplementary context only. They are raw facts, not signals.

You receive two metric windows:
- Full window: shows the overall session context
- Recent ${recentCandles} candles: shows the current immediate price action

If the recent ${recentCandles} candles show a different regime than the full window, weight the recent window a bit more heavily — the current regime matters more for trade decisions than what happened before ${recentCandles} minutes.

Key: Nifty option premiums are volatile. A 4% net move on a ₹100 option is just 4 points and may still be sideways. Judge by the actual candle pattern and volume confirmation, not by percentage thresholds.

Return ONLY valid JSON:
{
  "marketRegime": "UPWARDS" | "SIDEWAYS" | "DOWNWARDS",
  "blockEntry": boolean,
  "suggestExit": boolean,
  "confidence": number (0-100),
  "reason": "brief explanation",
  "rangeHigh": number or null,
  "rangeLow": number or null
}`;
}

export function buildCompactCandles(candles: any[], maxCount: number, considerVolume: boolean = false, useHeikinAshi: boolean = true): string {
  if (!Array.isArray(candles) || candles.length === 0) return "";
  const processedCandles = useHeikinAshi ? convertToHeikinAshi(candles) : candles;
  const slice = processedCandles.slice(-maxCount);
  return slice
    .map((c: any, i: number) => {
      const time = c.time || "";
      const o = Number(c.open).toFixed(2);
      const h = Number(c.high).toFixed(2);
      const l = Number(c.low).toFixed(2);
      const cl = Number(c.close).toFixed(2);
      if (considerVolume) {
        // Get volume from original candles (HA transform doesn't carry volume)
        const origIndex = candles.length - slice.length + i;
        const vol = origIndex >= 0 && origIndex < candles.length ? (candles[origIndex].volume || 0) : 0;
        return `${time},${o},${h},${l},${cl},${vol}`;
      }
      return `${time},${o},${h},${l},${cl}`;
    })
    .join("|");
}

export function buildMarketMetrics(candles: any[], maxCount: number, recentCandlesCount: number = 30, considerVolume: boolean = false, useHeikinAshi: boolean = true): string {
  if (!Array.isArray(candles) || candles.length === 0) return "No data";
  const processedCandles = useHeikinAshi ? convertToHeikinAshi(candles) : candles;
  const slice = processedCandles.slice(-maxCount);
  const n = slice.length;

  let high = -Infinity, low = Infinity;
  let totalBodySize = 0;
  let dirChanges = 0;
  let maxConsecutiveSame = 0;
  let currentConsecutive = 1;
  let prevDir: "up" | "down" | null = null;

  for (const c of slice) {
    const o = Number(c.open);
    const cl = Number(c.close);
    const h = Number(c.high);
    const l = Number(c.low);

    if (h > high) high = h;
    if (l < low) low = l;

    totalBodySize += Math.abs(cl - o);

    let dir: "up" | "down";
    if (cl >= o) dir = "up";
    else dir = "down";

    if (prevDir) {
      if (dir !== prevDir) {
        dirChanges++;
        maxConsecutiveSame = Math.max(maxConsecutiveSame, currentConsecutive);
        currentConsecutive = 1;
      } else {
        currentConsecutive++;
      }
    }
    prevDir = dir;
  }
  maxConsecutiveSame = Math.max(maxConsecutiveSame, currentConsecutive);

  const rangeWidth = high - low;
  const avgBody = totalBodySize / n;
  const lastClose = Number(slice[n - 1].close);
  const rangePosition = rangeWidth > 0 ? ((lastClose - low) / rangeWidth) * 100 : 50;
  const dirChangeRatio = n > 1 ? (dirChanges / (n - 1)) * 100 : 0;
  const bodyToRangeRatio = rangeWidth > 0 ? (avgBody / rangeWidth) * 100 : 0;

  // Net move over full period
  const firstOpen = Number(slice[0].open);
  const netMove = lastClose - firstOpen;
  const netMovePct = firstOpen !== 0 ? (netMove / firstOpen) * 100 : 0;

  // Recent vs older range (last 30% vs 10-40%)
  const recentStart = Math.floor(n * 0.7);
  const olderEnd = Math.floor(n * 0.4);
  const olderStart = Math.floor(n * 0.1);
  let recentHigh = -Infinity, recentLow = Infinity;
  let olderHigh = -Infinity, olderLow = Infinity;
  for (let i = recentStart; i < n; i++) {
    const h = Number(slice[i].high);
    const l = Number(slice[i].low);
    if (h > recentHigh) recentHigh = h;
    if (l < recentLow) recentLow = l;
  }
  for (let i = olderStart; i < olderEnd && i < n; i++) {
    const h = Number(slice[i].high);
    const l = Number(slice[i].low);
    if (h > olderHigh) olderHigh = h;
    if (l < olderLow) olderLow = l;
  }
  const recentWidth = recentHigh > -Infinity ? recentHigh - recentLow : 0;
  const olderWidth = olderHigh > -Infinity ? olderHigh - olderLow : 0;
  const rangeNarrowing = olderWidth > 0 ? ((olderWidth - recentWidth) / olderWidth) * 100 : 0;

  // Last 10 candles net move
  const last10Start = Math.max(0, n - 10);
  const last10Open = Number(slice[last10Start].open);
  const last10Close = Number(slice[n - 1].close);
  const last10Move = last10Close - last10Open;
  const last10MovePct = last10Open !== 0 ? (last10Move / last10Open) * 100 : 0;

  // Recent N-candle window (separate analysis for regime shift detection)
  const recentNStart = Math.max(0, n - recentCandlesCount);
  const recentN = slice.slice(recentNStart);
  const rn = recentN.length;
  let rnHigh = -Infinity, rnLow = Infinity, rnBodySum = 0, rnDirChanges = 0;
  let rnPrevDir: "up" | "down" | null = null;
  for (const c of recentN) {
    const o = Number(c.open), cl = Number(c.close), h = Number(c.high), l = Number(c.low);
    if (h > rnHigh) rnHigh = h;
    if (l < rnLow) rnLow = l;
    rnBodySum += Math.abs(cl - o);
    const d: "up" | "down" = cl >= o ? "up" : "down";
    if (rnPrevDir && d !== rnPrevDir) rnDirChanges++;
    rnPrevDir = d;
  }
  const rnWidth = rnHigh > -Infinity ? rnHigh - rnLow : 0;
  const rnAvgBody = rn > 0 ? rnBodySum / rn : 0;
  const rnFirstOpen = Number(recentN[0].open);
  const rnLastClose = Number(recentN[rn - 1].close);
  const rnNetMove = rnLastClose - rnFirstOpen;
  const rnNetMovePct = rnFirstOpen !== 0 ? (rnNetMove / rnFirstOpen) * 100 : 0;
  const rnDirRatio = rn > 1 ? (rnDirChanges / (rn - 1)) * 100 : 0;

  const lines = [
    `Market Data (${n} candles):`,
    `- Session High: ${high.toFixed(2)}`,
    `- Session Low: ${low.toFixed(2)}`,
    `- Range Width: ${rangeWidth.toFixed(2)}`,
    `- Avg Candle Body: ${avgBody.toFixed(2)} (${bodyToRangeRatio.toFixed(1)}% of range width)`,
    `- Direction Changes: ${dirChanges}/${n - 1} (${dirChangeRatio.toFixed(0)}%)`,
    `- Max Consecutive Same Direction: ${maxConsecutiveSame} candles`,
    `- Price Position in Range: ${rangePosition.toFixed(0)}%`,
    `- Recent Volatility (last 30%): ${recentWidth.toFixed(2)}`,
    `- Older Volatility (10-40%): ${olderWidth.toFixed(2)}`,
    `- Volatility Change: ${rangeNarrowing > 0 ? "-" : "+"}${Math.abs(rangeNarrowing).toFixed(0)}%`,
    `- Net Move (${n} candles): ${netMove >= 0 ? "+" : ""}${netMove.toFixed(2)} (${netMovePct.toFixed(2)}%)`,
    `- Last 10 Candle Net Move: ${last10Move >= 0 ? "+" : ""}${last10Move.toFixed(2)} (${last10MovePct.toFixed(2)}%)`,
    ``,
    `Recent ${recentCandlesCount} Candles (last ${recentCandlesCount} min):`,
    `- Range: ${rnLow.toFixed(2)} - ${rnHigh.toFixed(2)} (width: ${rnWidth.toFixed(2)})`,
    `- Avg Body: ${rnAvgBody.toFixed(2)}`,
    `- Direction Changes: ${rnDirChanges}/${rn - 1} (${rnDirRatio.toFixed(0)}%)`,
    `- Net Move: ${rnNetMove >= 0 ? "+" : ""}${rnNetMove.toFixed(2)} (${rnNetMovePct.toFixed(2)}%)`,
  ];

  // Volume metrics (when considerVolume is enabled)
  if (considerVolume) {
    const origSlice = candles.slice(-maxCount);
    let totalVol = 0, upVol = 0, downVol = 0;
    for (let i = 0; i < slice.length && i < origSlice.length; i++) {
      const vol = origSlice[i].volume || 0;
      totalVol += vol;
      const o = Number(slice[i].open), cl = Number(slice[i].close);
      if (cl >= o) upVol += vol;
      else downVol += vol;
    }
    const avgVol = n > 0 ? totalVol / n : 0;

    // Recent N volume
    const rnOrigSlice = candles.slice(-recentCandlesCount);
    let rnTotalVol = 0, rnUpVol = 0, rnDownVol = 0;
    for (let i = 0; i < rnOrigSlice.length; i++) {
      const vol = rnOrigSlice[i].volume || 0;
      rnTotalVol += vol;
      const o = Number(rnOrigSlice[i].open), cl = Number(rnOrigSlice[i].close);
      if (cl >= o) rnUpVol += vol;
      else rnDownVol += vol;
    }
    const rnAvgVol = rnOrigSlice.length > 0 ? rnTotalVol / rnOrigSlice.length : 0;

    // Volume trend: compare recent avg vs full avg
    const volTrend = avgVol > 0 ? ((rnAvgVol - avgVol) / avgVol) * 100 : 0;

    lines.push(``);
    lines.push(`Volume Analysis:`);
    lines.push(`- Avg Volume (full): ${avgVol.toFixed(0)}`);
    lines.push(`- Volume on Up Candles: ${upVol.toFixed(0)} | Down Candles: ${downVol.toFixed(0)}`);
    lines.push(`- Up/Down Volume Ratio: ${downVol > 0 ? (upVol / downVol).toFixed(2) : "∞"}`);
    lines.push(`- Recent ${recentCandlesCount} Avg Volume: ${rnAvgVol.toFixed(0)} (${volTrend >= 0 ? "+" : ""}${volTrend.toFixed(0)}% vs full)`);
    lines.push(`- Recent Up Vol: ${rnUpVol.toFixed(0)} | Down Vol: ${rnDownVol.toFixed(0)}`);
  }

  return lines.join("\n");
}

export async function analyzeMarketRegime(
  symbol: string,
  candles: any[],
  tradeContext?: { entryPrice?: string; ltp?: number; pnl?: number; signal?: string }
): Promise<AiAnalysisResult> {
  const settings = getAiGuardSettings();
  const candleCount = settings.candlesCount || 120;
  const useVolume = settings.considerVolume || false;
  const useHA = settings.useHeikinAshi !== false;
  const compactCandles = buildCompactCandles(candles, candleCount, useVolume, useHA);

  const recentCandlesCount = settings.recentCandlesCount || 30;
  const metrics = buildMarketMetrics(candles, candleCount, recentCandlesCount, useVolume, useHA);

  let userPrompt = `Symbol: ${symbol}\n`;
  if (tradeContext) {
    if (tradeContext.entryPrice) userPrompt += `Entry: ${tradeContext.entryPrice} | `;
    if (tradeContext.ltp != null) userPrompt += `LTP: ${tradeContext.ltp} | `;
    if (tradeContext.pnl != null) userPrompt += `P/L: ${tradeContext.pnl.toFixed(2)} | `;
    if (tradeContext.signal) userPrompt += `Signal: ${tradeContext.signal}`;
    userPrompt += "\n";
  }
  userPrompt += `${metrics}\n\n`;
  const candleFormat = useVolume ? "time,open,high,low,close,volume" : "time,open,high,low,close";
  const candleType = useHA ? "Heikin-Ashi OHLC" : "raw OHLC";
  userPrompt += `Candles (${candleCount}, 1-min ${candleType}, format: ${candleFormat}):\n${compactCandles}`;

  const systemPrompt = useVolume ? buildSystemPromptWithVolume(recentCandlesCount, useHA) : buildSystemPrompt(recentCandlesCount, useHA);

  try {
    const provider = settings.provider || "groq";
    const config = getProviderConfig(provider);
    const keyIndex = apiKeyIndex;
    const apiKey = getNextApiKey();
    addAiLog(`[ai-guard] ${symbol}: using API key #${keyIndex % (aiGuardSettings.apiKeys?.length || 1)}${useVolume ? " (with volume)" : ""}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(config.url, {
      method: "POST",
      headers: config.headers(apiKey),
      body: JSON.stringify(config.buildBody(systemPrompt, userPrompt, 4096)),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      addAiErrorLog(`[ai-guard] ${config.providerName} API error: ${res.status} ${res.statusText} (key #${keyIndex % (aiGuardSettings.apiKeys?.length || 1)})`);
      return { marketRegime: "UNKNOWN", blockEntry: false, suggestExit: false, confidence: 0, reason: "AI unavailable" };
    }

    const data = await res.json();
    const content = config.parseContent(data);
    if (!content) {
      const finishReason = data?.choices?.[0]?.finish_reason || "unknown";
      const usage = data?.usage;
      addAiErrorLog(`[ai-guard] Empty AI response (finish_reason=${finishReason}, completion_tokens=${usage?.completion_tokens || 0}, reasoning_tokens=${usage?.completion_tokens_details?.reasoning_tokens || 0})`);
      return { marketRegime: "UNKNOWN", blockEntry: false, suggestExit: false, confidence: 0, reason: "AI returned empty response (reasoning budget exhausted)" };
    }
    // Strip <think>...</think> reasoning tags from GPT-OSS models
    const stripped = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    const cleaned = (stripped || content).replace(/```/g, "").replace(/^\s*json\s*/i, "").trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      addAiErrorLog(`[ai-guard] No JSON found in AI response: ${cleaned.slice(0, 120)}`);
      return { marketRegime: "UNKNOWN", blockEntry: false, suggestExit: false, confidence: 0, reason: "AI returned non-JSON response" };
    }
    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      // Try to find the last complete JSON object (greedy match may overshoot)
      const lastBrace = jsonMatch[0].lastIndexOf("}");
      const candidate = jsonMatch[0].slice(0, lastBrace + 1);
      parsed = JSON.parse(candidate);
    }

    return {
      marketRegime: parsed.marketRegime || "UNKNOWN",
      blockEntry: Boolean(parsed.blockEntry),
      suggestExit: Boolean(parsed.suggestExit),
      confidence: Number(parsed.confidence) || 0,
      reason: parsed.reason || "",
      rangeHigh: parsed.rangeHigh != null ? Number(parsed.rangeHigh) : undefined,
      rangeLow: parsed.rangeLow != null ? Number(parsed.rangeLow) : undefined,
    };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      addAiErrorLog(`[ai-guard] ${getProviderConfig(settings.provider || "groq").providerName} API timeout`);
    } else {
      addAiErrorLog("[ai-guard] analyzeMarketRegime error: " + String(e));
    }
    return { marketRegime: "UNKNOWN", blockEntry: false, suggestExit: false, confidence: 0, reason: "AI unavailable" };
  }
}

export async function testApiKey(provider: string, apiKey: string): Promise<{ connected: boolean; error?: string }> {
  const config = getProviderConfig(provider);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(config.url, {
      method: "POST",
      headers: config.headers(apiKey),
      body: JSON.stringify(config.buildBody("", "Reply with: OK", 256)),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (res.ok) {
      return { connected: true };
    }
    if (res.status === 401) {
      return { connected: false, error: "Invalid API key" };
    }
    if (res.status === 429) {
      return { connected: false, error: "Rate limit reached" };
    }
    return { connected: false, error: `${config.providerName} returned ${res.status}` };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { connected: false, error: `Cannot reach ${config.providerName} (timeout)` };
    }
    return { connected: false, error: `Cannot reach ${config.providerName}` };
  }
}
