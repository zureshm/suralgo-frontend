"use client";

import { useEffect, useState, useRef } from "react";
import { X, BarChart2 } from "lucide-react";
import { createChart, CandlestickSeries, IChartApi, UTCTimestamp, SeriesMarker, Time, createSeriesMarkers } from "lightweight-charts";
import { useTradeStore } from "../store/TradeStore";

const STRATEGY_URL = process.env.NEXT_PUBLIC_STRATEGY_API_URL || "http://localhost:4000";

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

  // Keep only last 60 candles per symbol, sorted by time
  for (const symbol of Object.keys(result)) {
    result[symbol] = result[symbol]
      .sort((a, b) => a.time.localeCompare(b.time))
      .slice(-60);
  }

  return result;
}

// Convert "2026-06-04 14:55" to Unix timestamp (seconds) for lightweight-charts
// Parse as UTC so the chart displays the exact time from log (IST) without offset
function toChartTime(timeStr: string): UTCTimestamp {
  const date = new Date(timeStr.replace(" ", "T") + ":00Z");
  return Math.floor(date.getTime() / 1000) as UTCTimestamp;
}

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function ChartPopup({ open, onClose }: Props) {
  const { activeTrades, waitingTrades } = useTradeStore();
  const [symbolCandles, setSymbolCandles] = useState<SymbolCandles>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chartRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const chartInstances = useRef<Record<string, IChartApi>>({});

  // Only show charts for symbols in active/waiting trades
  const activeSymbols = new Set([
    ...activeTrades.map((t) => t.symbol),
    ...waitingTrades.map((t) => t.symbol),
  ]);

  // Clear data when popup closes
  useEffect(() => {
    if (!open) {
      setSymbolCandles({});
      setError(null);
    }
  }, [open]);

  // Fetch logs and parse candles — poll every 5s while open
  useEffect(() => {
    if (!open) return;

    const fetchCandles = () => {
      fetch(`${STRATEGY_URL}/logs/strategy`)
        .then((r) => r.json())
        .then((data) => {
          const logs: string[] = data.logs || [];
          const candles = parseCandlesFromLogs(logs);
          setSymbolCandles(candles);
          setError(null);
        })
        .catch(() => {
          setError("Failed to fetch logs from strategy server");
        })
        .finally(() => setLoading(false));
    };

    setLoading(true);
    fetchCandles();

    const interval = setInterval(fetchCandles, 5000);
    return () => clearInterval(interval);
  }, [open]);

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

      series.setData(
        candles.map((c) => ({
          time: toChartTime(c.time),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }))
      );

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

      // Show last ~25 candles with some right padding
      const visibleCandles = 25;
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
  }, [symbolCandles, activeSymbols.size]);

  if (!open) return null;

  const symbols = Object.keys(symbolCandles)
    .filter((s) => activeSymbols.has(s))
    .slice(0, 4);

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

        {loading ? (
          <div className="text-sm py-8 text-center" style={{ color: "var(--theme-popup-label)" }}>Loading charts...</div>
        ) : error ? (
          <div className="text-sm py-8 text-center" style={{ color: "var(--theme-status-loss)" }}>{error}</div>
        ) : symbols.length === 0 ? (
          <div className="text-sm py-8 text-center" style={{ color: "var(--theme-popup-label)" }}>No candle data available yet</div>
        ) : (
          <div className="flex flex-col gap-4">
            {symbols.map((symbol) => (
              <div key={symbol}>
                <div className="text-xs font-semibold mb-1 truncate" style={{ color: "var(--theme-popup-border)" }}>
                  {symbol}
                  <span className="ml-2 font-normal" style={{ color: "var(--theme-popup-label)" }}>
                    ({symbolCandles[symbol]?.length || 0} candles)
                  </span>
                </div>
                <div
                  ref={(el) => { chartRefs.current[symbol] = el; }}
                  className="w-full rounded-lg overflow-hidden"
                  style={{ height: 180, background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)" }}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
