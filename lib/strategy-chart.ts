import {
  UTCTimestamp,
  Time,
  ISeriesApi,
  ISeriesPrimitive,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  SeriesAttachedParameter,
  ITimeScaleApi,
} from "lightweight-charts";

export const STRATEGY_URL = process.env.NEXT_PUBLIC_STRATEGY_API_URL || "http://localhost:4000";

export type CandleData = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  signal?: "BUY" | "SELL" | "BOOMBUY";
};

export type SymbolCandles = Record<string, CandleData[]>;

export function parseCandlesFromLogs(logs: string[]): SymbolCandles {
  const result: SymbolCandles = {};
  let currentSymbol: string | null = null;
  let lastAddedCandle: { symbol: string; time: string } | null = null;

  for (let i = 0; i < logs.length; i++) {
    const line = logs[i];

    // Match: [LOG] 2:56:00 PM New candle received for: SYMBOL
    const symbolMatch = line.match(/New candle received for:\s*(.+)/);
    if (symbolMatch) {
      currentSymbol = symbolMatch[1].trim();
      continue;
    }

    // Match: [LOG] 2:56:00 PM New candle received: {...JSON...}
    if (currentSymbol && line.includes("New candle received:")) {
      const jsonMatch = line.match(/New candle received:\s*(\{.+\})/);
      if (jsonMatch) {
        try {
          const candle = JSON.parse(jsonMatch[1]);
          if (candle.time && candle.open !== undefined && candle.high !== undefined && candle.low !== undefined && candle.close !== undefined) {
            if (!result[currentSymbol]) result[currentSymbol] = [];
            // Avoid duplicates by time
            const existing = result[currentSymbol];
            if (!existing.find(c => c.time === candle.time)) {
              existing.push({
                time: candle.time,
                open: Number(candle.open),
                high: Number(candle.high),
                low: Number(candle.low),
                close: Number(candle.close),
              });
            }
            lastAddedCandle = { symbol: currentSymbol, time: candle.time };
          }
        } catch {
          // ignore parse errors
        }
        currentSymbol = null;
      }
    }

    // Match: [LOG] ... Current eval: BUY or SELL or BOOMBUY
    if (lastAddedCandle && line.includes("Current eval:")) {
      const signalMatch = line.match(/Current eval:\s*(BUY|SELL|BOOMBUY)/);
      if (signalMatch) {
        const signal = signalMatch[1] as "BUY" | "SELL" | "BOOMBUY";
        const symbolCandles = result[lastAddedCandle.symbol];
        if (symbolCandles) {
          const candle = symbolCandles.find(c => c.time === lastAddedCandle!.time);
          if (candle) candle.signal = signal;
        }
      }
      lastAddedCandle = null;
    }
  }

  // Keep only last 160 candles per symbol, sorted by time
  for (const symbol of Object.keys(result)) {
    result[symbol] = result[symbol]
      .sort((a, b) => a.time.localeCompare(b.time))
      .slice(-160);
  }

  return result;
}

// Fetch candles + merge BUY/SELL signals from strategy logs
export async function fetchSymbolCandles(): Promise<SymbolCandles> {
  const [historyData, logData] = await Promise.all([
    fetch(`${STRATEGY_URL}/chart-history`).then((r) => r.json()).catch(() => ({})),
    fetch(`${STRATEGY_URL}/logs/strategy`).then((r) => r.json()).catch(() => ({ logs: [] })),
  ]);

  const logs: string[] = logData.logs || [];
  const logCandles = parseCandlesFromLogs(logs);

  const hasHistory = Object.keys(historyData).length > 0;
  if (hasHistory) {
    const result: SymbolCandles = {};
    for (const symbol of Object.keys(historyData)) {
      const candles: CandleData[] = (historyData[symbol] || []).map((c: { time: string; open: number; high: number; low: number; close: number }) => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));
      // Merge signals from log parsing
      if (logCandles[symbol]) {
        for (const lc of logCandles[symbol]) {
          if (lc.signal) {
            const match = candles.find((c) => c.time === lc.time);
            if (match) match.signal = lc.signal;
          }
        }
      }
      result[symbol] = candles;
    }
    return result;
  }
  // Fallback: use only log-parsed candles
  return logCandles;
}

// Calculate EMA (Exponential Moving Average)
export function calculateEMA(prices: number[], period: number): number[] {
  if (!Number.isFinite(period) || period < 1 || prices.length < period) return [];

  const ema: number[] = [];
  const multiplier = 2 / (period + 1);

  // First EMA is SMA of first 'period' prices
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += prices[i];
  }
  ema.push(sum / period);

  // Calculate subsequent EMAs
  for (let i = period; i < prices.length; i++) {
    const currentEMA = (prices[i] - ema[ema.length - 1]) * multiplier + ema[ema.length - 1];
    ema.push(currentEMA);
  }

  return ema;
}

// Calculate WMA (Weighted Moving Average) — output[i] aligns to prices[i],
// leading undefined entries until the window fills.
function wmaAligned(prices: number[], period: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(prices.length);
  const denom = (period * (period + 1)) / 2;
  for (let i = period - 1; i < prices.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += prices[i - j] * (period - j);
    out[i] = sum / denom;
  }
  return out;
}

