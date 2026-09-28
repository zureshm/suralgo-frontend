"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { RefreshCw, Loader2 } from "lucide-react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  IChartApi,
  ISeriesApi,
  ISeriesMarkersPluginApi,
  SeriesMarker,
  Time,
  createSeriesMarkers,
} from "lightweight-charts";
import {
  fetchSymbolCandles,
  toChartTime,
  toHeikenAshi,
  calculateEMA,
  calculateUTBot,
  UTBotLabelsPrimitive,
  UTBotLabel,
  CandleData,
} from "@/lib/strategy-chart";

const lsNum = (key: string, fallback: number) => {
  if (typeof window === "undefined") return fallback;
  const v = localStorage.getItem(key);
  const n = v !== null ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const lsBool = (key: string, fallback: boolean) => {
  if (typeof window === "undefined") return fallback;
  const v = localStorage.getItem(key);
  return v !== null ? v === "true" : fallback;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:2000";
const NIFTY50_WS_URL = process.env.NEXT_PUBLIC_NIFTY50_WS_URL || API_BASE_URL.replace(/^http/, "ws") + "/ws/nifty50";

function StrategyChartPage() {
  const searchParams = useSearchParams();
  const symbol = searchParams.get("symbol") || "";
  const isNifty = symbol === "NIFTY50";
  const [isHydrated, setIsHydrated] = useState(false);

  const [candles, setCandles] = useState<CandleData[]>([]);
  const [loading, setLoading] = useState(true);
  const [spinning, setSpinning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [niftyConnected, setNiftyConnected] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const rangeInitialized = useRef(false);
  const seriesRef = useRef<{
    main: ISeriesApi<"Candlestick">;
    ema1: ISeriesApi<"Line">;
    ema2: ISeriesApi<"Line">;
    markerPlugin: ISeriesMarkersPluginApi<Time>;
    labelPlugin: UTBotLabelsPrimitive;
  } | null>(null);

  // Strategy indicator settings — initialized with defaults, loaded in useEffect to avoid hydration mismatch
  const prefix = isNifty ? "nifty" : "strategy";
  const [ema1Enabled, setEma1Enabled] = useState(true);
  const [ema1Period, setEma1Period] = useState(10);
  const [ema2Enabled, setEma2Enabled] = useState(true);
  const [ema2Period, setEma2Period] = useState(isNifty ? 30 : 20);
  const [utbot1Enabled, setUtbot1Enabled] = useState(isNifty ? true : false);
  const [utbot1Key, setUtbot1Key] = useState(2);
  const [utbot1Atr, setUtbot1Atr] = useState(10);
  const [utbot2Enabled, setUtbot2Enabled] = useState(false);
  const [utbot2Key, setUtbot2Key] = useState(3);
  const [utbot2Atr, setUtbot2Atr] = useState(10);
  const [utbot3Enabled, setUtbot3Enabled] = useState(false);
  const [utbot3Key, setUtbot3Key] = useState(4);
  const [utbot3Atr, setUtbot3Atr] = useState(10);
  const [heikenAshi, setHeikenAshi] = useState(false);
  const [chartTheme, setChartTheme] = useState<"dark" | "light">("dark");
  const [indicatorsOpen, setIndicatorsOpen] = useState(false);

  // Load settings once after hydration
  useEffect(() => {
    setEma1Enabled(lsBool(`${prefix}_ema1_enabled`, true));
    setEma1Period(lsNum(`${prefix}_ema1_period`, 10));
    setEma2Enabled(lsBool(`${prefix}_ema2_enabled`, true));
    setEma2Period(lsNum(`${prefix}_ema2_period`, isNifty ? 30 : 20));
    setUtbot1Enabled(lsBool(`${prefix}_utbot1_enabled`, isNifty ? true : false));
    setUtbot1Key(lsNum(`${prefix}_utbot1_key`, 2));
    setUtbot1Atr(lsNum(`${prefix}_utbot1_atr`, 10));
    setUtbot2Enabled(lsBool(`${prefix}_utbot2_enabled`, false));
    setUtbot2Key(lsNum(`${prefix}_utbot2_key`, 3));
    setUtbot2Atr(lsNum(`${prefix}_utbot2_atr`, 10));
    setUtbot3Enabled(lsBool(`${prefix}_utbot3_enabled`, false));
    setUtbot3Key(lsNum(`${prefix}_utbot3_key`, 4));
    setUtbot3Atr(lsNum(`${prefix}_utbot3_atr`, 10));
    setHeikenAshi(lsBool(`${prefix}_heiken_ashi`, false));
    
    const savedTheme = localStorage.getItem("chart_page_theme");
    if (savedTheme === "light" || savedTheme === "dark") {
      setChartTheme(savedTheme as "dark" | "light");
    }
    
    setIsHydrated(true);
  }, [prefix, isNifty]);

  // Save settings when changed
  useEffect(() => {
    if (!isHydrated) return;
    localStorage.setItem(`${prefix}_ema1_enabled`, String(ema1Enabled));
    localStorage.setItem(`${prefix}_ema1_period`, String(ema1Period));
    localStorage.setItem(`${prefix}_ema2_enabled`, String(ema2Enabled));
    localStorage.setItem(`${prefix}_ema2_period`, String(ema2Period));
    localStorage.setItem(`${prefix}_utbot1_enabled`, String(utbot1Enabled));
    localStorage.setItem(`${prefix}_utbot1_key`, String(utbot1Key));
    localStorage.setItem(`${prefix}_utbot1_atr`, String(utbot1Atr));
    localStorage.setItem(`${prefix}_utbot2_enabled`, String(utbot2Enabled));
    localStorage.setItem(`${prefix}_utbot2_key`, String(utbot2Key));
    localStorage.setItem(`${prefix}_utbot2_atr`, String(utbot2Atr));
    localStorage.setItem(`${prefix}_utbot3_enabled`, String(utbot3Enabled));
    localStorage.setItem(`${prefix}_utbot3_key`, String(utbot3Key));
    localStorage.setItem(`${prefix}_utbot3_atr`, String(utbot3Atr));
    localStorage.setItem(`${prefix}_heiken_ashi`, String(heikenAshi));
    localStorage.setItem("chart_page_theme", chartTheme);
  }, [prefix, ema1Enabled, ema1Period, ema2Enabled, ema2Period, utbot1Enabled, utbot1Key, utbot1Atr, utbot2Enabled, utbot2Key, utbot2Atr, utbot3Enabled, utbot3Key, utbot3Atr, heikenAshi, chartTheme, isHydrated]);

  // Nifty WebSocket
  useEffect(() => {
    if (!isNifty) return;
    let ws: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    function connect() {
      if (disposed) return;
      ws = new WebSocket(NIFTY50_WS_URL);
      ws.onopen = () => { if (!disposed) setNiftyConnected(true); };
      ws.onmessage = (event) => {
        if (disposed) return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "snapshot" || msg.type === "update") {
            const incoming = msg.completedCandles || [];
            setCandles((prev) => {
              // Sticky guard: don't wipe on empty
              if (incoming.length === 0 && prev.length > 0) return prev;
              
              const all = [...incoming];
              if (msg.currentCandle) all.push(msg.currentCandle);
              return all;
            });
            setLoading(false);
            setSpinning(false);
          }
        } catch {}
      };
      ws.onclose = () => {
        if (!disposed) {
          setNiftyConnected(false);
          reconnectTimeout = setTimeout(connect, 3000);
        }
      };
      ws.onerror = () => ws?.close();
    }
    connect();
    return () => {
      disposed = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      ws?.close();
    };
  }, [isNifty]);

  // Fetch candles for strategy symbol — on mount and every 15s for live updates
  useEffect(() => {
    if (!symbol || isNifty) return;
    let cancelled = false;

    const load = () => {
      fetchSymbolCandles()
        .then((data) => {
          if (cancelled) return;
          setCandles(data[symbol] || []);
          setError(null);
        })
        .catch(() => {
          if (!cancelled) setError("Failed to fetch from strategy server");
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
            setSpinning(false);
          }
        });
    };

    load();
    const interval = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [symbol, isNifty]);

  const hasCandles = candles.length > 0;

  // Create chart once container is available
  useEffect(() => {
    if (!containerRef.current || chartRef.current) return;

    const container = containerRef.current;
    const isDark = chartTheme === "dark";
    const upColor = isDark ? "#0ad125" : "#089981";
    const downColor = isDark ? "#ea3434" : "#f23645";

    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { color: isDark ? "rgba(0,0,0,0.9)" : "#ffffff" },
        textColor: isDark ? "#eee" : "#333",
        fontSize: 12,
      },
      grid: {
        vertLines: { color: isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.06)" },
        horzLines: { color: isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.06)" },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)",
      },
      rightPriceScale: {
        borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)",
      },
      crosshair: {
        mode: 0,
      },
    });

    const main = chart.addSeries(CandlestickSeries, {
      upColor,
      downColor,
      borderUpColor: upColor,
      borderDownColor: downColor,
      wickUpColor: upColor,
      wickDownColor: downColor,
    });

    const ema1 = chart.addSeries(LineSeries, { color: "#5488fa", lineWidth: 2 });
    const ema2 = chart.addSeries(LineSeries, { color: "#ffd932", lineWidth: 2 });

    const labelPlugin = new UTBotLabelsPrimitive();
    main.attachPrimitive(labelPlugin);

    chartRef.current = chart;
    seriesRef.current = { main, ema1, ema2, markerPlugin: createSeriesMarkers(main), labelPlugin };

    const observer = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [loading, hasCandles]); // Reverted dependencies to avoid reset on theme change

  // Apply theme changes instantly without chart recreation
  useEffect(() => {
    if (!chartRef.current || !seriesRef.current) return;
    const isDark = chartTheme === "dark";
    
    chartRef.current.applyOptions({
      layout: {
        background: { color: isDark ? "rgba(0,0,0,0.9)" : "#ffffff" },
        textColor: isDark ? "#eee" : "#333",
      },
      grid: {
        vertLines: { color: isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.06)" },
        horzLines: { color: isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.06)" },
      },
      timeScale: {
        borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)",
      },
      rightPriceScale: {
        borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)",
      },
    });

    // Professional candle colors
    const upColor = isDark ? "#0ad125" : "#089981";
    const downColor = isDark ? "#ea3434" : "#f23645";
    
    seriesRef.current.main.applyOptions({
      upColor,
      downColor,
      borderUpColor: upColor,
      borderDownColor: downColor,
      wickUpColor: upColor,
      wickDownColor: downColor,
    });
  }, [chartTheme, loading, hasCandles]);


  // Update chart data when candles or settings change
  useEffect(() => {
    const s = seriesRef.current;
    if (!s || candles.length === 0) return;

    // Filter invalid times, deduplicate, sort ascending
    const mapped = candles
      .filter((c) => c != null)
      .map((c) => ({
        time: toChartTime(c.time),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
      .filter((c) => c.time > 0);

    const deduped = new Map<number, (typeof mapped)[0]>();
    for (const c of mapped) deduped.set(c.time as number, c);
    const validCandles = Array.from(deduped.values()).sort(
      (a, b) => (a.time as number) - (b.time as number)
    );

    if (validCandles.length === 0) return;

    const displayCandles = heikenAshi ? toHeikenAshi(validCandles) : validCandles;
    s.main.setData(displayCandles);

    // Show only the last ~2 hours on first load; after that, never reset the user's zoom
    if (!rangeInitialized.current && chartRef.current) {
      const lastTime = displayCandles[displayCandles.length - 1].time as number;
      chartRef.current.timeScale().setVisibleRange({
        from: (lastTime - 2 * 60 * 60) as Time,
        to: lastTime as Time,
      });
      rangeInitialized.current = true;
    }

    // EMA lines on displayed candles
    const closePrices = displayCandles.map((c) => c.close);
    const ema1Values = ema1Enabled ? calculateEMA(closePrices, ema1Period) : [];
    const ema2Values = ema2Enabled ? calculateEMA(closePrices, ema2Period) : [];

    s.ema1.setData(
      ema1Values.map((val, idx) => ({
        time: displayCandles[idx + (closePrices.length - ema1Values.length)].time,
        value: val,
      }))
    );
    s.ema2.setData(
      ema2Values.map((val, idx) => ({
        time: displayCandles[idx + (closePrices.length - ema2Values.length)].time,
        value: val,
      }))
    );

    // Backend BUY/SELL arrows
    const markers: SeriesMarker<Time>[] = candles
      .filter((c) => c.signal === "BUY" || c.signal === "SELL" || c.signal === "BOOMBUY")
      .map((c) => ({
        time: toChartTime(c.time) as Time,
        position: (c.signal === "BUY" || c.signal === "BOOMBUY") ? ("belowBar" as const) : ("aboveBar" as const),
        color: c.signal === "BOOMBUY" ? "goldenrod" : (c.signal === "BUY" ? "#90ee90" : "#d12b2b"),
        shape: (c.signal === "BUY" || c.signal === "BOOMBUY") ? ("arrowUp" as const) : ("arrowDown" as const),
        text: "",
      }));
    s.markerPlugin.setMarkers(markers);

    // UTBot labels on displayed candles
    const utbotLabels: UTBotLabel[] = [];
    if (utbot1Enabled) {
      calculateUTBot(displayCandles, utbot1Key, utbot1Atr).forEach((sig) =>
        utbotLabels.push({ time: sig.time, type: sig.type, color: sig.type === "BUY" ? "#a855f7" : "#fbbf24" })
      );
    }
    if (utbot2Enabled) {
      calculateUTBot(displayCandles, utbot2Key, utbot2Atr).forEach((sig) =>
        utbotLabels.push({ time: sig.time, type: sig.type, color: sig.type === "BUY" ? "#06b6d4" : "#f472b6" })
      );
    }
    if (utbot3Enabled) {
      calculateUTBot(displayCandles, utbot3Key, utbot3Atr).forEach((sig) =>
        utbotLabels.push({ time: sig.time, type: sig.type, color: sig.type === "BUY" ? "#16a34a" : "#dc2626" })
      );
    }
    s.labelPlugin.setData(
      displayCandles.map((c) => ({ time: c.time as number, high: c.high, low: c.low })),
      utbotLabels
    );
  }, [candles, heikenAshi,
      ema1Enabled, ema1Period, ema2Enabled, ema2Period,
      utbot1Enabled, utbot1Key, utbot1Atr,
      utbot2Enabled, utbot2Key, utbot2Atr,
      utbot3Enabled, utbot3Key, utbot3Atr]);

  const handleRefresh = () => {
    setSpinning(true);
    fetchSymbolCandles()
      .then((data) => {
        setCandles(data[symbol] || []);
        setError(null);
      })
      .catch(() => setError("Failed to fetch from strategy server"))
      .finally(() => setSpinning(false));
  };

  const toggleBtn = (on: boolean) => ({
    width: 32,
    height: 18,
    borderRadius: 9,
    background: on ? "#5488fa" : "#444",
    position: "relative" as const,
    border: "none",
    cursor: "pointer",
    flexShrink: 0,
  });
  const toggleKnob = (on: boolean) => ({
    position: "absolute" as const,
    top: 2,
    left: on ? 16 : 2,
    width: 14,
    height: 14,
    borderRadius: "50%",
    background: "#fff",
    transition: "left 0.2s",
  });
  const inputStyle = {
    background: "#1a1a1a",
    color: "#eee",
    border: "1px solid #333",
  };

  if (!symbol) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#111", color: "#eee" }}>
        No symbol specified
      </div>
    );
  }

  if (!isHydrated) return null;

  return (
    <div className="flex flex-col w-full overflow-hidden" style={{ height: "100vh", background: chartTheme === "dark" ? "#111" : "#f4f4f4" }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2 shrink-0"
        style={{ borderBottom: "1px solid #222", background: "#161616" }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm font-bold truncate" style={{ color: isNifty ? "#0a8a43" : "#5488fa" }}>{isNifty ? "NIFTY 50" : symbol}</span>
          {isNifty && (
            <span
              className="inline-block w-2 h-2 rounded-full shrink-0"
              style={{ background: niftyConnected ? "#0a8a43" : "#dc2626" }}
              title={niftyConnected ? "Connected" : "Disconnected"}
            />
          )}
          {candles.length > 0 && (
            <span className="text-xs" style={{ color: "#888" }}>
              {isNifty && `LTP: ${candles[candles.length - 1].close} | `}{candles.length} candles
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setChartTheme(chartTheme === "dark" ? "light" : "dark")}
            className="text-xs px-2 py-1 rounded transition hover:opacity-80 flex items-center gap-1.5"
            style={{ background: "#222", border: "1px solid #333", color: "#ccc" }}
          >
            {chartTheme === "dark" ? "Light Mode" : "Dark Mode"}
          </button>
          {!isNifty && (
            <button
              onClick={handleRefresh}
              className="p-1.5 rounded transition hover:opacity-80"
              style={{ background: "#5488fa", color: "#fff" }}
              title="Refresh chart"
              disabled={spinning}
            >
              <RefreshCw size={14} className={spinning ? "animate-spin" : ""} />
            </button>
          )}
          <button
            onClick={() => setIndicatorsOpen(!indicatorsOpen)}
            className="text-xs px-2 py-1 rounded"
            style={{ background: "#222", border: "1px solid #333", color: "#ccc" }}
          >
            Indicators
          </button>
        </div>
      </div>

      {/* Indicators bar */}
      {indicatorsOpen && (
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 shrink-0 text-xs"
          style={{ borderBottom: "1px solid #222", background: "#141414" }}
        >
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={ema1Enabled} onChange={(e) => setEma1Enabled(e.target.checked)} className="h-3.5 w-3.5 accent-blue-500" />
            <span style={{ color: "#eee" }}>EMA 1</span>
            <input
              type="text" inputMode="numeric" value={ema1Period}
              onChange={(e) => { const v = e.target.value.replace(/\D/g, ""); setEma1Period(v === "" ? 0 : Number(v)); }}
              className="w-10 h-6 rounded text-center" style={{ ...inputStyle, background: "#1a1a1a", border: "1px solid #333", color: "#eee" }}
            />
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={ema2Enabled} onChange={(e) => setEma2Enabled(e.target.checked)} className="h-3.5 w-3.5 accent-yellow-500" />
            <span style={{ color: "#eee" }}>EMA 2</span>
            <input
              type="text" inputMode="numeric" value={ema2Period}
              onChange={(e) => { const v = e.target.value.replace(/\D/g, ""); setEma2Period(v === "" ? 0 : Number(v)); }}
              className="w-10 h-6 rounded text-center" style={{ ...inputStyle, background: "#1a1a1a", border: "1px solid #333", color: "#eee" }}
            />
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={utbot1Enabled} onChange={(e) => setUtbot1Enabled(e.target.checked)} className="h-3.5 w-3.5 accent-purple-500" />
            <span style={{ color: "#eee" }}>UTBOT 1</span>
            <input type="text" inputMode="numeric" value={utbot1Key} onChange={(e) => { const v = e.target.value.replace(/\D/g, ""); setUtbot1Key(v === "" ? 0 : Number(v)); }} className="w-8 h-6 rounded text-center" style={{ ...inputStyle, background: "#1a1a1a", border: "1px solid #333", color: "#eee" }} />
            <input type="text" inputMode="numeric" value={utbot1Atr} onChange={(e) => { const v = e.target.value.replace(/\D/g, ""); setUtbot1Atr(v === "" ? 0 : Number(v)); }} className="w-8 h-6 rounded text-center" style={{ ...inputStyle, background: "#1a1a1a", border: "1px solid #333", color: "#eee" }} />
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={utbot2Enabled} onChange={(e) => setUtbot2Enabled(e.target.checked)} className="h-3.5 w-3.5 accent-cyan-500" />
            <span style={{ color: "#eee" }}>UTBOT 2</span>
            <input type="text" inputMode="numeric" value={utbot2Key} onChange={(e) => { const v = e.target.value.replace(/\D/g, ""); setUtbot2Key(v === "" ? 0 : Number(v)); }} className="w-8 h-6 rounded text-center" style={{ ...inputStyle, background: "#1a1a1a", border: "1px solid #333", color: "#eee" }} />
            <input type="text" inputMode="numeric" value={utbot2Atr} onChange={(e) => { const v = e.target.value.replace(/\D/g, ""); setUtbot2Atr(v === "" ? 0 : Number(v)); }} className="w-8 h-6 rounded text-center" style={{ ...inputStyle, background: "#1a1a1a", border: "1px solid #333", color: "#eee" }} />
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={utbot3Enabled} onChange={(e) => setUtbot3Enabled(e.target.checked)} className="h-3.5 w-3.5 accent-green-500" />
            <span style={{ color: "#eee" }}>UTBOT 3</span>
            <input type="text" inputMode="numeric" value={utbot3Key} onChange={(e) => { const v = e.target.value.replace(/\D/g, ""); setUtbot3Key(v === "" ? 0 : Number(v)); }} className="w-8 h-6 rounded text-center" style={{ ...inputStyle, background: "#1a1a1a", border: "1px solid #333", color: "#eee" }} />
            <input type="text" inputMode="numeric" value={utbot3Atr} onChange={(e) => { const v = e.target.value.replace(/\D/g, ""); setUtbot3Atr(v === "" ? 0 : Number(v)); }} className="w-8 h-6 rounded text-center" style={{ ...inputStyle, background: "#1a1a1a", border: "1px solid #333", color: "#eee" }} />
          </label>
          <div className="flex items-center gap-1.5 ml-auto">
            <span className="text-[10px] font-bold" style={{ color: "#888" }}>HEIKEN ASHI</span>
            <button type="button" onClick={() => setHeikenAshi(!heikenAshi)} style={toggleBtn(heikenAshi)}>
              <span style={toggleKnob(heikenAshi)} />
            </button>
          </div>
        </div>
      )}

      {/* Chart area */}
      <div className="flex-1 min-h-0 relative overflow-hidden">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center gap-2">
            <Loader2 size={20} className="animate-spin" style={{ color: "#5488fa" }} />
            <span className="text-sm" style={{ color: "#888" }}>Loading chart...</span>
          </div>
        ) : error ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-sm" style={{ color: "#d12b2b" }}>{error}</span>
          </div>
        ) : candles.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-sm" style={{ color: "#888" }}>No chart data for {symbol}</span>
          </div>
        ) : null}
        <div ref={containerRef} className="absolute inset-0" />
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <StrategyChartPage />
    </Suspense>
  );
}
