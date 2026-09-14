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

export type RuleBreakdownEntry = {
  name: string;
  value: string;
  triggered: boolean;
};

export type AiAnalysisResult = {
  marketRegime: string;
  blockEntry: boolean;
  suggestExit: boolean;
  confidence: number;
  reason: string;
  rangeHigh?: number;
  rangeLow?: number;
  ruleBreakdown?: RuleBreakdownEntry[];
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
  provider: "local",
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
  if (aiGuardSettings.provider === "local" || aiGuardSettings.provider === "local_v2" || aiGuardSettings.provider === "local_v3" || aiGuardSettings.provider === "local_v4") {
    return aiGuardSettings.enabled;
  }
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

// ── Local Rule Engine ──

const UPWARDS_REASONS = [
  (v: { consec: number; netMove: string }) => `Strong uptrend: ${v.consec} consecutive bullish candles, net move ${v.netMove}`,
  (v: { rnNetPct: string }) => `Upward momentum confirmed: recent candles show higher highs, net move ${v.rnNetPct}`,
  (v: { rangePos: string }) => `Bullish bias: price at ${v.rangePos}% of range, buying pressure dominant`,
  (v: { last10: string }) => `Trending up: last 10 candles net move ${v.last10}, consistent direction`,
  (v: { consec: number }) => `Uptrend intact: ${v.consec} consecutive same-direction candles with upward bias`,
  (v: { rnNetPct: string; rangePos: string }) => `Higher highs and higher lows: net move ${v.rnNetPct}, range position ${v.rangePos}%`,
];

const SIDEWAYS_REASONS = [
  (v: { dirRatio: string }) => `Sideways: direction change ratio ${v.dirRatio} — price oscillating without clear direction`,
  (v: { bodyRange: string }) => `Choppy market: body-to-range ratio ${v.bodyRange}, small candles with no conviction`,
  (v: { dirRatio: string; rnDirRatio: string }) => `Range-bound: full dir changes ${v.dirRatio}, recent dir changes ${v.rnDirRatio}`,
  (v: { narrowing: string }) => `Volatility narrowing: range compressed by ${v.narrowing}, no breakout`,
  (v: { rnNetPct: string }) => `No trend: recent net move only ${v.rnNetPct}, price stuck in range`,
  (v: { last10: string; bodyRange: string }) => `Sideways: last 10 candle move ${v.last10}, body-to-range ${v.bodyRange}`,
];

const DOWNWARDS_REASONS = [
  (v: { consec: number; netMove: string }) => `Strong downtrend: ${v.consec} consecutive bearish candles, net move ${v.netMove}`,
  (v: { rnNetPct: string }) => `Downward momentum: recent candles show lower highs, net move ${v.rnNetPct}`,
  (v: { rangePos: string }) => `Bearish bias: price at ${v.rangePos}% of range, selling pressure dominant`,
  (v: { last10: string }) => `Trending down: last 10 candles net move ${v.last10}, consistent selling`,
  (v: { consec: number }) => `Downtrend intact: ${v.consec} consecutive same-direction candles with downward bias`,
  (v: { rnNetPct: string; rangePos: string }) => `Lower highs and lower lows: net move ${v.rnNetPct}, range position ${v.rangePos}%`,
];

export function analyzeMarketRegimeLocal(
  symbol: string,
  candles: any[],
  tradeContext?: { entryPrice?: string; ltp?: number; pnl?: number; signal?: string }
): AiAnalysisResult {
  const settings = getAiGuardSettings();
  const candleCount = settings.candlesCount || 120;
  const useHA = settings.useHeikinAshi !== false;
  const recentCandlesCount = settings.recentCandlesCount || 30;

  if (!Array.isArray(candles) || candles.length === 0) {
    return { marketRegime: "UNKNOWN", blockEntry: false, suggestExit: false, confidence: 0, reason: "No candle data" };
  }

  // Apply Heikin-Ashi if enabled
  const processedCandles = useHA ? convertToHeikinAshi(candles) : candles;
  const slice = processedCandles.slice(-candleCount);
  const n = slice.length;

  if (n === 0) {
    return { marketRegime: "UNKNOWN", blockEntry: false, suggestExit: false, confidence: 0, reason: "No candle data after slicing" };
  }

  // ── Compute metrics (same as buildMarketMetrics but as numeric values) ──

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

  // Last 10 candles net move
  const last10Start = Math.max(0, n - 10);
  const last10Open = Number(slice[last10Start].open);
  const last10Close = Number(slice[n - 1].close);
  const last10Move = last10Close - last10Open;
  const last10MovePct = last10Open !== 0 ? (last10Move / last10Open) * 100 : 0;

  // Recent N-candle window
  const recentNStart = Math.max(0, n - recentCandlesCount);
  const recentN = slice.slice(recentNStart);
  const rn = recentN.length;
  let rnHigh = -Infinity, rnLow = Infinity, rnDirChanges = 0;
  let rnMaxConsecutive = 0, rnCurrentConsecutive = 1;
  let rnPrevDir: "up" | "down" | null = null;

  for (const c of recentN) {
    const o = Number(c.open), cl = Number(c.close), h = Number(c.high), l = Number(c.low);
    if (h > rnHigh) rnHigh = h;
    if (l < rnLow) rnLow = l;
    const d: "up" | "down" = cl >= o ? "up" : "down";
    if (rnPrevDir) {
      if (d !== rnPrevDir) {
        rnDirChanges++;
        rnMaxConsecutive = Math.max(rnMaxConsecutive, rnCurrentConsecutive);
        rnCurrentConsecutive = 1;
      } else {
        rnCurrentConsecutive++;
      }
    }
    rnPrevDir = d;
  }
  rnMaxConsecutive = Math.max(rnMaxConsecutive, rnCurrentConsecutive);

  const rnFirstOpen = Number(recentN[0].open);
  const rnLastClose = Number(recentN[rn - 1].close);
  const rnNetMove = rnLastClose - rnFirstOpen;
  const rnNetMovePct = rnFirstOpen !== 0 ? (rnNetMove / rnFirstOpen) * 100 : 0;
  const rnDirRatio = rn > 1 ? (rnDirChanges / (rn - 1)) * 100 : 0;

  // Volatility narrowing
  const recentStart = Math.floor(n * 0.7);
  const olderEnd = Math.floor(n * 0.4);
  const olderStart = Math.floor(n * 0.1);
  let recentHigh2 = -Infinity, recentLow2 = Infinity;
  let olderHigh = -Infinity, olderLow = Infinity;
  for (let i = recentStart; i < n; i++) {
    const h = Number(slice[i].high);
    const l = Number(slice[i].low);
    if (h > recentHigh2) recentHigh2 = h;
    if (l < recentLow2) recentLow2 = l;
  }
  for (let i = olderStart; i < olderEnd && i < n; i++) {
    const h = Number(slice[i].high);
    const l = Number(slice[i].low);
    if (h > olderHigh) olderHigh = h;
    if (l < olderLow) olderLow = l;
  }
  const recentWidth2 = recentHigh2 > -Infinity ? recentHigh2 - recentLow2 : 0;
  const olderWidth = olderHigh > -Infinity ? olderHigh - olderLow : 0;
  const rangeNarrowing = olderWidth > 0 ? ((olderWidth - recentWidth2) / olderWidth) * 100 : 0;

  // ── Rule engine (10 rules) ──

  const breakdown: RuleBreakdownEntry[] = [];
  let sidewaysScore = 0;
  let trendScore = 0;
  let trendDirection: "up" | "down" = "up";

  // Rule 1: Direction change ratio (full) > 60% → SIDEWAYS
  const r1Triggered = dirChangeRatio > 60;
  if (r1Triggered) sidewaysScore += 2;
  breakdown.push({ name: "Dir change ratio (full)", value: `${dirChangeRatio.toFixed(0)}%`, triggered: r1Triggered });

  // Rule 2: Direction change ratio (recent) > 60% → SIDEWAYS
  const r2Triggered = rnDirRatio > 60;
  if (r2Triggered) sidewaysScore += 2;
  breakdown.push({ name: "Dir change ratio (recent)", value: `${rnDirRatio.toFixed(0)}%`, triggered: r2Triggered });

  // Rule 3: Body-to-range ratio < 20% → SIDEWAYS
  const r3Triggered = bodyToRangeRatio < 20;
  if (r3Triggered) sidewaysScore += 2;
  breakdown.push({ name: "Body-to-range ratio", value: `${bodyToRangeRatio.toFixed(1)}%`, triggered: r3Triggered });

  // Rule 4: Volatility narrowing > 30% → SIDEWAYS
  const r4Triggered = rangeNarrowing > 30;
  if (r4Triggered) sidewaysScore += 1;
  breakdown.push({ name: "Volatility narrowing", value: `${rangeNarrowing > 0 ? "-" : "+"}${Math.abs(rangeNarrowing).toFixed(0)}%`, triggered: r4Triggered });

  // Rule 5: Net move (recent N) abs < 2% → SIDEWAYS
  const r5Triggered = Math.abs(rnNetMovePct) < 2;
  if (r5Triggered) sidewaysScore += 1;
  breakdown.push({ name: "Net move (recent)", value: `${rnNetMovePct >= 0 ? "+" : ""}${rnNetMovePct.toFixed(2)}%`, triggered: r5Triggered });

  // Rule 6: Last 10 candle net move abs < 1.5% → SIDEWAYS
  const r6Triggered = Math.abs(last10MovePct) < 1.5;
  if (r6Triggered) sidewaysScore += 1;
  breakdown.push({ name: "Last 10 move", value: `${last10MovePct >= 0 ? "+" : ""}${last10MovePct.toFixed(2)}%`, triggered: r6Triggered });

  // Rule 7: Max consecutive same dir (full) >= 5 → TREND
  const r7Triggered = maxConsecutiveSame >= 5;
  if (r7Triggered) trendScore += 2;
  breakdown.push({ name: "Max consecutive (full)", value: `${maxConsecutiveSame} candles`, triggered: r7Triggered });

  // Rule 8: Max consecutive same dir (recent) >= 4 → TREND
  const r8Triggered = rnMaxConsecutive >= 4;
  if (r8Triggered) trendScore += 2;
  breakdown.push({ name: "Max consecutive (recent)", value: `${rnMaxConsecutive} candles`, triggered: r8Triggered });

  // Rule 9: Net move (recent N) abs >= 2% → TREND
  const r9Triggered = Math.abs(rnNetMovePct) >= 2;
  if (r9Triggered) trendScore += 2;
  breakdown.push({ name: "Net move strength (recent)", value: `${Math.abs(rnNetMovePct).toFixed(2)}%`, triggered: r9Triggered });

  // Rule 10: Last 10 candle net move abs >= 1.5% → TREND
  const r10Triggered = Math.abs(last10MovePct) >= 1.5;
  if (r10Triggered) trendScore += 1;
  breakdown.push({ name: "Last 10 move strength", value: `${Math.abs(last10MovePct).toFixed(2)}%`, triggered: r10Triggered });

  // Determine direction from net moves
  if (rnNetMove < 0 || last10Move < 0) trendDirection = "down";
  else trendDirection = "up";

  // ── Decision ──

  let marketRegime: string;
  let blockEntry: boolean;
  let suggestExit: boolean;
  let confidence: number;
  let reason: string;
  let rangeHigh: number | undefined;
  let rangeLow: number | undefined;

  if (sidewaysScore > trendScore) {
    marketRegime = "SIDEWAYS";
    blockEntry = true;
    suggestExit = true;
    confidence = Math.min(95, 60 + sidewaysScore * 5);
    if (rnHigh > -Infinity) rangeHigh = rnHigh;
    if (rnLow < Infinity) rangeLow = rnLow;

    // Pick reason based on which rules triggered
    const reasons = SIDEWAYS_REASONS;
    let reasonIdx = 0;
    if (r1Triggered) reasonIdx = 0;
    else if (r3Triggered) reasonIdx = 1;
    else if (r2Triggered) reasonIdx = 2;
    else if (r4Triggered) reasonIdx = 3;
    else if (r5Triggered) reasonIdx = 4;
    else reasonIdx = 5;
    reason = reasons[reasonIdx]({
      dirRatio: `${dirChangeRatio.toFixed(0)}%`,
      rnDirRatio: `${rnDirRatio.toFixed(0)}%`,
      bodyRange: `${bodyToRangeRatio.toFixed(1)}%`,
      narrowing: `${Math.abs(rangeNarrowing).toFixed(0)}%`,
      rnNetPct: `${rnNetMovePct.toFixed(2)}%`,
      last10: `${last10MovePct.toFixed(2)}%`,
    });
  } else if (trendScore >= 3) {
    if (trendDirection === "up") {
      marketRegime = "UPWARDS";
      blockEntry = false;
      suggestExit = false;
      confidence = Math.min(95, 65 + trendScore * 5);

      const reasons = UPWARDS_REASONS;
      let reasonIdx = 0;
      if (r7Triggered) reasonIdx = 0;
      else if (r9Triggered) reasonIdx = 1;
      else if (rangePosition > 60) reasonIdx = 2;
      else if (r10Triggered) reasonIdx = 3;
      else if (r8Triggered) reasonIdx = 4;
      else reasonIdx = 5;
      reason = reasons[reasonIdx]({
        consec: maxConsecutiveSame,
        netMove: `${netMovePct.toFixed(2)}%`,
        rnNetPct: `${rnNetMovePct.toFixed(2)}%`,
        rangePos: `${rangePosition.toFixed(0)}%`,
        last10: `${last10MovePct.toFixed(2)}%`,
      });
    } else {
      marketRegime = "DOWNWARDS";
      blockEntry = true;
      suggestExit = true;
      confidence = Math.min(95, 65 + trendScore * 5);

      const reasons = DOWNWARDS_REASONS;
      let reasonIdx = 0;
      if (r7Triggered) reasonIdx = 0;
      else if (r9Triggered) reasonIdx = 1;
      else if (rangePosition < 40) reasonIdx = 2;
      else if (r10Triggered) reasonIdx = 3;
      else if (r8Triggered) reasonIdx = 4;
      else reasonIdx = 5;
      reason = reasons[reasonIdx]({
        consec: maxConsecutiveSame,
        netMove: `${netMovePct.toFixed(2)}%`,
        rnNetPct: `${rnNetMovePct.toFixed(2)}%`,
        rangePos: `${rangePosition.toFixed(0)}%`,
        last10: `${last10MovePct.toFixed(2)}%`,
      });
    }
  } else {
    // Ambiguous — conservative default
    marketRegime = "SIDEWAYS";
    blockEntry = true;
    suggestExit = true;
    confidence = 65;
    if (rnHigh > -Infinity) rangeHigh = rnHigh;
    if (rnLow < Infinity) rangeLow = rnLow;
    reason = `Ambiguous signals: sideways score ${sidewaysScore}, trend score ${trendScore} — defaulting to sideways`;
  }

  addAiLog(`[ai-guard:local] ${symbol}: ${marketRegime} (${confidence}%) — ${reason}`);

  return {
    marketRegime,
    blockEntry,
    suggestExit,
    confidence,
    reason,
    rangeHigh,
    rangeLow,
    ruleBreakdown: breakdown,
  };
}

// ── Helper: Exponential Moving Average ──
function calculateEMA(prices: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const emaArray: number[] = new Array(prices.length);
  if (prices.length === 0) return emaArray;
  emaArray[0] = prices[0];
  for (let i = 1; i < prices.length; i++) {
    emaArray[i] = prices[i] * k + emaArray[i - 1] * (1 - k);
  }
  return emaArray;
}

// ── Local Rule Engine V2 (Choppy & Spike Guard) ──

export function analyzeMarketRegimeLocalV2(
  symbol: string,
  candles: any[],
  tradeContext?: { entryPrice?: string; ltp?: number; pnl?: number; signal?: string }
): AiAnalysisResult {
  const settings = getAiGuardSettings();
  const candleCount = settings.candlesCount || 120;
  const useHA = settings.useHeikinAshi !== false;

  if (!Array.isArray(candles) || candles.length === 0) {
    return { marketRegime: "UNKNOWN", blockEntry: false, suggestExit: false, confidence: 0, reason: "No candle data" };
  }

  const rawSlice = candles.slice(-candleCount);
  const n = rawSlice.length;
  if (n < 5) {
    return { marketRegime: "UNKNOWN", blockEntry: false, suggestExit: false, confidence: 0, reason: "Insufficient candle history for V2 engine (min 5 required)" };
  }

  const closes = rawSlice.map((c) => Number(c.close));
  const highs = rawSlice.map((c) => Number(c.high));
  const lows = rawSlice.map((c) => Number(c.low));
  const opens = rawSlice.map((c) => Number(c.open));
  const lastClose = closes[n - 1];

  // 1. EMA 10 & EMA 30 Calculation
  const ema10 = calculateEMA(closes, 10);
  const ema30 = calculateEMA(closes, 30);
  const currEma10 = ema10[n - 1];
  const currEma30 = ema30[n - 1];
  const emaSpreadPct = lastClose > 0 ? ((currEma10 - currEma30) / lastClose) * 100 : 0;

  const slopeLookback = Math.min(4, n - 1);
  const ema10Slope = slopeLookback > 0 ? ((currEma10 - ema10[n - 1 - slopeLookback]) / ema10[n - 1 - slopeLookback]) * 100 : 0;
  const ema30Slope = slopeLookback > 0 ? ((currEma30 - ema30[n - 1 - slopeLookback]) / ema30[n - 1 - slopeLookback]) * 100 : 0;

  // 2. Kaufman Efficiency Ratio (KER) over last 20 bars
  const kerPeriod = Math.min(20, n);
  const kerStart = n - kerPeriod;
  const netDisplacement = Math.abs(closes[n - 1] - closes[kerStart]);
  let totalPath = 0;
  for (let i = kerStart + 1; i < n; i++) {
    totalPath += Math.abs(closes[i] - closes[i - 1]);
  }
  const ker = totalPath > 0 ? netDisplacement / totalPath : 0;

  // 3. EMA 10 Whipsaw / Cross Frequency over last 20 bars
  const whipsawPeriod = Math.min(20, n);
  let emaCrosses = 0;
  let prevDiff = closes[n - whipsawPeriod] - ema10[n - whipsawPeriod];
  for (let i = n - whipsawPeriod + 1; i < n; i++) {
    const diff = closes[i] - ema10[i];
    if ((diff >= 0 && prevDiff < 0) || (diff < 0 && prevDiff >= 0)) {
      emaCrosses++;
    }
    prevDiff = diff;
  }

  // 4. Spike Exhaustion & Bull Trap Detection (SS1 & SS3)
  let atrSum = 0;
  const atrPeriod = Math.min(14, n - 1);
  for (let i = n - atrPeriod; i < n; i++) {
    const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
    atrSum += tr;
  }
  const atr = atrPeriod > 0 ? atrSum / atrPeriod : (highs[n - 1] - lows[n - 1]);

  const lastRange = highs[n - 1] - lows[n - 1];
  const lastUpperWick = highs[n - 1] - Math.max(opens[n - 1], closes[n - 1]);
  const lastUpperWickRatio = lastRange > 0 ? (lastUpperWick / lastRange) * 100 : 0;
  const lastRangeVsAtr = atr > 0 ? lastRange / atr : 1;

  const prevRange = n > 1 ? highs[n - 2] - lows[n - 2] : 0;
  const prevUpperWick = n > 1 ? highs[n - 2] - Math.max(opens[n - 2], closes[n - 2]) : 0;
  const prevUpperWickRatio = prevRange > 0 ? (prevUpperWick / prevRange) * 100 : 0;
  const prevRangeVsAtr = atr > 0 ? prevRange / atr : 1;

  const isRecentSpike = lastRangeVsAtr > 2.0 || prevRangeVsAtr > 2.0;
  const isSevereRejection = lastUpperWickRatio > 40 || (prevUpperWickRatio > 45 && closes[n - 1] < closes[n - 2]);
  const isFlatBase = Math.abs(ema30Slope) < 0.04 && Math.abs(emaSpreadPct) < 0.12;
  const isSpikeTrap = isRecentSpike && (isSevereRejection || isFlatBase);
  const isOverextended = ((lastClose - currEma10) / currEma10) * 100 > 1.6 && Math.abs(ema30Slope) < 0.03;

  // 5. Heikin-Ashi Bilateral Shadow Index & Color Flips (SS3)
  const haCandles = convertToHeikinAshi(rawSlice);
  const haPeriod = Math.min(20, n);
  let bilateralCount = 0;
  let haColorFlips = 0;
  let prevHaGreen = haCandles[n - haPeriod].close >= haCandles[n - haPeriod].open;

  for (let i = n - haPeriod; i < n; i++) {
    const c = haCandles[i];
    const body = Math.abs(c.close - c.open);
    const uw = c.high - Math.max(c.open, c.close);
    const lw = Math.min(c.open, c.close) - c.low;
    if (uw > 0.15 * (body || 1) && lw > 0.15 * (body || 1)) {
      bilateralCount++;
    }
    const isGreen = c.close >= c.open;
    if (isGreen !== prevHaGreen) {
      haColorFlips++;
    }
    prevHaGreen = isGreen;
  }
  const bilateralRatio = (bilateralCount / haPeriod) * 100;

  // 6. Price Riding Above/Below Fast EMA
  let consecutiveAboveEma10 = 0;
  for (let i = n - 1; i >= Math.max(0, n - 8); i--) {
    if (closes[i] >= ema10[i]) consecutiveAboveEma10++;
    else break;
  }
  let consecutiveBelowEma10 = 0;
  for (let i = n - 1; i >= Math.max(0, n - 8); i--) {
    if (closes[i] <= ema10[i]) consecutiveBelowEma10++;
    else break;
  }

  // ── Rule Scoring ──
  const breakdown: RuleBreakdownEntry[] = [];
  let sidewaysScore = 0;
  let trendScore = 0;

  // R1: Kaufman Efficiency Ratio (< 0.24 = high noise chop)
  const r1Triggered = ker < 0.24;
  if (r1Triggered) sidewaysScore += 3;
  breakdown.push({ name: "Kaufman Efficiency Ratio", value: `${ker.toFixed(2)} ${ker < 0.24 ? "(Choppy Noise)" : "(Directional)"}`, triggered: r1Triggered });

  // R2: EMA 10/30 Spread (flat/intertwined < 0.06%)
  const r2Triggered = Math.abs(emaSpreadPct) < 0.06;
  if (r2Triggered) sidewaysScore += 3;
  breakdown.push({ name: "EMA 10/30 Spread", value: `${emaSpreadPct >= 0 ? "+" : ""}${emaSpreadPct.toFixed(2)}% ${r2Triggered ? "(Flat/Intertwined)" : "(Separated)"}`, triggered: r2Triggered });

  // R3: EMA 10 Whipsaw Crosses (>= 4 crosses in 20 bars)
  const r3Triggered = emaCrosses >= 4;
  if (r3Triggered) sidewaysScore += 2;
  breakdown.push({ name: "EMA 10 Whipsaw Crosses", value: `${emaCrosses} crosses / 20 bars`, triggered: r3Triggered });

  // R4: Spike Exhaustion / Bull Trap
  const r4Triggered = isSpikeTrap || isOverextended;
  if (r4Triggered) sidewaysScore += 4;
  breakdown.push({ name: "Spike Exhaustion Trap", value: r4Triggered ? `Triggered (${lastRangeVsAtr.toFixed(1)}x ATR, ${lastUpperWickRatio.toFixed(0)}% wick)` : "Clear (No Trap)", triggered: r4Triggered });

  // R5: Heikin-Ashi Bilateral Shadows (> 35% indecision wicks)
  const r5Triggered = useHA && bilateralRatio > 35;
  if (r5Triggered) sidewaysScore += 2;
  breakdown.push({ name: "HA Bilateral Shadow Ratio", value: `${bilateralRatio.toFixed(0)}% ${r5Triggered ? "(Indecision Wicks)" : "(Decisive)"}`, triggered: r5Triggered });

  // R6: Heikin-Ashi Color Flips (>= 5 flips in 20 bars)
  const r6Triggered = useHA && haColorFlips >= 5;
  if (r6Triggered) sidewaysScore += 2;
  breakdown.push({ name: "HA Direction Flips", value: `${haColorFlips} flips / 20 bars`, triggered: r6Triggered });

  // T1: EMA Bullish Alignment (EMA10 > EMA30 with positive slopes)
  const t1Triggered = currEma10 > currEma30 && ema10Slope > 0.03 && ema30Slope > 0.01;
  if (t1Triggered) trendScore += 3;
  breakdown.push({ name: "EMA Trend Alignment", value: `Fast: ${ema10Slope >= 0 ? "+" : ""}${ema10Slope.toFixed(2)}% | Slow: ${ema30Slope >= 0 ? "+" : ""}${ema30Slope.toFixed(2)}%`, triggered: t1Triggered });

  // T2: High Efficiency Trend (KER >= 0.45)
  const t2Triggered = ker >= 0.45;
  if (t2Triggered) trendScore += 2;
  breakdown.push({ name: "High Trend Efficiency", value: `KER ${ker.toFixed(2)}`, triggered: t2Triggered });

  // T3: Price Riding Above EMA 10 (>= 3 bars)
  const t3Triggered = consecutiveAboveEma10 >= 3;
  if (t3Triggered) trendScore += 2;
  breakdown.push({ name: "Riding Above Fast EMA", value: `${consecutiveAboveEma10} consecutive bars`, triggered: t3Triggered });

  // T4: Clean HA Expansion (bilateral < 20% and no recent trap)
  const t4Triggered = useHA && bilateralRatio < 20 && !r4Triggered && haColorFlips <= 2;
  if (t4Triggered) trendScore += 2;
  breakdown.push({ name: "Clean HA Momentum", value: t4Triggered ? "Confirmed" : "Not Active", triggered: t4Triggered });

  let marketRegime: string;
  let blockEntry: boolean;
  let suggestExit: boolean;
  let confidence: number;
  let reason: string;

  if (r4Triggered) {
    marketRegime = "SIDEWAYS";
    blockEntry = true;
    suggestExit = true;
    confidence = Math.min(95, 75 + (lastRangeVsAtr > 2.5 ? 15 : 10));
    reason = `Spike Exhaustion Trap: ${lastRangeVsAtr.toFixed(1)}x ATR bar with ${lastUpperWickRatio.toFixed(0)}% upper rejection wick near flat base — avoiding bull trap`;
  } else if (sidewaysScore > trendScore) {
    marketRegime = "SIDEWAYS";
    blockEntry = true;
    suggestExit = true;
    confidence = Math.min(95, 60 + sidewaysScore * 4);
    if (r1Triggered && r2Triggered) {
      reason = `Choppy sideways: Kaufman efficiency ${ker.toFixed(2)} with flat EMA spread (${emaSpreadPct.toFixed(2)}%) — price oscillating without trend`;
    } else if (r3Triggered) {
      reason = `Whipsaw chop: price crossed EMA 10 ${emaCrosses} times in 20 bars — moving averages tangled`;
    } else if (r5Triggered) {
      reason = `Heikin-Ashi indecision: ${bilateralRatio.toFixed(0)}% of recent bars have bilateral shadows (spinning tops)`;
    } else {
      reason = `Sideways structure: sideways score ${sidewaysScore} vs trend score ${trendScore} — market compressed in chop`;
    }
  } else if (trendScore >= 4) {
    if (currEma10 >= currEma30 && ema10Slope >= 0) {
      marketRegime = "UPWARDS";
      blockEntry = false;
      suggestExit = false;
      confidence = Math.min(95, 65 + trendScore * 4);
      reason = `Confirmed Uptrend: EMA spread +${emaSpreadPct.toFixed(2)}%, KER ${ker.toFixed(2)}, price riding above EMA 10 (${consecutiveAboveEma10} bars) with positive slopes`;
    } else {
      marketRegime = "DOWNWARDS";
      blockEntry = true;
      suggestExit = true;
      confidence = Math.min(95, 65 + trendScore * 4);
      reason = `Confirmed Downtrend: EMA spread ${emaSpreadPct.toFixed(2)}%, KER ${ker.toFixed(2)}, price riding below EMA 10 (${consecutiveBelowEma10} bars)`;
    }
  } else {
    marketRegime = "SIDEWAYS";
    blockEntry = true;
    suggestExit = true;
    confidence = 65;
    reason = `Inconclusive momentum: sideways score ${sidewaysScore}, trend score ${trendScore} — defaulting to sideways guard`;
  }

  addAiLog(`[ai-guard:local-v2] ${symbol}: ${marketRegime} (${confidence}%) — ${reason}`);

  return {
    marketRegime,
    blockEntry,
    suggestExit,
    confidence,
    reason,
    ruleBreakdown: breakdown,
  };
}

// ── Local Rule Engine V3 (Swift Trend Sniper) ──
// Fast, robust regime classifier (EMA 5/13, 10-bar KER, 10-bar Whipsaw Counter, HA Indecision).
// Filters chop and traps cleanly without rapid whipsawing.

export function analyzeMarketRegimeLocalV3(
  symbol: string,
  candles: { time?: string; open: number; high: number; low: number; close: number; volume?: number }[],
  _tradeContext?: { entryPrice?: string; ltp?: number; pnl?: number; signal?: string }
): AiAnalysisResult {
  const settings = getAiGuardSettings();
  const candleCount = settings.candlesCount || 60;
  const useHA = settings.useHeikinAshi !== false;
  const recentCandlesCount = settings.recentCandlesCount || 30;

  if (!Array.isArray(candles) || candles.length === 0) {
    return { marketRegime: "UNKNOWN", blockEntry: false, suggestExit: false, confidence: 0, reason: "No candle data" };
  }

  const rawSlice = candles.slice(-candleCount);
  const n = rawSlice.length;
  if (n < 10) {
    return { marketRegime: "UNKNOWN", blockEntry: false, suggestExit: false, confidence: 0, reason: "Insufficient candle history for V3 engine (min 10 required)" };
  }

  const closes = rawSlice.map((c) => Number(c.close));
  const highs = rawSlice.map((c) => Number(c.high));
  const lows = rawSlice.map((c) => Number(c.low));
  const opens = rawSlice.map((c) => Number(c.open));
  const lastClose = closes[n - 1];

  // 1. EMA 5 (fast) & EMA 13 (medium) — no EMA 30, faster response
  const ema5 = calculateEMA(closes, 5);
  const ema13 = calculateEMA(closes, 13);
  const currEma5 = ema5[n - 1];
  const currEma13 = ema13[n - 1];
  const emaSpreadPct = lastClose > 0 ? ((currEma5 - currEma13) / lastClose) * 100 : 0;

  // 3-bar EMA slopes
  const slopeLookback = Math.min(3, n - 1);
  const ema5Slope = slopeLookback > 0 && ema5[n - 1 - slopeLookback] !== 0
    ? ((currEma5 - ema5[n - 1 - slopeLookback]) / ema5[n - 1 - slopeLookback]) * 100 : 0;
  const ema13Slope = slopeLookback > 0 && ema13[n - 1 - slopeLookback] !== 0
    ? ((currEma13 - ema13[n - 1 - slopeLookback]) / ema13[n - 1 - slopeLookback]) * 100 : 0;

  // 2. Fast Kaufman Efficiency Ratio (KER over last 10 bars)
  const kerPeriod = Math.min(10, n);
  const kerStart = n - kerPeriod;
  const netDisplacement = Math.abs(closes[n - 1] - closes[kerStart]);
  let totalPath = 0;
  for (let i = kerStart + 1; i < n; i++) {
    totalPath += Math.abs(closes[i] - closes[i - 1]);
  }
  const ker10 = totalPath > 0 ? netDisplacement / totalPath : 0;

  // 3. Fast EMA Whipsaw / Cross Count (last 10 bars)
  const whipsawPeriod = Math.min(10, n);
  let emaCrosses10 = 0;
  let prevDiff = closes[n - whipsawPeriod] - ema5[n - whipsawPeriod];
  for (let i = n - whipsawPeriod + 1; i < n; i++) {
    const diff = closes[i] - ema5[i];
    if ((diff >= 0 && prevDiff < 0) || (diff < 0 && prevDiff >= 0)) {
      emaCrosses10++;
    }
    prevDiff = diff;
  }

  // 4. ATR(10) & Spike Exhaustion / Rejection Trap
  let atrSum = 0;
  const atrPeriod = Math.min(10, n - 1);
  for (let i = n - atrPeriod; i < n; i++) {
    const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
    atrSum += tr;
  }
  const atr10 = atrPeriod > 0 ? atrSum / atrPeriod : (highs[n - 1] - lows[n - 1]);

  const lastRange = highs[n - 1] - lows[n - 1];
  const lastUpperWick = highs[n - 1] - Math.max(opens[n - 1], closes[n - 1]);
  const lastUpperWickRatio = lastRange > 0 ? (lastUpperWick / lastRange) * 100 : 0;
  const lastRangeVsAtr = atr10 > 0 ? lastRange / atr10 : 1;

  const isRecentSpike = lastRangeVsAtr > 1.8;
  const isSevereUpperRejection = lastUpperWickRatio > 45 && closes[n - 1] < opens[n - 1];
  const isSpikeTrap = isRecentSpike && (isSevereUpperRejection || (lastUpperWickRatio > 50 && closes[n - 1] <= currEma5));

  // 5. Heikin-Ashi Indecision & Color Flips (last 8 bars)
  const haCandles = convertToHeikinAshi(rawSlice);
  const haPeriod = Math.min(8, n);
  let haBilateralCount = 0;
  let haColorFlips = 0;
  let prevHaGreen = haCandles[n - haPeriod].close >= haCandles[n - haPeriod].open;

  for (let i = n - haPeriod; i < n; i++) {
    const c = haCandles[i];
    const body = Math.abs(c.close - c.open);
    const uw = c.high - Math.max(c.open, c.close);
    const lw = Math.min(c.open, c.close) - c.low;
    if (uw > 0.20 * (body || 1) && lw > 0.20 * (body || 1)) {
      haBilateralCount++;
    }
    const isGreen = c.close >= c.open;
    if (isGreen !== prevHaGreen) {
      haColorFlips++;
    }
    prevHaGreen = isGreen;
  }
  const haBilateralRatio = (haBilateralCount / haPeriod) * 100;

  // 6. Recent Window Analysis (broader chop pattern + cure detection)
  const rcPeriod = Math.min(recentCandlesCount, n);
  const rcStart = n - rcPeriod;

  // Recent-window KER
  const rcNetDisplacement = Math.abs(closes[n - 1] - closes[rcStart]);
  let rcTotalPath = 0;
  for (let i = rcStart + 1; i < n; i++) {
    rcTotalPath += Math.abs(closes[i] - closes[i - 1]);
  }
  const kerRecent = rcTotalPath > 0 ? rcNetDisplacement / rcTotalPath : 0;

  // Recent-window direction change ratio
  let rcDirChanges = 0;
  let rcPrevDir: "up" | "down" | null = null;
  for (let i = rcStart; i < n; i++) {
    const d: "up" | "down" = closes[i] >= opens[i] ? "up" : "down";
    if (rcPrevDir && d !== rcPrevDir) rcDirChanges++;
    rcPrevDir = d;
  }
  const rcDirRatio = rcPeriod > 1 ? (rcDirChanges / (rcPeriod - 1)) * 100 : 0;

  // ── Multi-Factor Scoring ──
  const breakdown: RuleBreakdownEntry[] = [];
  let sidewaysScore = 0;
  let trendScore = 0;

  // S1: Fast Kaufman Efficiency (< 0.28 = choppy noise)
  const s1Triggered = ker10 < 0.28;
  if (s1Triggered) sidewaysScore += 3;
  breakdown.push({ name: "Kaufman Efficiency (10-bar)", value: `${ker10.toFixed(2)} ${s1Triggered ? "(Choppy Noise)" : "(Directional)"}`, triggered: s1Triggered });

  // S2: Tangled EMA 5/13 Spread (< 0.08% flat or >= 3 crosses)
  const s2Triggered = Math.abs(emaSpreadPct) < 0.08 || emaCrosses10 >= 3;
  if (s2Triggered) sidewaysScore += 2;
  breakdown.push({ name: "EMA Tangled / Crosses", value: `Spread: ${emaSpreadPct.toFixed(2)}% | Crosses: ${emaCrosses10}/10 bars`, triggered: s2Triggered });

  // S3: Heikin-Ashi Indecision / Color Flips (bilateral > 35% or >= 3 flips)
  const s3Triggered = useHA && (haBilateralRatio > 35 || haColorFlips >= 3);
  if (s3Triggered) sidewaysScore += 2;
  breakdown.push({ name: "HA Indecision / Flips", value: `${haBilateralRatio.toFixed(0)}% bilateral | ${haColorFlips} flips/8 bars`, triggered: s3Triggered });

  // S4: Spike Exhaustion Trap
  const s4Triggered = isSpikeTrap;
  if (s4Triggered) sidewaysScore += 4;
  breakdown.push({ name: "Spike Exhaustion Trap", value: s4Triggered ? `Triggered (${lastRangeVsAtr.toFixed(1)}x ATR, ${lastUpperWickRatio.toFixed(0)}% wick)` : "Clear", triggered: s4Triggered });

  // S5: Sustained Chop (Recent Window) — broad-window chop the 10-bar view may miss
  const s5Triggered = kerRecent < 0.25 && rcDirRatio > 55;
  if (s5Triggered) sidewaysScore += 2;
  breakdown.push({ name: `Sustained Chop (${rcPeriod}-bar)`, value: `KER ${kerRecent.toFixed(2)} | Dir changes ${rcDirRatio.toFixed(0)}%`, triggered: s5Triggered });

  // T1: EMA Trend Alignment (EMA 5 > EMA 13 with positive slopes)
  const t1Triggered = currEma5 > currEma13 && ema5Slope > 0.02 && ema13Slope >= 0;
  if (t1Triggered) trendScore += 3;
  breakdown.push({ name: "EMA 5/13 Trend Alignment", value: `Spread: +${emaSpreadPct.toFixed(2)}% | EMA5 Slope: +${ema5Slope.toFixed(2)}%`, triggered: t1Triggered });

  // T2: Directional Efficiency (KER10 >= 0.38)
  const t2Triggered = ker10 >= 0.38;
  if (t2Triggered) trendScore += 2;
  breakdown.push({ name: "Directional Efficiency", value: `KER10: ${ker10.toFixed(2)}`, triggered: t2Triggered });

  // T3: Clean Trend Stability (crosses <= 1 in 10 bars)
  const t3Triggered = emaCrosses10 <= 1;
  if (t3Triggered) trendScore += 2;
  breakdown.push({ name: "Trend Stability (Low Crosses)", value: `${emaCrosses10} crosses / 10 bars`, triggered: t3Triggered });

  // T4: Clean HA Expansion (low indecision & low flips)
  const t4Triggered = useHA && haBilateralRatio <= 20 && haColorFlips <= 1 && !s4Triggered;
  if (t4Triggered) trendScore += 2;
  breakdown.push({ name: "Clean HA Expansion", value: t4Triggered ? "Confirmed" : "Not Active", triggered: t4Triggered });

  // T5: Chop Curing — broad window was choppy but immediate bars have cleaned up
  const t5Triggered = kerRecent < 0.30 && ker10 >= 0.38 && emaCrosses10 <= 1;
  if (t5Triggered) trendScore += 3;
  breakdown.push({ name: "Chop Curing", value: t5Triggered ? `Curing (Broad KER ${kerRecent.toFixed(2)} → Recent KER10 ${ker10.toFixed(2)})` : `Not Active (Broad KER ${kerRecent.toFixed(2)})`, triggered: t5Triggered });

  // ── Final Regime Determination ──
  let marketRegime: string;
  let blockEntry: boolean;
  let suggestExit: boolean;
  let confidence: number;
  let reason: string;

  if (s4Triggered) {
    marketRegime = "SIDEWAYS";
    blockEntry = true;
    suggestExit = true;
    confidence = Math.min(95, 80 + Math.round(lastRangeVsAtr * 5));
    reason = `Spike Exhaustion Trap: ${lastRangeVsAtr.toFixed(1)}x ATR bar with ${lastUpperWickRatio.toFixed(0)}% upper rejection wick — avoiding bull trap`;
  } else if (sidewaysScore >= 5 || (s1Triggered && s2Triggered)) {
    marketRegime = "SIDEWAYS";
    blockEntry = true;
    suggestExit = true;
    confidence = Math.min(95, 65 + sidewaysScore * 4);
    if (s5Triggered && s1Triggered) {
      reason = `Sustained chop: ${rcPeriod}-bar KER ${kerRecent.toFixed(2)} with ${rcDirRatio.toFixed(0)}% dir changes, immediate KER10 ${ker10.toFixed(2)} — broad & immediate chop`;
    } else if (s1Triggered && s2Triggered) {
      reason = `Choppy sideways: 10-bar Kaufman efficiency ${ker10.toFixed(2)} with tangled EMAs (${emaCrosses10} crosses) — market compressed`;
    } else if (s5Triggered) {
      reason = `Sustained chop: ${rcPeriod}-bar window shows KER ${kerRecent.toFixed(2)} with ${rcDirRatio.toFixed(0)}% direction changes — broader chop pattern`;
    } else if (s2Triggered) {
      reason = `Whipsaw chop: EMA 5/13 tangled with ${emaCrosses10} crosses in last 10 bars — lack of clean directional follow-through`;
    } else if (s3Triggered) {
      reason = `Indecision chop: Heikin-Ashi showing ${haBilateralRatio.toFixed(0)}% spinning-top shadows & ${haColorFlips} flips in 8 bars`;
    } else {
      reason = `Sideways consolidation: sideways score ${sidewaysScore} vs trend score ${trendScore} — market lacks momentum`;
    }
  } else if (t1Triggered && trendScore >= 4 && sidewaysScore <= 2) {
    marketRegime = "UPWARDS";
    blockEntry = false;
    suggestExit = false;
    confidence = Math.min(95, 70 + trendScore * 4);
    reason = `Confirmed Uptrend: EMA 5 > EMA 13 (+${emaSpreadPct.toFixed(2)}%), KER10 ${ker10.toFixed(2)}, clean slope (+${ema5Slope.toFixed(2)}%)`;
    if (t5Triggered) reason += ` — chop curing (broad KER ${kerRecent.toFixed(2)} → clean)`;
  } else if (currEma5 < currEma13 && ema5Slope < -0.02 && ema13Slope <= 0 && ker10 >= 0.35 && sidewaysScore <= 2) {
    marketRegime = "DOWNWARDS";
    blockEntry = true;
    suggestExit = true;
    confidence = Math.min(95, 70 + trendScore * 4);
    reason = `Confirmed Downtrend: EMA 5 < EMA 13 (${emaSpreadPct.toFixed(2)}%), KER10 ${ker10.toFixed(2)}, negative slope (${ema5Slope.toFixed(2)}%)`;
    if (t5Triggered) reason += ` — chop curing (broad KER ${kerRecent.toFixed(2)} → clean)`;
  } else {
    marketRegime = "SIDEWAYS";
    blockEntry = true;
    suggestExit = true;
    confidence = 65;
    reason = `Inconclusive momentum: sideways score ${sidewaysScore}, trend score ${trendScore} — filtering uncertain market state`;
  }

  addAiLog(`[ai-guard:local-v3] ${symbol}: ${marketRegime} (${confidence}%) — ${reason}`);

  return {
    marketRegime,
    blockEntry,
    suggestExit,
    confidence,
    reason,
    ruleBreakdown: breakdown,
  };
}

// ── Local Rule Engine V4 (Choppy Filter) ──
// Direction-agnostic: only answers "tradeable or chop?", never UP/DOWN.
// Short 8-10 bar lookbacks — faster than V3. No UT bot logic.

export function analyzeMarketRegimeLocalV4(
  symbol: string,
  candles: { time?: string; open: number; high: number; low: number; close: number; volume?: number }[],
  _tradeContext?: { entryPrice?: string; ltp?: number; pnl?: number; signal?: string }
): AiAnalysisResult {
  const settings = getAiGuardSettings();
  const candleCount = settings.candlesCount || 50;
  const useHA = settings.useHeikinAshi !== false;
  const recentCandlesCount = settings.recentCandlesCount || 30;

  if (!Array.isArray(candles) || candles.length === 0) {
    return { marketRegime: "TRADEABLE", blockEntry: false, suggestExit: false, confidence: 50, reason: "No candle data — defaulting to tradeable" };
  }

  const rawSlice = candles.slice(-candleCount);
  const n = rawSlice.length;
  if (n < 12) {
    return { marketRegime: "TRADEABLE", blockEntry: false, suggestExit: false, confidence: 50, reason: "Insufficient history for V4 (min 12) — defaulting to tradeable" };
  }

  const closes = rawSlice.map((c) => Number(c.close));
  const highs = rawSlice.map((c) => Number(c.high));
  const lows = rawSlice.map((c) => Number(c.low));
  const opens = rawSlice.map((c) => Number(c.open));
  const lastClose = closes[n - 1];

  // EMA 5/13 (only used for tangling check, not direction)
  const ema5 = calculateEMA(closes, 5);
  const ema13 = calculateEMA(closes, 13);
  const currEma5 = ema5[n - 1];
  const currEma13 = ema13[n - 1];
  const emaSpreadPct = lastClose > 0 ? ((currEma5 - currEma13) / lastClose) * 100 : 0;

  // 1. KER(10) — chop when inefficient zigzag
  const kerPeriod = Math.min(10, n);
  const kerStart = n - kerPeriod;
  const netDisplacement = Math.abs(closes[n - 1] - closes[kerStart]);
  let totalPath = 0;
  for (let i = kerStart + 1; i < n; i++) {
    totalPath += Math.abs(closes[i] - closes[i - 1]);
  }
  const ker10 = totalPath > 0 ? netDisplacement / totalPath : 0;

  // 2. EMA 5/13 cross count (10 bars) — tangled EMAs = chop
  const crossPeriod = Math.min(10, n);
  let emaCrosses10 = 0;
  let prevDiff = closes[n - crossPeriod] - ema5[n - crossPeriod];
  for (let i = n - crossPeriod + 1; i < n; i++) {
    const diff = closes[i] - ema5[i];
    if ((diff >= 0 && prevDiff < 0) || (diff < 0 && prevDiff >= 0)) {
      emaCrosses10++;
    }
    prevDiff = diff;
  }

  // 3. Range compression: recent 8-bar vs prior 10-bar
  const recentPeriod = Math.min(8, n);
  const olderPeriod = Math.min(10, n - recentPeriod);
  let recentHigh = -Infinity, recentLow = Infinity;
  let olderHigh = -Infinity, olderLow = Infinity;
  for (let i = n - recentPeriod; i < n; i++) {
    if (highs[i] > recentHigh) recentHigh = highs[i];
    if (lows[i] < recentLow) recentLow = lows[i];
  }
  const olderStart = n - recentPeriod - olderPeriod;
  for (let i = olderStart; i < n - recentPeriod; i++) {
    if (highs[i] > olderHigh) olderHigh = highs[i];
    if (lows[i] < olderLow) olderLow = lows[i];
  }
  const recentWidth = recentHigh - recentLow;
  const olderWidth = olderHigh > -Infinity && olderLow < Infinity ? olderHigh - olderLow : recentWidth;
  const rangeCompressionPct = olderWidth > 0 ? ((olderWidth - recentWidth) / olderWidth) * 100 : 0;

  // 4. ATR(10) & Spike Rejection Trap
  let atrSum = 0;
  const atrPeriod = Math.min(10, n - 1);
  for (let i = n - atrPeriod; i < n; i++) {
    const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
    atrSum += tr;
  }
  const atr10 = atrPeriod > 0 ? atrSum / atrPeriod : (highs[n - 1] - lows[n - 1]);
  const lastRange = highs[n - 1] - lows[n - 1];
  const lastUpperWick = highs[n - 1] - Math.max(opens[n - 1], closes[n - 1]);
  const lastUpperWickRatio = lastRange > 0 ? (lastUpperWick / lastRange) * 100 : 0;
  const lastRangeVsAtr = atr10 > 0 ? lastRange / atr10 : 1;
  const isSpikeTrap = lastRangeVsAtr > 1.8 && ((lastUpperWickRatio > 45 && closes[n - 1] < opens[n - 1]) || (lastUpperWickRatio > 50 && closes[n - 1] <= currEma5));

  // 5. HA color flips & bilateral shadows (8 bars)
  const haCandles = convertToHeikinAshi(rawSlice);
  const haPeriod = Math.min(8, n);
  let haBilateralCount = 0;
  let haColorFlips = 0;
  let prevHaGreen = haCandles[n - haPeriod].close >= haCandles[n - haPeriod].open;
  for (let i = n - haPeriod; i < n; i++) {
    const c = haCandles[i];
    const body = Math.abs(c.close - c.open);
    const uw = c.high - Math.max(c.open, c.close);
    const lw = Math.min(c.open, c.close) - c.low;
    if (uw > 0.20 * (body || 1) && lw > 0.20 * (body || 1)) {
      haBilateralCount++;
    }
    const isGreen = c.close >= c.open;
    if (isGreen !== prevHaGreen) {
      haColorFlips++;
    }
    prevHaGreen = isGreen;
  }
  const haBilateralRatio = (haBilateralCount / haPeriod) * 100;

  // 6. Recent Window Analysis (broader chop pattern + cure detection)
  const rcPeriod = Math.min(recentCandlesCount, n);
  const rcStart = n - rcPeriod;

  // Recent-window KER
  const rcNetDisplacement = Math.abs(closes[n - 1] - closes[rcStart]);
  let rcTotalPath = 0;
  for (let i = rcStart + 1; i < n; i++) {
    rcTotalPath += Math.abs(closes[i] - closes[i - 1]);
  }
  const kerRecent = rcTotalPath > 0 ? rcNetDisplacement / rcTotalPath : 0;

  // Recent-window direction change ratio
  let rcDirChanges = 0;
  let rcPrevDir: "up" | "down" | null = null;
  for (let i = rcStart; i < n; i++) {
    const d: "up" | "down" = closes[i] >= opens[i] ? "up" : "down";
    if (rcPrevDir && d !== rcPrevDir) rcDirChanges++;
    rcPrevDir = d;
  }
  const rcDirRatio = rcPeriod > 1 ? (rcDirChanges / (rcPeriod - 1)) * 100 : 0;

  // ── Chop Scoring ──
  const breakdown: RuleBreakdownEntry[] = [];
  let chopScore = 0;

  // C1: KER(10) < 0.30 → choppy zigzag
  const c1Triggered = ker10 < 0.30;
  if (c1Triggered) chopScore += 3;
  breakdown.push({ name: "Efficiency (10-bar)", value: `KER ${ker10.toFixed(2)} ${c1Triggered ? "(Chop)" : "(Clean)"}`, triggered: c1Triggered });

  // C2: Range compression > 25%
  const c2Triggered = rangeCompressionPct > 25;
  if (c2Triggered) chopScore += 2;
  breakdown.push({ name: "Range Compression", value: `${rangeCompressionPct > 0 ? "-" : "+"}${Math.abs(rangeCompressionPct).toFixed(0)}% vs older`, triggered: c2Triggered });

  // C3: HA color flips >= 3 in 8 bars
  const c3Triggered = useHA && haColorFlips >= 3;
  if (c3Triggered) chopScore += 2;
  breakdown.push({ name: "HA Color Flips", value: `${haColorFlips} flips / ${haPeriod} bars`, triggered: c3Triggered });

  // C4: HA bilateral shadows > 35%
  const c4Triggered = useHA && haBilateralRatio > 35;
  if (c4Triggered) chopScore += 2;
  breakdown.push({ name: "HA Indecision Wicks", value: `${haBilateralRatio.toFixed(0)}% bilateral`, triggered: c4Triggered });

  // C5: Tangled EMA 5/13 (flat spread or >= 3 crosses)
  const c5Triggered = Math.abs(emaSpreadPct) < 0.10 || emaCrosses10 >= 3;
  if (c5Triggered) chopScore += 2;
  breakdown.push({ name: "EMA 5/13 Tangled", value: `Spread ${emaSpreadPct.toFixed(2)}% | ${emaCrosses10} crosses/10`, triggered: c5Triggered });

  // C6: Spike rejection trap
  const c6Triggered = isSpikeTrap;
  if (c6Triggered) chopScore += 3;
  breakdown.push({ name: "Spike Rejection Trap", value: c6Triggered ? `Triggered (${lastRangeVsAtr.toFixed(1)}x ATR, ${lastUpperWickRatio.toFixed(0)}% wick)` : "Clear", triggered: c6Triggered });

  // C7: Sustained Chop (Recent Window) — broad-window chop the 10-bar view may miss
  const c7Triggered = kerRecent < 0.25 && rcDirRatio > 55;
  if (c7Triggered) chopScore += 2;
  breakdown.push({ name: `Sustained Chop (${rcPeriod}-bar)`, value: `KER ${kerRecent.toFixed(2)} | Dir changes ${rcDirRatio.toFixed(0)}%`, triggered: c7Triggered });

  // Chop Cure: broad window was choppy but immediate bars have cleaned up → reduce chop score
  const chopCureTriggered = kerRecent < 0.30 && ker10 >= 0.38 && emaCrosses10 <= 1;
  if (chopCureTriggered) chopScore = Math.max(0, chopScore - 2);
  breakdown.push({ name: "Chop Curing", value: chopCureTriggered ? `Curing (Broad KER ${kerRecent.toFixed(2)} → Recent KER10 ${ker10.toFixed(2)})` : `Not Active (Broad KER ${kerRecent.toFixed(2)})`, triggered: chopCureTriggered });

  // ── Decision ──
  let marketRegime: string;
  let blockEntry: boolean;
  let suggestExit: boolean;
  let confidence: number;
  let reason: string;

  if (chopScore >= 4) {
    marketRegime = "CHOPPY";
    blockEntry = true;
    suggestExit = true;
    confidence = Math.min(95, 60 + chopScore * 5);
    if (c7Triggered && c1Triggered) {
      reason = `Choppy: sustained ${rcPeriod}-bar KER ${kerRecent.toFixed(2)} with ${rcDirRatio.toFixed(0)}% dir changes, immediate KER10 ${ker10.toFixed(2)} — broad & immediate choppiness`;
    } else if (c1Triggered && c5Triggered) {
      reason = `Choppy: low efficiency KER ${ker10.toFixed(2)} with tangled EMAs (${emaCrosses10} crosses) — no clean direction`;
    } else if (c6Triggered) {
      reason = `Choppy: spike rejection trap — ${lastRangeVsAtr.toFixed(1)}x ATR bar with ${lastUpperWickRatio.toFixed(0)}% upper wick, momentum failing`;
    } else if (c7Triggered) {
      reason = `Choppy: sustained ${rcPeriod}-bar window shows KER ${kerRecent.toFixed(2)} with ${rcDirRatio.toFixed(0)}% direction changes — broader choppiness pattern`;
    } else if (c2Triggered) {
      reason = `Choppy: range compressing ${Math.abs(rangeCompressionPct).toFixed(0)}% — tightening coil, no follow-through`;
    } else if (c3Triggered || c4Triggered) {
      reason = `Choppy: Heikin-Ashi indecision — ${haColorFlips} flips & ${haBilateralRatio.toFixed(0)}% spinning tops in ${haPeriod} bars`;
    } else {
      reason = `Choppy: chop score ${chopScore} — market lacks clean directional efficiency`;
    }
  } else {
    marketRegime = "TRADEABLE";
    blockEntry = false;
    suggestExit = false;
    confidence = Math.min(90, 55 + (6 - chopScore) * 6);
    reason = `Tradeable: KER ${ker10.toFixed(2)}, ${emaCrosses10} EMA crosses/10 bars, ${haColorFlips} HA flips — price moving cleanly (chop score ${chopScore})`;
    if (chopCureTriggered) reason += ` — chop curing (broad KER ${kerRecent.toFixed(2)} → clean)`;
  }

  addAiLog(`[ai-guard:local-v4] ${symbol}: ${marketRegime} (${confidence}%) — ${reason}`);

  return {
    marketRegime,
    blockEntry,
    suggestExit,
    confidence,
    reason,
    ruleBreakdown: breakdown,
  };
}

export async function analyzeMarketRegime(
  symbol: string,
  candles: any[],
  tradeContext?: { entryPrice?: string; ltp?: number; pnl?: number; signal?: string }
): Promise<AiAnalysisResult> {
  const settings = getAiGuardSettings();

  // Local rule engine V1 — no API call needed
  if (settings.provider === "local") {
    return Promise.resolve(analyzeMarketRegimeLocal(symbol, candles, tradeContext));
  }

  // Local rule engine V2 (Choppy & Spike Guard) — no API call needed
  if (settings.provider === "local_v2") {
    return Promise.resolve(analyzeMarketRegimeLocalV2(symbol, candles, tradeContext));
  }

  // Local rule engine V3 (Swift Trend Sniper) — no API call needed
  if (settings.provider === "local_v3") {
    return Promise.resolve(analyzeMarketRegimeLocalV3(symbol, candles, tradeContext));
  }

  // Local rule engine V4 (Choppy Filter) — no API call needed
  if (settings.provider === "local_v4") {
    return Promise.resolve(analyzeMarketRegimeLocalV4(symbol, candles, tradeContext));
  }

  const candleCount = settings.candlesCount || 120;
  let useVolume = settings.considerVolume || false;
  const useHA = settings.useHeikinAshi !== false;

  // Auto-detect: if volume is requested but all candles have 0 volume, fall back to non-volume mode
  if (useVolume && Array.isArray(candles) && candles.length > 0) {
    const hasVolume = candles.some((c) => Number(c.volume) > 0);
    if (!hasVolume) {
      useVolume = false;
      addAiLog(`[ai-guard] ${symbol}: volume data unavailable (all zeros), falling back to price-only analysis`);
    }
  }

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
    const timeout = setTimeout(() => controller.abort(), 30000);

    const res = await fetch(config.url, {
      method: "POST",
      headers: config.headers(apiKey),
      body: JSON.stringify(config.buildBody(systemPrompt, userPrompt, 4096)),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      addAiErrorLog(`[ai-guard] ${config.providerName} API error: ${res.status} ${res.statusText} (key #${keyIndex % (aiGuardSettings.apiKeys?.length || 1)}) — ${errBody.slice(0, 300)}`);
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