// Calculate HMA (Hull Moving Average): WMA(2*WMA(n/2) − WMA(n), sqrt(n)).
// Much lower lag than EMA at the same period while staying smooth.
export function calculateHMA(prices: number[], period: number): number[] {
  if (period <= 0 || prices.length < period) return [];
  const half = Math.max(1, Math.floor(period / 2));
  const sqrtP = Math.max(1, Math.round(Math.sqrt(period)));

  const wHalf = wmaAligned(prices, half);
  const wFull = wmaAligned(prices, period);

  const diff: (number | undefined)[] = prices.map((_, i) =>
    wHalf[i] !== undefined && wFull[i] !== undefined
      ? 2 * (wHalf[i] as number) - (wFull[i] as number)
      : undefined
  );

  const firstIdx = diff.findIndex((d) => d !== undefined);
  if (firstIdx < 0) return [];
  const diffVals = diff.slice(firstIdx) as number[];
  return calculateWMAValues(diffVals, sqrtP);
}

// Calculate MACD (12/26/9 by default): MACD = EMA(fast) − EMA(slow),
// signal = EMA(signalPeriod) of MACD, histogram = MACD − signal.
// Returns chart-ready series data aligned to candle times.
export function calculateMACD(
  candles: { time: number; close: number }[],
  fast = 12,
  slow = 26,
  signalPeriod = 9
): {
  macd: { time: UTCTimestamp; value: number }[];
  signal: { time: UTCTimestamp; value: number }[];
  hist: { time: UTCTimestamp; value: number; color: string }[];
} {
  const empty = { macd: [], signal: [], hist: [] };
  if (fast <= 0 || slow <= 0 || signalPeriod <= 0 || candles.length === 0) return empty;

  const closes = candles.map((c) => c.close);
  const eFast = calculateEMA(closes, fast);
  const eSlow = calculateEMA(closes, slow);
  const fastOff = fast - 1;
  const slowOff = slow - 1;
  if (closes.length <= slowOff) return empty;

  const macdVals: number[] = [];
  for (let i = slowOff; i < closes.length; i++) {
    macdVals.push(eFast[i - fastOff] - eSlow[i - slowOff]);
  }

  const sigVals = calculateEMA(macdVals, signalPeriod);
  const sigOff = signalPeriod - 1;

  const macd = macdVals.map((v, j) => ({
    time: candles[slowOff + j].time as UTCTimestamp,
    value: v,
  }));
  const signal = sigVals.map((v, j) => ({
    time: candles[slowOff + sigOff + j].time as UTCTimestamp,
    value: v,
  }));
  const hist: { time: UTCTimestamp; value: number; color: string }[] = [];
  for (let j = sigOff; j < macdVals.length; j++) {
    const h = macdVals[j] - sigVals[j - sigOff];
    hist.push({
      time: candles[slowOff + j].time as UTCTimestamp,
      value: h,
      color: h >= 0 ? "rgba(38, 166, 154, 0.5)" : "rgba(239, 83, 80, 0.5)",
    });
  }
  return { macd, signal, hist };
}

function calculateWMAValues(prices: number[], period: number): number[] {
  if (period <= 0 || prices.length < period) return [];
  const out: number[] = [];
  const denom = (period * (period + 1)) / 2;
  for (let i = period - 1; i < prices.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += prices[i - j] * (period - j);
    out.push(sum / denom);
  }
  return out;
}

// Calculate SMA (Simple Moving Average) — returns values from index period-1 onward.
export function calculateSMA(prices: number[], period: number): number[] {
  if (period <= 0 || prices.length < period) return [];
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < prices.length; i++) {
    sum += prices[i];
    if (i >= period) sum -= prices[i - period];
    if (i >= period - 1) out.push(sum / period);
  }
  return out;
}

// Calculate DEMA (Double EMA): 2*EMA(n) − EMA(EMA(n)). Output tail-aligned to prices.
export function calculateDEMA(prices: number[], period: number): number[] {
  const e1 = calculateEMA(prices, period);
  const e2 = calculateEMA(e1, period);
  const off1 = period - 1;
  const off2 = 2 * (period - 1);
  const out: number[] = [];
  for (let i = off2; i < prices.length; i++) {
    out.push(2 * e1[i - off1] - e2[i - off2]);
  }
  return out;
}

// Calculate TEMA (Triple EMA): 3*EMA − 3*EMA(EMA) + EMA(EMA(EMA)). Output tail-aligned.
export function calculateTEMA(prices: number[], period: number): number[] {
  const e1 = calculateEMA(prices, period);
  const e2 = calculateEMA(e1, period);
  const e3 = calculateEMA(e2, period);
  const off1 = period - 1;
  const off2 = 2 * (period - 1);
  const off3 = 3 * (period - 1);
  const out: number[] = [];
  for (let i = off3; i < prices.length; i++) {
    out.push(3 * e1[i - off1] - 3 * e2[i - off2] + e3[i - off3]);
  }
  return out;
}

export type ShortMaType = "hma" | "ema" | "wma" | "sma" | "dema" | "tema";

