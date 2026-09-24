"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { X, BarChart2, RefreshCw, Loader2 } from "lucide-react";
import { createChart, CandlestickSeries, IChartApi, UTCTimestamp, SeriesMarker, Time, createSeriesMarkers, LineSeries, ISeriesApi, ISeriesMarkersPluginApi } from "lightweight-charts";
import { useTradeStore } from "../store/TradeStore";

interface NumericFieldProps extends Omit<React.ComponentProps<"input">, "value" | "onChange"> {
  value: number | undefined | null;
  onChange: (val: number) => void;
  fallback?: string;
}

function NumericField({ value, onChange, onBlur, fallback = "0", ...props }: NumericFieldProps) {
  const [local, setLocal] = useState<string>(value != null ? String(value) : "");
  const [prevValue, setPrevValue] = useState(value);

  if (value !== prevValue) {
    setLocal(value != null ? String(value) : "");
    setPrevValue(value);
  }
  return (
    <input
      {...props}
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      value={local}
      onChange={(e) => {
        const cleaned = e.target.value.replace(/\D/g, "");
        setLocal(cleaned);
        onChange(cleaned === "" ? 0 : Number(cleaned));
      }}
      onBlur={(e: React.FocusEvent<HTMLInputElement>) => {
        if (!e.target.value) {
          setLocal(fallback);
          onChange(Number(fallback));
        }
        onBlur?.(e);
      }}
    />
  );
}

const STRATEGY_URL = process.env.NEXT_PUBLIC_STRATEGY_API_URL || "http://localhost:4000";
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:2000";
const NIFTY50_WS_URL = process.env.NEXT_PUBLIC_NIFTY50_WS_URL || API_BASE_URL.replace(/^http/, "ws") + "/ws/nifty50";

type CandleData = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  signal?: "BUY" | "SELL";
};

type SymbolCandles = Record<string, CandleData[]>;

