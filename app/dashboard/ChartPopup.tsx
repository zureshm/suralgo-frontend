"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { X, BarChart2, RefreshCw, Loader2 } from "lucide-react";
import { createChart, CandlestickSeries, IChartApi, UTCTimestamp, SeriesMarker, Time, createSeriesMarkers, LineSeries } from "lightweight-charts";
import { useTradeStore } from "../store/TradeStore";

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

  // Nifty50 live chart state
  const [nifty50Data, setNifty50Data] = useState<Nifty50CandleData>({ completedCandles: [], currentCandle: null });
  const [nifty50Connected, setNifty50Connected] = useState(false);
  const nifty50ChartRef = useRef<HTMLDivElement | null>(null);
  const nifty50ChartInstance = useRef<IChartApi | null>(null);

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

    if (allCandles.length === 0) {
      if (nifty50ChartInstance.current) {
        nifty50ChartInstance.current.remove();
        nifty50ChartInstance.current = null;
      }
      return;
    }

    // Remove existing chart
    if (nifty50ChartInstance.current) {
      nifty50ChartInstance.current.remove();
      nifty50ChartInstance.current = null;
    }

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

    if (validCandles.length === 0) return;

    series.setData(validCandles);

    // EMA overlays
    const closePrices = validCandles.map(c => c.close);
    const ema10Values = calculateEMA(closePrices, 10);
    const ema20Values = calculateEMA(closePrices, 20);

    if (ema10Values.length > 0) {
      const ema10Series = chart.addSeries(LineSeries, { color: "#2563eb", lineWidth: 1 });
      const ema10Data = ema10Values.map((val, idx) => ({
        time: validCandles[idx + (closePrices.length - ema10Values.length)].time,
        value: val,
      }));
      ema10Series.setData(ema10Data);
    }

    if (ema20Values.length > 0) {
      const ema20Series = chart.addSeries(LineSeries, { color: "#f97316", lineWidth: 1 });
      const ema20Data = ema20Values.map((val, idx) => ({
        time: validCandles[idx + (closePrices.length - ema20Values.length)].time,
        value: val,
      }));
      ema20Series.setData(ema20Data);
    }

    // Show last ~30 candles
    const visibleCandles = 30;
    chart.timeScale().setVisibleLogicalRange({
      from: validCandles.length - visibleCandles,
      to: validCandles.length + 5,
    });

    nifty50ChartInstance.current = chart;

    return () => {
      if (nifty50ChartInstance.current) {
        nifty50ChartInstance.current.remove();
        nifty50ChartInstance.current = null;
      }
    };
  }, [nifty50Data]);

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
      .slice(0, 4);

    // Dispose old charts
    Object.keys(chartInstances.current).forEach((key) => {
      if (!symbols.includes(key)) {
        chartInstances.current[key]?.remove();
        delete chartInstances.current[key];
      }
    });

    symbols.forEach((symbol) => {
      const container = chartRefs.current[symbol];
      if (!container) return;

      const candles = symbolCandles[symbol];
      if (!candles || candles.length === 0) return;

      // Remove existing chart for this symbol
      if (chartInstances.current[symbol]) {
        chartInstances.current[symbol].remove();
      }

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

      const series = chart.addSeries(CandlestickSeries, {
        upColor: "#0ad125",
        downColor: "#ea3434",
        borderUpColor: "#0ad125",
        borderDownColor: "#ea3434",
        wickUpColor: "#0ad125",
        wickDownColor: "#ea3434",
      });

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

      if (validCandles.length === 0) return;

      series.setData(validCandles);

      // Calculate and add EMA10 (blue) and EMA20 (orange) lines
      const closePrices = validCandles.map(c => c.close);
      const ema10Values = calculateEMA(closePrices, 10);
      const ema20Values = calculateEMA(closePrices, 20);

      // EMA10 line (blue)
      const ema10Series = chart.addSeries(LineSeries, {
        color: "#5488fa", // blue
        lineWidth: 1,
      });
      if (ema10Values.length > 0) {
        const ema10Data = ema10Values.map((val, idx) => ({
          time: validCandles[idx + (closePrices.length - ema10Values.length)].time,
          value: val,
        }));
        ema10Series.setData(ema10Data);
      }

      // EMA20 line (orange)
      const ema20Series = chart.addSeries(LineSeries, {
        color: "#ffd932", // orange
        lineWidth: 1,
      });
      if (ema20Values.length > 0) {
        const ema20Data = ema20Values.map((val, idx) => ({
          time: validCandles[idx + (closePrices.length - ema20Values.length)].time,
          value: val,
        }));
        ema20Series.setData(ema20Data);
      }

      // Add BUY/SELL markers (arrows only, no text)
      const markers: SeriesMarker<Time>[] = candles
        .filter((c) => c.signal === "BUY" || c.signal === "SELL")
        .map((c) => ({
          time: toChartTime(c.time) as Time,
          position: c.signal === "BUY" ? "belowBar" as const : "aboveBar" as const,
          color: c.signal === "BUY" ? "#0a8a43" : "#d12b2b",
          shape: c.signal === "BUY" ? "arrowUp" as const : "arrowDown" as const,
          text: "",
        }));

      if (markers.length > 0) {
        createSeriesMarkers(series, markers);
      }

      // Show last ~20 candles with some right padding
      const visibleCandles = 30;
      chart.timeScale().setVisibleLogicalRange({
        from: candles.length - visibleCandles,
        to: candles.length + 5,
      });
      chartInstances.current[symbol] = chart;
    });

    return () => {
      Object.values(chartInstances.current).forEach((chart) => chart.remove());
      chartInstances.current = {};
    };
  }, [symbolCandles, activeSymbols]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "var(--theme-popup-backdrop)" }}
      onClick={onClose}
    >
      <div
        className="relative w-[380px] rounded-2xl p-5"
        style={{
          background: "var(--theme-popup-bg)",
          color: "var(--theme-popup-text)",
          border: "3px solid var(--theme-popup-border)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          maxWidth: "90%",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
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
                {[...activeSymbols].slice(0, 4).map((symbol) => {
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
  );
}