export const SHORT_MA_TYPES: { value: ShortMaType; label: string }[] = [
  { value: "hma", label: "HMA" },
  { value: "wma", label: "WMA" },
  { value: "ema", label: "EMA" },
  { value: "sma", label: "SMA" },
  { value: "dema", label: "DEMA" },
  { value: "tema", label: "TEMA" },
];

function applyShortMa(prices: number[], period: number, type: ShortMaType): number[] {
  switch (type) {
    case "sma": return calculateSMA(prices, period);
    case "ema": return calculateEMA(prices, period);
    case "wma": return calculateWMAValues(prices, period);
    case "dema": return calculateDEMA(prices, period);
    case "tema": return calculateTEMA(prices, period);
    default: return calculateHMA(prices, period);
  }
}

// Moving average computed over a short trailing window (default 30 candles)
// ending at an anchor minute ("HH:MM" UTC, blank = latest candle). The returned
// series only covers the window — matches how short-window MAs are used for
// re-entry checks.
export function shortMaSeries(
  candles: { time: number; close: number }[],
  period: number,
  anchorMin: string,
  windowSize = 30,
  maType: ShortMaType = "hma"
): { time: UTCTimestamp; value: number }[] {
  if (candles.length === 0 || period <= 0) return [];

  let endIdx = candles.length - 1;
  const anchor = anchorMin.trim();
  if (anchor) {
    for (let i = candles.length - 1; i >= 0; i--) {
      const hhmm = new Date(candles[i].time * 1000).toISOString().slice(11, 16);
      if (hhmm === anchor) { endIdx = i; break; }
    }
  }

  const startIdx = Math.max(0, endIdx - windowSize + 1);
  const slice = candles.slice(startIdx, endIdx + 1);
  const values = applyShortMa(slice.map((c) => c.close), period, maType);

  return values.map((val, idx) => ({
    time: slice[idx + (slice.length - values.length)].time as UTCTimestamp,
    value: val,
  }));
}

// Convert candles to Heiken Ashi values (times unchanged)
export function toHeikenAshi<T extends { open: number; high: number; low: number; close: number }>(candles: T[]): T[] {
  const ha: T[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const close = (c.open + c.high + c.low + c.close) / 4;
    const open = i === 0 ? (c.open + c.close) / 2 : (ha[i - 1].open + ha[i - 1].close) / 2;
    ha.push({
      ...c,
      open,
      high: Math.max(c.high, open, close),
      low: Math.min(c.low, open, close),
      close,
    });
  }
  return ha;
}

// RMA (Running Moving Average) — TradingView's Wilder smoothing, used by
// both UTBot (xATRTrailingStop) and SuperTrend (ATR bands).
function calculateRMA(data: number[], period: number): number[] {
  if (data.length < period) return [];
  const rma: number[] = [];
  const alpha = 1 / period;

  // First value is SMA
  let sum = 0;
  for (let i = 0; i < period; i++) sum += data[i];
  rma.push(sum / period);

  // Subsequent values use alpha
  for (let i = period; i < data.length; i++) {
    rma.push(alpha * data[i] + (1 - alpha) * rma[rma.length - 1]);
  }
  return rma;
}

// Calculate True Range series (starts at candle index 1)
function calculateTR(candles: { high: number; low: number; close: number }[]): number[] {
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  return trs;
}

// UTBot Signal Type
export type UTBotSignal = {
  time: number;
  type: "BUY" | "SELL";
};

// Calculate UTBot Signals
export function calculateUTBot(candles: { time: string | number; open: number; high: number; low: number; close: number }[], key: number, atrPeriod: number): UTBotSignal[] {
  if (!Number.isFinite(key) || key <= 0 || !Number.isFinite(atrPeriod) || atrPeriod < 1 || candles.length < atrPeriod + 1) return [];

  // 1. Calculate TR (True Range)
  const trs = calculateTR(candles);

  // 2. Calculate ATR using RMA (Running Moving Average) - as used in TradingView's ATR
  const atrs = calculateRMA(trs, atrPeriod);
  if (atrs.length === 0) return [];

  // 3. UTBot Logic
  const signals: UTBotSignal[] = [];
  let trailingStop = 0;
  let prevPos = 0; // 1 for long, -1 for short

  // The first ATR value is at index (atrPeriod - 1) in trs array, which corresponds to candle index (atrPeriod)
  const startCandleIdx = atrPeriod;

  for (let i = 0; i < atrs.length; i++) {
    const candleIdx = startCandleIdx + i;
    const src = candles[candleIdx].close;
    const prevSrc = candles[candleIdx - 1].close;
    const nLoss = key * atrs[i];

    let nextTrailingStop = trailingStop;

    if (src > trailingStop && prevSrc > trailingStop) {
      nextTrailingStop = Math.max(trailingStop, src - nLoss);
    } else if (src < trailingStop && prevSrc < trailingStop) {
      nextTrailingStop = Math.min(trailingStop, src + nLoss);
    } else if (src > trailingStop) {
      nextTrailingStop = src - nLoss;
    } else {
      nextTrailingStop = src + nLoss;
    }

    const pos = src > nextTrailingStop ? 1 : (src < nextTrailingStop ? -1 : prevPos);

    if (pos === 1 && prevPos !== 1) {
      signals.push({ time: toChartTime(candles[candleIdx].time) as number, type: "BUY" });
    } else if (pos === -1 && prevPos !== -1) {
      signals.push({ time: toChartTime(candles[candleIdx].time) as number, type: "SELL" });
    }

    trailingStop = nextTrailingStop;
    prevPos = pos;
  }

  return signals;
}

