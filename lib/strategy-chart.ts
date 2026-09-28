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

// UTBot Signal Type
export type UTBotSignal = {
  time: number;
  type: "BUY" | "SELL";
};

// Calculate UTBot Signals
export function calculateUTBot(candles: { time: string | number; open: number; high: number; low: number; close: number }[], key: number, atrPeriod: number): UTBotSignal[] {
  if (!Number.isFinite(key) || key <= 0 || !Number.isFinite(atrPeriod) || atrPeriod < 1 || candles.length < atrPeriod + 1) return [];

  // 1. Calculate TR (True Range)
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }

  // 2. Calculate ATR using RMA (Running Moving Average) - as used in TradingView's ATR
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
 * Check if a given candle time is within the allowed trading session (09:00 - 15:30 IST)
 * Handles "HH:MM", "YYYY-MM-DD HH:MM", and ISO timestamps.
 */
export function isWithinMarketHours(timeStr: string | number): boolean {
  if (!timeStr) return false;

  let date: Date;
  if (typeof timeStr === "number") {
    // Unix timestamp in seconds
    date = new Date(timeStr * 1000);
  } else if (timeStr.includes("T")) {
    // ISO format: "2026-06-05T11:36:00+05:30"
    // We want to extract the local time part regardless of browser timezone
    // to match the IST session.
    const match = timeStr.match(/T(\d{2}):(\d{2})/);
    if (!match) return false;
    const hh = parseInt(match[1], 10);
    const mm = parseInt(match[2], 10);
    const totalMinutes = hh * 60 + mm;
    return totalMinutes >= 9 * 60 && totalMinutes <= (15 * 60 + 30);
  } else {
    // Simple formats like "2026-06-04 14:55" or "14:55"
    const match = timeStr.match(/(\d{2}):(\d{2})/);
    if (!match) return false;
    const hh = parseInt(match[1], 10);
    const mm = parseInt(match[2], 10);
    const totalMinutes = hh * 60 + mm;
    return totalMinutes >= 9 * 60 && totalMinutes <= (15 * 60 + 30);
  }

  // If we have a real Date object (from unix timestamp)
  // Convert to IST HH:MM for the check
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(date.getTime() + istOffset);
  const hh = istDate.getUTCHours();
  const mm = istDate.getUTCMinutes();
  const day = istDate.getUTCDay(); // 0 = Sun, 6 = Sat

  // Skip weekends
  if (day === 0 || day === 6) return false;

  const totalMinutes = hh * 60 + mm;
  return totalMinutes >= 9 * 60 && totalMinutes <= (15 * 60 + 30);
}