function parseCandlesFromLogs(logs: string[]): SymbolCandles {
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

    // Match: [LOG] ... Current eval: BUY or SELL
    if (lastAddedCandle && line.includes("Current eval:")) {
      const signalMatch = line.match(/Current eval:\s*(BUY|SELL)/);
      if (signalMatch) {
        const signal = signalMatch[1] as "BUY" | "SELL";
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

// Calculate EMA (Exponential Moving Average)
function calculateEMA(prices: number[], period: number): number[] {
  if (prices.length < period) return [];
  
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

// UTBot Signal Type
type UTBotSignal = {
  time: number;
  type: "BUY" | "SELL";
};

// Calculate UTBot Signals
function calculateUTBot(candles: CandleData[], key: number, atrPeriod: number): UTBotSignal[] {
  if (candles.length < atrPeriod + 1) return [];

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

// Convert time string to Unix timestamp (seconds) for lightweight-charts
// Handles: "2026-06-04 14:55" (live), "2026-06-05T11:36:00+05:30" (history), numeric
// We strip timezone and treat as UTC so chart shows the local IST time as-is
function toChartTime(timeStr: string | number): UTCTimestamp {
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

type Props = {
  open: boolean;
  onClose: () => void;
};

type Nifty50CandleData = {
  completedCandles: CandleData[];
  currentCandle: CandleData | null;
};

export default function ChartPopup({ open, onClose }: Props) {
  const { activeTrades, waitingTrades } = useTradeStore();
  const [symbolCandles, setSymbolCandles] = useState<SymbolCandles>({});
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const chartRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const chartInstances = useRef<Record<string, IChartApi>>({});
  const seriesInstances = useRef<Record<string, { main: ISeriesApi<"Candlestick">; ema1: ISeriesApi<"Line">; ema2: ISeriesApi<"Line">; markerPlugin: ISeriesMarkersPluginApi<Time> }>>({});

  // Nifty50 live chart state
  const [nifty50Data, setNifty50Data] = useState<Nifty50CandleData>({ completedCandles: [], currentCandle: null });
  const [nifty50Connected, setNifty50Connected] = useState(false);
  const nifty50ChartRef = useRef<HTMLDivElement | null>(null);
  const nifty50ChartInstance = useRef<IChartApi | null>(null);
  const nifty50SeriesInstance = useRef<{ main: ISeriesApi<"Candlestick">; ema1: ISeriesApi<"Line">; ema2: ISeriesApi<"Line">; markerPlugin: ISeriesMarkersPluginApi<Time> } | null>(null);

  // Indicators state
  const [indicatorsOpen, setIndicatorsOpen] = useState(false);
  const [ema1Enabled, setEma1Enabled] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("nifty_ema1_enabled");
      return saved !== null ? saved === "true" : true;
    }
    return true;
  });
  const [ema1Period, setEma1Period] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("nifty_ema1_period");
      return saved !== null ? parseInt(saved, 10) : 10;
    }
    return 10;
  });
  const [ema2Enabled, setEma2Enabled] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("nifty_ema2_enabled");
      return saved !== null ? saved === "true" : true;
    }
    return true;
  });
  const [ema2Period, setEma2Period] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("nifty_ema2_period");
      return saved !== null ? parseInt(saved, 10) : 30;
    }
    return 30;
  });

  // UTBot states
  const [utbot1Enabled, setUtbot1Enabled] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("nifty_utbot1_enabled");
      return saved !== null ? saved === "true" : true;
    }
    return true;
  });
  const [utbot1Key, setUtbot1Key] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("nifty_utbot1_key");
      return saved !== null ? parseFloat(saved) : 2;
    }
    return 2;
  });
  const [utbot1Atr, setUtbot1Atr] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("nifty_utbot1_atr");
      return saved !== null ? parseInt(saved, 10) : 10;
    }
    return 10;
  });

  const [utbot2Enabled, setUtbot2Enabled] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("nifty_utbot2_enabled");
      return saved !== null ? saved === "true" : false;
    }
    return false;
  });
  const [utbot2Key, setUtbot2Key] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("nifty_utbot2_key");
      return saved !== null ? parseFloat(saved) : 3;
    }
    return 3;
  });
  const [utbot2Atr, setUtbot2Atr] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("nifty_utbot2_atr");
      return saved !== null ? parseInt(saved, 10) : 10;
    }
    return 10;
  });

  const [utbot3Enabled, setUtbot3Enabled] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("nifty_utbot3_enabled");
      return saved !== null ? saved === "true" : false;
    }
    return false;
  });
  const [utbot3Key, setUtbot3Key] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("nifty_utbot3_key");
      return saved !== null ? parseFloat(saved) : 4;
    }
    return 4;
  });
  const [utbot3Atr, setUtbot3Atr] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("nifty_utbot3_atr");
      return saved !== null ? parseInt(saved, 10) : 10;
    }
    return 10;
  });

  // Save indicator settings
  useEffect(() => {
    localStorage.setItem("nifty_ema1_enabled", String(ema1Enabled));
    localStorage.setItem("nifty_ema1_period", String(ema1Period));
    localStorage.setItem("nifty_ema2_enabled", String(ema2Enabled));
    localStorage.setItem("nifty_ema2_period", String(ema2Period));

    localStorage.setItem("nifty_utbot1_enabled", String(utbot1Enabled));
    localStorage.setItem("nifty_utbot1_key", String(utbot1Key));
    localStorage.setItem("nifty_utbot1_atr", String(utbot1Atr));

    localStorage.setItem("nifty_utbot2_enabled", String(utbot2Enabled));
    localStorage.setItem("nifty_utbot2_key", String(utbot2Key));
    localStorage.setItem("nifty_utbot2_atr", String(utbot2Atr));

    localStorage.setItem("nifty_utbot3_enabled", String(utbot3Enabled));
    localStorage.setItem("nifty_utbot3_key", String(utbot3Key));
    localStorage.setItem("nifty_utbot3_atr", String(utbot3Atr));
  }, [
    ema1Enabled, ema1Period, ema2Enabled, ema2Period,
    utbot1Enabled, utbot1Key, utbot1Atr,
    utbot2Enabled, utbot2Key, utbot2Atr,
    utbot3Enabled, utbot3Key, utbot3Atr
  ]);

  // Only show charts for symbols in active/waiting trades
  // Stabilize: only return new Set when actual symbol list changes
  const activeSymbolsKey = useMemo(() => {
    const syms: string[] = [];
    activeTrades.forEach((t) => { if (!syms.includes(t.symbol)) syms.push(t.symbol); });
    waitingTrades.forEach((t) => { if (!syms.includes(t.symbol)) syms.push(t.symbol); });
    return syms.sort().join(",");
  }, [activeTrades, waitingTrades]);

  const activeSymbols = useMemo(() => {
    const set = new Set<string>();
    activeSymbolsKey.split(",").filter(Boolean).forEach((s) => set.add(s));
    return set;
  }, [activeSymbolsKey]);

  // Clear data when popup closes
  useEffect(() => {
    if (!open) return;

    return () => {
      setSymbolCandles({});
      setError(null);
    };
  }, [open]);

  // Nifty50 WebSocket connection
  useEffect(() => {
    if (!open) return;

    let ws: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    function connect() {
      if (disposed) return;
      ws = new WebSocket(NIFTY50_WS_URL);

      ws.onopen = () => {
        if (disposed) return;
        setNifty50Connected(true);
      };

      ws.onmessage = (event) => {
        if (disposed) return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "snapshot" || msg.type === "update") {
            setNifty50Data({
              completedCandles: msg.completedCandles || [],
              currentCandle: msg.currentCandle || null,
            });
          }
        } catch {}
      };

      ws.onclose = () => {
        if (disposed) return;
        setNifty50Connected(false);
        reconnectTimeout = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws?.close();
      };
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      ws?.close();
      setNifty50Data({ completedCandles: [], currentCandle: null });
      setNifty50Connected(false);
    };
  }, [open]);

  // Render Nifty50 chart
  useEffect(() => {
    const container = nifty50ChartRef.current;
    if (!container) return;

    const allCandles = [...(nifty50Data.completedCandles || [])];
    if (nifty50Data.currentCandle) {
      allCandles.push(nifty50Data.currentCandle);
    }

    if (allCandles.length === 0) return;

    // Initialize chart if not exists
    if (!nifty50ChartInstance.current) {
      const chart = createChart(container, {
        width: container.clientWidth,
        height: 220,
        layout: {
          background: { color: "transparent" },
          textColor: "#333",
          fontSize: 10,
        },
        grid: {
          vertLines: { color: "rgba(0,0,0,0.04)" },
          horzLines: { color: "rgba(0,0,0,0.04)" },
        },
        timeScale: {
          timeVisible: true,
          secondsVisible: false,
          borderColor: "rgba(0,0,0,0.1)",
        },
        rightPriceScale: {
          borderColor: "rgba(0,0,0,0.1)",
        },
      });

      const series = chart.addSeries(CandlestickSeries, {
        upColor: "#0a8a43",
        downColor: "#d12b2b",
        borderUpColor: "#0a8a43",
        borderDownColor: "#d12b2b",
        wickUpColor: "#0a8a43",
        wickDownColor: "#d12b2b",
      });

      const ema1 = chart.addSeries(LineSeries, { color: "#2563eb", lineWidth: 1 });
      const ema2 = chart.addSeries(LineSeries, { color: "#f97316", lineWidth: 1 });

      nifty50ChartInstance.current = chart;
      nifty50SeriesInstance.current = { main: series, ema1, ema2, markerPlugin: createSeriesMarkers(series) };
    }

    const { main, ema1, ema2, markerPlugin } = nifty50SeriesInstance.current!;

    const mapped = allCandles
      .map((c) => ({
        time: toChartTime(c.time),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
      .filter((c) => c.time > 0);

    const deduped = new Map<number, typeof mapped[0]>();
    for (const c of mapped) deduped.set(c.time as number, c);
    const validCandles = Array.from(deduped.values())
      .sort((a, b) => (a.time as number) - (b.time as number));

    if (validCandles.length > 0) {
      main.setData(validCandles);

      // EMA overlays
      const closePrices = validCandles.map(c => c.close);
      
      if (ema1Enabled) {
        const ema1Values = calculateEMA(closePrices, ema1Period);
        if (ema1Values.length > 0) {
          ema1.setData(ema1Values.map((val, idx) => ({
            time: validCandles[idx + (closePrices.length - ema1Values.length)].time,
            value: val,
          })));
        } else {
          ema1.setData([]);
        }
      } else {
        ema1.setData([]);
      }

      if (ema2Enabled) {
        const ema2Values = calculateEMA(closePrices, ema2Period);
        if (ema2Values.length > 0) {
          ema2.setData(ema2Values.map((val, idx) => ({
            time: validCandles[idx + (closePrices.length - ema2Values.length)].time,
            value: val,
          })));
        } else {
          ema2.setData([]);
        }
      } else {
        ema2.setData([]);
      }

      // UTBot Markers
      const markers: SeriesMarker<Time>[] = [];
      
      if (utbot1Enabled) {
        const ut1Signals = calculateUTBot(allCandles, utbot1Key, utbot1Atr);
        ut1Signals.forEach(s => {
          markers.push({
            time: s.time as Time,
            position: s.type === "BUY" ? "belowBar" : "aboveBar",
            color: s.type === "BUY" ? "#a855f7" : "#fbbf24",
            shape: s.type === "BUY" ? "arrowUp" : "arrowDown",
            text: "",
          });
        });
      }

      if (utbot2Enabled) {
        const ut2Signals = calculateUTBot(allCandles, utbot2Key, utbot2Atr);
        ut2Signals.forEach(s => {
          markers.push({
            time: s.time as Time,
            position: s.type === "BUY" ? "belowBar" : "aboveBar",
            color: s.type === "BUY" ? "#06b6d4" : "#f472b6",
            shape: s.type === "BUY" ? "arrowUp" : "arrowDown",
            text: "",
          });
        });
      }

      if (utbot3Enabled) {
        const ut3Signals = calculateUTBot(allCandles, utbot3Key, utbot3Atr);
        ut3Signals.forEach(s => {
          markers.push({
            time: s.time as Time,
            position: s.type === "BUY" ? "belowBar" : "aboveBar",
            color: s.type === "BUY" ? "#16a34a" : "#dc2626",
            shape: s.type === "BUY" ? "arrowUp" : "arrowDown",
            text: "",
          });
        });
      }

      // Sort markers by time before setting
      markers.sort((a, b) => (a.time as number) - (b.time as number));
      markerPlugin.setMarkers(markers);
    }

    return () => {
      // We don't remove chart on every update anymore
    };
  }, [nifty50Data, ema1Enabled, ema1Period, ema2Enabled, ema2Period, 
      utbot1Enabled, utbot1Key, utbot1Atr, 
      utbot2Enabled, utbot2Key, utbot2Atr, 
      utbot3Enabled, utbot3Key, utbot3Atr]);

  // Clean up Nifty50 chart on close
  useEffect(() => {
    if (!open && nifty50ChartInstance.current) {
      nifty50ChartInstance.current.remove();
      nifty50ChartInstance.current = null;
      nifty50SeriesInstance.current = null;
    }
  }, [open]);

  // Fetch candle history + log signals — on open and manual refresh only
  useEffect(() => {
    if (!open) return;

    const fetchCandles = () => {
      setSpinning(true);
      Promise.all([
        fetch(`${STRATEGY_URL}/chart-history`).then((r) => r.json()).catch(() => ({})),
        fetch(`${STRATEGY_URL}/logs/strategy`).then((r) => r.json()).catch(() => ({ logs: [] })),
      ])
        .then(([historyData, logData]) => {
          const logs: string[] = logData.logs || [];
          const logCandles = parseCandlesFromLogs(logs);

          // Use history if available, otherwise fall back to log-parsed candles
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
            setSymbolCandles(result);
          } else {
            // Fallback: use only log-parsed candles
            setSymbolCandles(logCandles);
          }
          setError(null);
        })
        .catch(() => {
          setError("Failed to fetch from strategy server");
        })
        .finally(() => {
          setSpinning(false);
        });
    };

    const kickoff = setTimeout(fetchCandles, 0);
    return () => clearTimeout(kickoff);
  }, [open, refreshKey]);

  // Create/update charts when data changes
  useEffect(() => {
    const symbols = Object.keys(symbolCandles)
      .filter((s) => activeSymbols.has(s))
      .slice(0, 8);

    // Dispose charts for symbols no longer active
    Object.keys(chartInstances.current).forEach((key) => {
      if (!symbols.includes(key)) {
        chartInstances.current[key]?.remove();
        delete chartInstances.current[key];
        delete seriesInstances.current[key];
      }
    });

    symbols.forEach((symbol) => {
      const container = chartRefs.current[symbol];
      if (!container) return;

      const candles = symbolCandles[symbol];
      if (!candles || candles.length === 0) return;

      // Initialize chart if not exists
      if (!chartInstances.current[symbol]) {
        const chart = createChart(container, {
          width: container.clientWidth,
          height: 180,
          layout: {
            background: { color: "rgba(0,0,0,0.9)" },
            textColor: "#eee",
            fontSize: 10,
          },
          grid: {
            vertLines: { color: "rgba(255,255,255,0.14)" },
            horzLines: { color: "rgba(255,255,255,0.14)" },
          },
          timeScale: {
            timeVisible: true,
            secondsVisible: false,
            borderColor: "rgba(255,255,255.1)",
          },
          rightPriceScale: {
            borderColor: "rgba(255,255,255.1)",
          },
        });

        const main = chart.addSeries(CandlestickSeries, {
          upColor: "#0ad125",
          downColor: "#ea3434",
          borderUpColor: "#0ad125",
          borderDownColor: "#ea3434",
          wickUpColor: "#0ad125",
          wickDownColor: "#ea3434",
        });

        const ema1 = chart.addSeries(LineSeries, { color: "#5488fa", lineWidth: 1 });
        const ema2 = chart.addSeries(LineSeries, { color: "#ffd932", lineWidth: 1 });

        chartInstances.current[symbol] = chart;
        seriesInstances.current[symbol] = { main, ema1, ema2, markerPlugin: createSeriesMarkers(main) };
      }

      const { main, ema1, ema2, markerPlugin } = seriesInstances.current[symbol];

      // Filter invalid times, deduplicate, and sort ascending
      const mapped = candles
        .map((c) => ({
          time: toChartTime(c.time),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }))
        .filter((c) => c.time > 0);

      // Deduplicate by time (keep last occurrence)
      const deduped = new Map<number, typeof mapped[0]>();
      for (const c of mapped) deduped.set(c.time as number, c);
      const validCandles = Array.from(deduped.values())
        .sort((a, b) => (a.time as number) - (b.time as number));

      if (validCandles.length > 0) {
        main.setData(validCandles);

        // EMA lines
        const closePrices = validCandles.map(c => c.close);
        const ema10Values = calculateEMA(closePrices, 10);
        const ema20Values = calculateEMA(closePrices, 20);

        if (ema10Values.length > 0) {
          ema1.setData(ema10Values.map((val, idx) => ({
            time: validCandles[idx + (closePrices.length - ema10Values.length)].time,
            value: val,
          })));
        }
        if (ema20Values.length > 0) {
          ema2.setData(ema20Values.map((val, idx) => ({
            time: validCandles[idx + (closePrices.length - ema20Values.length)].time,
            value: val,
          })));
        }

        // Add BUY/SELL markers
        const markers: SeriesMarker<Time>[] = candles
          .filter((c) => c.signal === "BUY" || c.signal === "SELL")
          .map((c) => ({
            time: toChartTime(c.time) as Time,
            position: c.signal === "BUY" ? "belowBar" as const : "aboveBar" as const,
            color: c.signal === "BUY" ? "#0a8a43" : "#d12b2b",
            shape: c.signal === "BUY" ? "arrowUp" as const : "arrowDown" as const,
            text: "",
          }));

        markerPlugin.setMarkers(markers);
      }
    });
  }, [symbolCandles, activeSymbols]);

  // Clean up strategy charts on close
  useEffect(() => {
    if (!open) {
      Object.values(chartInstances.current).forEach((chart) => chart.remove());
      chartInstances.current = {};
      seriesInstances.current = {};
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "var(--theme-popup-backdrop)" }}
      onClick={onClose}
    >
      <div
        className="relative w-[380px] rounded-2xl flex flex-col overflow-hidden"
        style={{
          background: "var(--theme-popup-bg)",
          color: "var(--theme-popup-text)",
          border: "3px solid var(--theme-popup-border)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          maxWidth: "90%",
          maxHeight: "90vh",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header - fixed */}
        <div className="flex items-center justify-between p-5 pb-4">
          <div className="flex items-center gap-2">
            <BarChart2 size={20} style={{ color: "var(--theme-popup-border)" }} />
            <h2 className="text-lg font-bold" style={{ color: "var(--theme-popup-text)" }}>Charts</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full transition"
            style={{ background: "var(--theme-popup-border)", color: "#fff" }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 pb-5" style={{ scrollbarWidth: "thin" }}>
        {/* Nifty50 Live Chart */}
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold" style={{ color: "var(--theme-popup-border)" }}>NIFTY 50</span>
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ background: nifty50Connected ? "#0a8a43" : "#d12b2b" }}
              title={nifty50Connected ? "Live" : "Disconnected"}
            />
            {nifty50Data.currentCandle && (
              <span className="text-xs" style={{ color: "var(--theme-popup-label)" }}>
                LTP: {nifty50Data.currentCandle.close} | {nifty50Data.completedCandles.length} candles
              </span>
            )}
          </div>
          {nifty50Data.completedCandles.length === 0 && !nifty50Data.currentCandle ? (
            <div className="text-xs py-4 text-center" style={{ color: "var(--theme-popup-label)" }}>
              {nifty50Connected ? "Waiting for Nifty50 data..." : "Connecting to Nifty50 feed..."}
            </div>
          ) : (
            <div
              ref={nifty50ChartRef}
              className="w-full rounded-lg overflow-hidden"
              style={{ height: 220, background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)" }}
            />
          )}
        </div>
        
        {/* Indicators Panel */}
        <div className="mb-4">
          <div 
            className="flex items-center justify-between cursor-pointer py-2 px-3 rounded-lg hover:bg-black/5 transition"
            onClick={() => setIndicatorsOpen(!indicatorsOpen)}
            style={{ background: "rgba(0,0,0,0.03)", border: "1px solid var(--theme-popup-field-border)" }}
          >
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold" style={{ color: "var(--theme-popup-text)" }}>Indicators</span>
            </div>
            <button
              type="button"
              style={{
                width: 32,
                height: 18,
                borderRadius: 9,
                background: indicatorsOpen ? "var(--theme-toggle-on, var(--theme-popup-border))" : "var(--theme-toggle-off, var(--theme-popup-field-border))",
                position: "relative",
                transition: "background 0.2s",
                border: "none",
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: 2,
                  left: indicatorsOpen ? 16 : 2,
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  background: "#fff",
                  transition: "left 0.2s",
                }}
              />
            </button>
          </div>

          {indicatorsOpen && (
            <div className="mt-2 p-3 rounded-lg space-y-3" style={{ background: "rgba(0,0,0,0.02)", border: "1px solid var(--theme-popup-field-border)" }}>
              {/* EMA 1 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={ema1Enabled}
                    onChange={(e) => setEma1Enabled(e.target.checked)}
                    className="h-3.5 w-3.5 accent-blue-600"
                  />
                  <span className="text-xs font-medium" style={{ color: "var(--theme-popup-text)" }}>EMA 1</span>
                </div>
                <div className="flex items-center gap-2">
                  <NumericField
                    value={ema1Period}
                    onChange={setEma1Period}
                    className="w-12 h-7 rounded text-center text-xs font-bold"
                    style={{
                      background: "var(--theme-popup-field-bg)",
                      color: "var(--theme-popup-text)",
                      border: "1px solid var(--theme-popup-field-border)",
                    }}
                    fallback="10"
                  />
                </div>
              </div>

              {/* EMA 2 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={ema2Enabled}
                    onChange={(e) => setEma2Enabled(e.target.checked)}
                    className="h-3.5 w-3.5 accent-orange-600"
                  />
                  <span className="text-xs font-medium" style={{ color: "var(--theme-popup-text)" }}>EMA 2</span>
                </div>
                <div className="flex items-center gap-2">
                  <NumericField
                    value={ema2Period}
                    onChange={setEma2Period}
                    className="w-12 h-7 rounded text-center text-xs font-bold"
                    style={{
                      background: "var(--theme-popup-field-bg)",
                      color: "var(--theme-popup-text)",
                      border: "1px solid var(--theme-popup-field-border)",
                    }}
                    fallback="30"
                  />
                </div>
              </div>

              {/* UTBot 1 */}
              <div className="flex items-center justify-between pt-2" style={{ borderTop: "1px solid rgba(0,0,0,0.05)" }}>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={utbot1Enabled}
                    onChange={(e) => setUtbot1Enabled(e.target.checked)}
                    className="h-3.5 w-3.5 accent-purple-600"
                  />
                  <span className="text-xs font-medium" style={{ color: "var(--theme-popup-text)" }}>UTBOT 1</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] font-bold opacity-50">KEY</span>
                    <NumericField
                      value={utbot1Key}
                      onChange={setUtbot1Key}
                      className="w-10 h-7 rounded text-center text-xs font-bold"
                      style={{
                        background: "var(--theme-popup-field-bg)",
                        color: "var(--theme-popup-text)",
                        border: "1px solid var(--theme-popup-field-border)",
                      }}
                      fallback="2"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] font-bold opacity-50">ATR</span>
                    <NumericField
                      value={utbot1Atr}
                      onChange={setUtbot1Atr}
                      className="w-10 h-7 rounded text-center text-xs font-bold"
                      style={{
                        background: "var(--theme-popup-field-bg)",
                        color: "var(--theme-popup-text)",
                        border: "1px solid var(--theme-popup-field-border)",
                      }}
                      fallback="10"
                    />
                  </div>
                </div>
              </div>

              {/* UTBot 2 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={utbot2Enabled}
                    onChange={(e) => setUtbot2Enabled(e.target.checked)}
                    className="h-3.5 w-3.5 accent-cyan-600"
                  />
                  <span className="text-xs font-medium" style={{ color: "var(--theme-popup-text)" }}>UTBOT 2</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] font-bold opacity-50">KEY</span>
                    <NumericField
                      value={utbot2Key}
                      onChange={setUtbot2Key}
                      className="w-10 h-7 rounded text-center text-xs font-bold"
                      style={{
                        background: "var(--theme-popup-field-bg)",
                        color: "var(--theme-popup-text)",
                        border: "1px solid var(--theme-popup-field-border)",
                      }}
                      fallback="3"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] font-bold opacity-50">ATR</span>
                    <NumericField
                      value={utbot2Atr}
                      onChange={setUtbot2Atr}
                      className="w-10 h-7 rounded text-center text-xs font-bold"
                      style={{
                        background: "var(--theme-popup-field-bg)",
                        color: "var(--theme-popup-text)",
                        border: "1px solid var(--theme-popup-field-border)",
                      }}
                      fallback="10"
                    />
                  </div>
                </div>
              </div>

              {/* UTBot 3 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={utbot3Enabled}
                    onChange={(e) => setUtbot3Enabled(e.target.checked)}
                    className="h-3.5 w-3.5 accent-green-600"
                  />
                  <span className="text-xs font-medium" style={{ color: "var(--theme-popup-text)" }}>UTBOT 3</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] font-bold opacity-50">KEY</span>
                    <NumericField
                      value={utbot3Key}
                      onChange={setUtbot3Key}
                      className="w-10 h-7 rounded text-center text-xs font-bold"
                      style={{
                        background: "var(--theme-popup-field-bg)",
                        color: "var(--theme-popup-text)",
                        border: "1px solid var(--theme-popup-field-border)",
                      }}
                      fallback="4"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] font-bold opacity-50">ATR</span>
                    <NumericField
                      value={utbot3Atr}
                      onChange={setUtbot3Atr}
                      className="w-10 h-7 rounded text-center text-xs font-bold"
                      style={{
                        background: "var(--theme-popup-field-bg)",
                        color: "var(--theme-popup-text)",
                        border: "1px solid var(--theme-popup-field-border)",
                      }}
                      fallback="10"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {activeSymbols.size > 0 && (
          <>
            <div className="flex items-center justify-between mb-2">
              <h3 style={{ color: "var(--theme-popup-text)", padding: "10px 0" }}>Strategy Chart Status</h3>
              <button
                onClick={() => setRefreshKey(k => k + 1)}
                className="p-1.5 rounded-full transition hover:opacity-80"
                style={{ background: "var(--theme-popup-border)", color: "#fff" }}
                title="Refresh charts"
                disabled={spinning}
              >
                <RefreshCw size={16} className={spinning ? "animate-spin" : ""} />
              </button>
            </div>
            {error ? (
              <div className="text-sm py-8 text-center" style={{ color: "var(--theme-status-loss)" }}>{error}</div>
            ) : (
              <div className="flex flex-col gap-4">
                {[...activeSymbols].slice(0, 8).map((symbol) => {
                  const hasData = symbolCandles[symbol] && symbolCandles[symbol].length > 0;
                  return (
                    <div key={symbol}>
                      <div className="text-xs font-semibold mb-1 truncate" style={{ color: "var(--theme-popup-border)" }}>
                        {symbol}
                        {hasData && (
                          <span className="ml-2 font-normal" style={{ color: "var(--theme-popup-label)" }}>
                            ({symbolCandles[symbol]?.length || 0} candles)
                          </span>
                        )}
                      </div>
                      {hasData ? (
                        <div
                          ref={(el) => { chartRefs.current[symbol] = el; }}
                          className="w-full rounded-lg overflow-hidden"
                          style={{ height: 180, background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)" }}
                        />
                      ) : (
                        <div
                          className="w-full rounded-lg flex items-center justify-center gap-2"
                          style={{ height: 180, background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)" }}
                        >
                          <Loader2 size={16} className="animate-spin" style={{ color: "var(--theme-popup-label)" }} />
                          <span className="text-xs" style={{ color: "var(--theme-popup-label)" }}>Loading chart...</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
        </div>
      </div>
    </div>
  );
}