// UTBot computed over a short trailing window (default 30 candles) ending at
// an anchor minute ("HH:MM" UTC, blank = latest candle) — same window logic
// as shortMaSeries. The first evaluated candle's signal is dropped: the
// trailing stop starts at 0, so that candle can emit a fake instant BUY/SELL
// (cold-start artifact, not a real crossover).
export function shortUtbotSignals(
  candles: { time: string | number; open: number; high: number; low: number; close: number }[],
  key: number,
  atrPeriod: number,
  anchorMin: string,
  windowSize = 30
): UTBotSignal[] {
  if (candles.length === 0) return [];

  let endIdx = candles.length - 1;
  const anchor = anchorMin.trim();
  if (anchor) {
    for (let i = candles.length - 1; i >= 0; i--) {
      const hhmm = new Date(toChartTime(candles[i].time) * 1000).toISOString().slice(11, 16);
      if (hhmm === anchor) { endIdx = i; break; }
    }
  }

  const startIdx = Math.max(0, endIdx - windowSize + 1);
  const slice = candles.slice(startIdx, endIdx + 1);
  if (slice.length < atrPeriod + 1) return [];

  const coldStartTime = toChartTime(slice[atrPeriod].time);
  return calculateUTBot(slice, key, atrPeriod).filter((s) => s.time !== coldStartTime);
}

// SuperTrend — TradingView algorithm: hl2 source, RMA ATR bands with
// ratcheting, direction flips when close crosses the opposite band.
export type SuperTrendPoint = { time: number; st: number; hl2: number; up: boolean };

export function calculateSuperTrend(
  candles: { time: string | number; open: number; high: number; low: number; close: number }[],
  period: number,
  multiplier: number
): SuperTrendPoint[] {
  if (!Number.isFinite(period) || period < 1 || !Number.isFinite(multiplier) || multiplier <= 0 || candles.length < period + 1) return [];

  const atrs = calculateRMA(calculateTR(candles), period);
  if (atrs.length === 0) return [];

  const points: SuperTrendPoint[] = [];
  // ATR index i corresponds to candle index (period + i) — same offset as UTBot
  const startCandleIdx = period;

  let prevUpper = 0;
  let prevLower = 0;
  let prevST = 0;

  for (let i = 0; i < atrs.length; i++) {
    const candleIdx = startCandleIdx + i;
    const c = candles[candleIdx];
    const hl2 = (c.high + c.low) / 2;
    const prevClose = candles[candleIdx - 1].close;

    let upper = hl2 + multiplier * atrs[i];
    let lower = hl2 - multiplier * atrs[i];

    if (i > 0) {
      if (!(lower > prevLower || prevClose < prevLower)) lower = prevLower;
      if (!(upper < prevUpper || prevClose > prevUpper)) upper = prevUpper;
    }

    let up: boolean;
    if (i === 0) {
      up = c.close > upper;
    } else if (prevST === prevUpper) {
      // Was in downtrend — flip up when close breaks above upper band
      up = c.close > upper;
    } else {
      // Was in uptrend — flip down when close breaks below lower band
      up = !(c.close < lower);
    }

    const st = up ? lower : upper;
    points.push({ time: toChartTime(c.time) as number, st, hl2, up });

    prevUpper = upper;
    prevLower = lower;
    prevST = st;
  }

  return points;
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = (hex || "").replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const num = parseInt(full, 16);
  if (isNaN(num)) return `rgba(22,163,74,${alpha})`;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

// SuperTrend overlay — TradingView-style: colored line plus a translucent
// band filled between the supertrend value and the candle mid-price (hl2).
// Attached to the candlestick series like UTBotLabelsPrimitive.
export class SuperTrendPrimitive implements ISeriesPrimitive<Time> {
  private _timeScale: ITimeScaleApi<Time> | null = null;
  private _series: ISeriesApi<"Candlestick"> | null = null;
  private _requestUpdate: (() => void) | null = null;
  private _points: SuperTrendPoint[] = [];
  private _upColor: string = "#16a34a";
  private _downColor: string = "#dc2626";
  private _paneViews: IPrimitivePaneView[];

  constructor() {
    this._paneViews = [new SuperTrendPaneView(this)];
  }

  setColors(upColor: string, downColor: string) {
    if (upColor) this._upColor = upColor;
    if (downColor) this._downColor = downColor;
    this._requestUpdate?.();
  }

  attached(param: SeriesAttachedParameter<Time>) {
    this._timeScale = param.chart.timeScale();
    this._series = param.series as ISeriesApi<"Candlestick">;
    this._requestUpdate = param.requestUpdate;
  }

  detached() {
    this._timeScale = null;
    this._series = null;
  }

  setData(points: SuperTrendPoint[]) {
    this._points = points;
    this._requestUpdate?.();
  }

  paneViews() {
    return this._paneViews;
  }

  drawOverlay(ctx: CanvasRenderingContext2D) {
    const ts = this._timeScale;
    const series = this._series;
    if (!ts || !series || this._points.length < 2) return;

    const coords: { x: number; ySt: number; yHl2: number; up: boolean }[] = [];
    for (const p of this._points) {
      const x = ts.timeToCoordinate(p.time as Time);
      const ySt = series.priceToCoordinate(p.st);
      const yHl2 = series.priceToCoordinate(p.hl2);
      if (x === null || ySt === null || yHl2 === null) continue;
      coords.push({ x, ySt, yHl2, up: p.up });
    }
    if (coords.length < 2) return;

    // Pass 1: translucent band between supertrend line and hl2
    const upBand = hexToRgba(this._upColor, 0.18);
    const downBand = hexToRgba(this._downColor, 0.18);
    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i];
      const b = coords[i + 1];
      if (b.x <= a.x) continue;
      ctx.fillStyle = a.up ? upBand : downBand;
      ctx.beginPath();
      ctx.moveTo(a.x, a.ySt);
      ctx.lineTo(b.x, b.ySt);
      ctx.lineTo(b.x, b.yHl2);
      ctx.lineTo(a.x, a.yHl2);
      ctx.closePath();
      ctx.fill();
    }

    // Pass 2: supertrend line, colored per segment
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i];
      const b = coords[i + 1];
      if (b.x <= a.x) continue;
      ctx.strokeStyle = a.up ? this._upColor : this._downColor;
      ctx.beginPath();
      ctx.moveTo(a.x, a.ySt);
      ctx.lineTo(b.x, b.ySt);
      ctx.stroke();
    }
  }
}

class SuperTrendPaneView implements IPrimitivePaneView {
  constructor(private _source: SuperTrendPrimitive) {}

  renderer(): IPrimitivePaneRenderer {
    const source = this._source;
    return {
      draw(target) {
        target.useMediaCoordinateSpace(({ context: ctx }) => {
          source.drawOverlay(ctx);
        });
      },
    };
  }
}

// Sentiment Range MA [ChartPrime] — TradingView Pine port.
// Stateful MA that re-anchors to source whenever the smoothed candle
// top/bottom escapes the ATR×multiplier bands, then smooths the anchor
// step-series with WMA (or WMA∘SMA "double filter").
export type SentimentRangeMaTone = "bull" | "bear" | "neutral";

export type SentimentRangeMaPoint = {
  time: number;
  ma: number;
  top: number;
  bottom: number;
  tone: SentimentRangeMaTone;
};

export type SentimentRangeMaOptions = {
  length?: number;            // Pine "Length" input (UI value; effective smoothing = +1)
  doubleFilter?: boolean;     // Pine "Double Filter" (default true)
  triggerSmoothing?: number;  // Pine "Trigger Smoothing" input (effective = +1)
  atrLength?: number;         // Pine "ATR Length" (default 200)
  multiplier?: number;        // Pine "Range Multiplier" (default 6)
  rangeStyle?: "body" | "wick"; // Pine "Range Style" (default "Body")
  colorStyle?: "direction" | "cross" | "solid"; // Pine "Color Style" (default "MA Direction")
};

function smaAt(arr: number[], i: number, len: number): number {
  // SMA ending at index i over arr[i-len+1..i]; NaN if any value missing/non-finite
  if (i < len - 1) return NaN;
  let sum = 0;
  for (let j = i - len + 1; j <= i; j++) {
    const v = arr[j];
    if (!Number.isFinite(v)) return NaN;
    sum += v;
  }
  return sum / len;
}

function wmaAt(arr: number[], i: number, len: number): number {
  // WMA ending at index i; most recent weight = len, oldest = 1
  if (i < len - 1) return NaN;
  const denom = (len * (len + 1)) / 2;
  let sum = 0;
  for (let j = 0; j < len; j++) {
    const v = arr[i - j];
    if (!Number.isFinite(v)) return NaN;
    sum += v * (len - j);
  }
  return sum / denom;
}

function smoothSeries(src: number[], len: number, doubleFilter: boolean): number[] {
  const out = new Array<number>(src.length).fill(NaN);
  if (doubleFilter) {
    // ta.wma(ta.sma(src, len), len) — SMA first (tail-aligned), then WMA over it
    const sma = new Array<number>(src.length).fill(NaN);
    for (let i = 0; i < src.length; i++) sma[i] = smaAt(src, i, len);
    for (let i = 0; i < src.length; i++) out[i] = wmaAt(sma, i, len);
  } else {
    for (let i = 0; i < src.length; i++) out[i] = wmaAt(src, i, len);
  }
  return out;
}

export function calculateSentimentRangeMA(
  candles: { time: string | number; open: number; high: number; low: number; close: number }[],
  opts: SentimentRangeMaOptions = {}
): SentimentRangeMaPoint[] {
  const outLen = Math.max(1, (opts.length ?? 20) + 1);
  const doubleFilter = opts.doubleFilter ?? true;
  const trigLen = Math.max(1, (opts.triggerSmoothing ?? 4) + 1);
  const atrLen = Math.max(1, Math.floor(opts.atrLength ?? 200));
  const mult = opts.multiplier ?? 6;
  const wick = opts.rangeStyle === "wick";
  const colorStyle = opts.colorStyle ?? "direction";

  const n = candles.length;
  if (n === 0 || !Number.isFinite(mult)) return [];

  const candleTop = new Array<number>(n);
  const candleBottom = new Array<number>(n);
  const smoothTop = new Array<number>(n).fill(NaN);
  const smoothBottom = new Array<number>(n).fill(NaN);
  const atr = new Array<number>(n).fill(NaN);
  const tr = new Array<number>(n);

  for (let i = 0; i < n; i++) {
    const c = candles[i];
    const top = wick ? c.high : Math.max(c.open, c.close);
    const bottom = wick ? c.low : Math.min(c.open, c.close);
    candleTop[i] = top;
    candleBottom[i] = bottom;
    tr[i] = top - bottom;
  }
  for (let i = trigLen - 1; i < n; i++) {
    smoothTop[i] = smaAt(candleTop, i, trigLen);
    smoothBottom[i] = smaAt(candleBottom, i, trigLen);
  }
  for (let i = atrLen - 1; i < n; i++) atr[i] = smaAt(tr, i, atrLen);

  // Stateful anchor pass — mirrors the Pine var-block:
  // flag uses PREVIOUS bar's top/bottom/current_range; on flag, re-anchor.
  // sr_ma := source fires on every flag bar (even while atr is na); the
  // range vars persist between anchors.
  const rawMa = new Array<number>(n).fill(NaN);
  const rawTop = new Array<number>(n).fill(NaN);
  const rawBottom = new Array<number>(n).fill(NaN);
  let curRange = NaN;
  let topRange = NaN;
  let bottomRange = NaN;

  for (let i = 0; i < n; i++) {
    const st = smoothTop[i];
    const sb = smoothBottom[i];
    const flag =
      !Number.isFinite(curRange) ||
      (Number.isFinite(st) && st > topRange) ||
      (Number.isFinite(sb) && sb < bottomRange);
    if (flag) {
      const src = candles[i].close;
      rawMa[i] = src;
      const a = atr[i];
      curRange = Number.isFinite(a) ? a * mult : NaN;
      topRange = Number.isFinite(curRange) ? src + curRange : NaN;
      bottomRange = Number.isFinite(curRange) ? src - curRange : NaN;
    } else {
      rawMa[i] = i > 0 ? rawMa[i - 1] : NaN;
    }
    rawTop[i] = topRange;
    rawBottom[i] = bottomRange;
  }

  const smMa = smoothSeries(rawMa, outLen, doubleFilter);
  const smTop = smoothSeries(rawTop, outLen, doubleFilter);
  const smBottom = smoothSeries(rawBottom, outLen, doubleFilter);

  const points: SentimentRangeMaPoint[] = [];
  for (let i = 0; i < n; i++) {
    const ma = smMa[i];
    const top = smTop[i];
    const bottom = smBottom[i];
    if (!Number.isFinite(ma) || !Number.isFinite(top) || !Number.isFinite(bottom)) continue;

    const c = candles[i];
    let tone: SentimentRangeMaTone;
    if (colorStyle === "solid") {
      tone = "neutral";
    } else if (colorStyle === "cross") {
      tone = c.low > ma ? "bull" : c.high < ma ? "bear" : "neutral";
    } else {
      const prev = i > 0 ? smMa[i - 1] : NaN;
      const prevV = Number.isFinite(prev) ? prev : 0;
      const d = ma - prevV;
      tone = d > 0 ? "bull" : d < 0 ? "bear" : "neutral";
    }
    points.push({ time: toChartTime(c.time) as number, ma, top, bottom, tone });
  }
  return points;
}

const SRMA_TONE_COLORS: Record<SentimentRangeMaTone, string> = {
  bull: "#21ff78",
  bear: "#ff2121",
  neutral: "#898989",
};

// Sentiment Range MA overlay — colored MA line plus translucent bands
// filled between the MA and the top/bottom ranges (Pine fills at ~82%
// transparency). Range boundary lines are invisible in Pine, so skipped.
export class SentimentRangeMaPrimitive implements ISeriesPrimitive<Time> {
  private _timeScale: ITimeScaleApi<Time> | null = null;
  private _series: ISeriesApi<"Candlestick"> | null = null;
  private _requestUpdate: (() => void) | null = null;
  private _points: SentimentRangeMaPoint[] = [];
  private _bullColor: string = SRMA_TONE_COLORS.bull;
  private _bearColor: string = SRMA_TONE_COLORS.bear;
  private _neutralColor: string = SRMA_TONE_COLORS.neutral;
  private _paneViews: IPrimitivePaneView[];

  constructor() {
    this._paneViews = [new SentimentRangeMaPaneView(this)];
  }

  setColors(bull: string, bear: string, neutral: string) {
    if (bull) this._bullColor = bull;
    if (bear) this._bearColor = bear;
    if (neutral) this._neutralColor = neutral;
    this._requestUpdate?.();
  }

  attached(param: SeriesAttachedParameter<Time>) {
    this._timeScale = param.chart.timeScale();
    this._series = param.series as ISeriesApi<"Candlestick">;
    this._requestUpdate = param.requestUpdate;
  }

  detached() {
    this._timeScale = null;
    this._series = null;
  }

  setData(points: SentimentRangeMaPoint[]) {
    this._points = points;
    this._requestUpdate?.();
  }

  paneViews() {
    return this._paneViews;
  }

  private _toneColor(tone: SentimentRangeMaTone): string {
    return tone === "bull" ? this._bullColor : tone === "bear" ? this._bearColor : this._neutralColor;
  }

  drawOverlay(ctx: CanvasRenderingContext2D) {
    const ts = this._timeScale;
    const series = this._series;
    if (!ts || !series || this._points.length < 2) return;

    const coords: { x: number; yMa: number; yTop: number; yBottom: number; tone: SentimentRangeMaTone }[] = [];
    for (const p of this._points) {
      const x = ts.timeToCoordinate(p.time as Time);
      const yMa = series.priceToCoordinate(p.ma);
      const yTop = series.priceToCoordinate(p.top);
      const yBottom = series.priceToCoordinate(p.bottom);
      if (x === null || yMa === null || yTop === null || yBottom === null) continue;
      coords.push({ x, yMa, yTop, yBottom, tone: p.tone });
    }
    if (coords.length < 2) return;

    // Pass 1: translucent fills between MA and each range band — gradient
    // fading from the MA edge (semi-transparent) to invisible at the range
    // boundary, matching Pine's fill() color interpolation (the halo look).
    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i];
      const b = coords[i + 1];
      if (b.x <= a.x) continue;
      const color = this._toneColor(b.tone);
      const solid = hexToRgba(color, 0.22);
      const transparent = hexToRgba(color, 0);

      // upper band: ma → top (skip degenerate zero-height band)
      if (a.yTop !== a.yMa) {
        const grad = ctx.createLinearGradient(0, a.yMa, 0, a.yTop);
        grad.addColorStop(0, solid);
        grad.addColorStop(1, transparent);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(a.x, a.yMa);
        ctx.lineTo(b.x, b.yMa);
        ctx.lineTo(b.x, b.yTop);
        ctx.lineTo(a.x, a.yTop);
        ctx.closePath();
        ctx.fill();
      }

      // lower band: ma → bottom
      if (a.yBottom !== a.yMa) {
        const grad = ctx.createLinearGradient(0, a.yMa, 0, a.yBottom);
        grad.addColorStop(0, solid);
        grad.addColorStop(1, transparent);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(a.x, a.yMa);
        ctx.lineTo(b.x, b.yMa);
        ctx.lineTo(b.x, b.yBottom);
        ctx.lineTo(a.x, a.yBottom);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Pass 2: MA line, colored per segment
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i];
      const b = coords[i + 1];
      if (b.x <= a.x) continue;
      ctx.strokeStyle = this._toneColor(b.tone);
      ctx.beginPath();
      ctx.moveTo(a.x, a.yMa);
      ctx.lineTo(b.x, b.yMa);
      ctx.stroke();
    }
  }
}

class SentimentRangeMaPaneView implements IPrimitivePaneView {
  constructor(private _source: SentimentRangeMaPrimitive) {}

  renderer(): IPrimitivePaneRenderer {
    const source = this._source;
    return {
      draw(target) {
        target.useMediaCoordinateSpace(({ context: ctx }) => {
          source.drawOverlay(ctx);
        });
      },
    };
  }
}

// UTBot label — TradingView-style colored box with white text and arrow tail
export type UTBotLabel = { time: number; type: "BUY" | "SELL"; color: string };

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export class UTBotLabelsPrimitive implements ISeriesPrimitive<Time> {
  private _timeScale: ITimeScaleApi<Time> | null = null;
  private _series: ISeriesApi<"Candlestick"> | null = null;
  private _requestUpdate: (() => void) | null = null;
  private _labels: UTBotLabel[] = [];
  private _candles = new Map<number, { high: number; low: number }>();
  private _paneViews: IPrimitivePaneView[];

  constructor() {
    this._paneViews = [new UTBotLabelsPaneView(this)];
  }

  attached(param: SeriesAttachedParameter<Time>) {
    this._timeScale = param.chart.timeScale();
    this._series = param.series as ISeriesApi<"Candlestick">;
    this._requestUpdate = param.requestUpdate;
  }

  detached() {
    this._timeScale = null;
    this._series = null;
  }

  setData(candles: { time: number; high: number; low: number }[], labels: UTBotLabel[]) {
    this._candles = new Map(candles.map((c) => [c.time, { high: c.high, low: c.low }]));
    this._labels = labels;
    this._requestUpdate?.();
  }

  paneViews() {
    return this._paneViews;
  }

  drawLabels(ctx: CanvasRenderingContext2D) {
    const ts = this._timeScale;
    const series = this._series;
    if (!ts || !series || this._labels.length === 0) return;

    ctx.font = "bold 9px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const boxH = 13;
    const padX = 6;
    const arrowH = 4;
    const gap = 2;
    const stackGap = 2;
    const levels = new Map<string, number>();

    for (const label of this._labels) {
      const candle = this._candles.get(label.time);
      if (!candle) continue;
      const x = ts.timeToCoordinate(label.time as Time);
      if (x === null) continue;
      const edgeY = series.priceToCoordinate(label.type === "BUY" ? candle.low : candle.high);
      if (edgeY === null) continue;

      const text = label.type === "BUY" ? "Buy" : "Sell";
      const boxW = Math.ceil(ctx.measureText(text).width) + padX * 2;

      // Stack labels that share the same bar and side
      const stackKey = `${label.time}:${label.type === "BUY" ? "b" : "a"}`;
      const level = levels.get(stackKey) ?? 0;
      levels.set(stackKey, level + 1);

      let boxTop: number;
      const tipY = edgeY + (label.type === "BUY" ? gap : -gap);
      ctx.fillStyle = label.color;
      ctx.beginPath();
      if (label.type === "BUY") {
        boxTop = tipY + arrowH + level * (boxH + stackGap);
        // Arrow pointing up toward the candle
        ctx.moveTo(x, tipY);
        ctx.lineTo(x - 3.5, tipY + arrowH);
        ctx.lineTo(x + 3.5, tipY + arrowH);
      } else {
        boxTop = tipY - arrowH - boxH - level * (boxH + stackGap);
        // Arrow pointing down toward the candle
        ctx.moveTo(x, tipY);
        ctx.lineTo(x - 3.5, tipY - arrowH);
        ctx.lineTo(x + 3.5, tipY - arrowH);
      }
      ctx.closePath();
      ctx.fill();

      // Rounded label box
      roundedRectPath(ctx, x - boxW / 2, boxTop, boxW, boxH, 3);
      ctx.fill();

      // White text inside the box
      ctx.fillStyle = "#ffffff";
      ctx.fillText(text, x, boxTop + boxH / 2 + 0.5);
    }
  }
}

class UTBotLabelsPaneView implements IPrimitivePaneView {
  constructor(private _source: UTBotLabelsPrimitive) {}

  renderer(): IPrimitivePaneRenderer {
    const source = this._source;
    return {
      draw(target) {
        target.useMediaCoordinateSpace(({ context: ctx }) => {
          source.drawLabels(ctx);
        });
      },
    };
  }
}

// Convert time string to Unix timestamp (seconds) for lightweight-charts
// Handles: "2026-06-04 14:55" (live), "2026-06-05T11:36:00+05:30" (history), numeric
// We strip timezone and treat as UTC so chart shows the local IST time as-is
export function toChartTime(timeStr: string | number): UTCTimestamp {
  if (typeof timeStr === "number") {
    return timeStr as UTCTimestamp;
  }
  if (!timeStr) return 0 as UTCTimestamp;

  let date: Date;
  if (timeStr.includes("T")) {
    // ISO format — strip timezone offset, treat as UTC
    const stripped = timeStr.replace(/[+-]\d{2}:\d{2}$/, "").replace("Z", "");
    date = new Date(stripped + "Z");
  } else if (timeStr.includes(" ") && timeStr.includes("-")) {
    // Simple "2026-06-04 14:55" format
    date = new Date(timeStr.replace(" ", "T") + ":00Z");
  } else {
    // Fallback — try direct parsing
    date = new Date(timeStr);
  }

  const ts = Math.floor(date.getTime() / 1000);
  return (isNaN(ts) ? 0 : ts) as UTCTimestamp;
}

/**
 * Check if a candle has valid price data and is not a blank/flat tick
 * where start (open) and end (close) and high/low are all identical (zero-range dummy bar).
 */
export function isValidCandle(candle: { time?: string | number; open?: number | string; high?: number | string; low?: number | string; close?: number | string } | null | undefined): boolean {
  if (!candle || !candle.time) return false;
  const o = Number(candle.open);
  const h = Number(candle.high);
  const l = Number(candle.low);
  const c = Number(candle.close);
  if (!Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) return false;
  if (o <= 0 || h <= 0 || l <= 0 || c <= 0) return false;
  // Reject blank/flat candles where start and end are all the same (open == high == low == close)
  if (h <= l && o === c) return false;
  return true;
}

/**
 * Check if a given candle time is within the allowed trading session (09:00 - 15:30 IST)
 * Handles "HH:MM", "YYYY-MM-DD HH:MM", ISO timestamps, and unix seconds.
 * Dated values are also rejected on weekends.
 */
export function isWithinMarketHours(timeStrOrCandle: string | number | { time?: string | number; open?: number | string; high?: number | string; low?: number | string; close?: number | string }): boolean {
  if (!timeStrOrCandle) return false;
  if (typeof timeStrOrCandle === "object") {
    return isValidCandle(timeStrOrCandle);
  }
  if (typeof timeStrOrCandle === "number" && isNaN(timeStrOrCandle)) return false;
  return true;
}
