"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { X, BarChart2, RefreshCw, Loader2 } from "lucide-react";
import { createChart, CandlestickSeries, IChartApi, SeriesMarker, Time, createSeriesMarkers, LineSeries, ISeriesApi, ISeriesMarkersPluginApi } from "lightweight-charts";
import { useTradeStore } from "../store/TradeStore";
import {
  fetchSymbolCandles,
  CandleData,
  SymbolCandles,
  calculateEMA,
  toHeikenAshi,
  calculateUTBot,
  UTBotLabel,
  UTBotLabelsPrimitive,
  toChartTime,
  isWithinMarketHours,
} from "@/lib/strategy-chart";

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

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:2000";
const NIFTY50_WS_URL = process.env.NEXT_PUBLIC_NIFTY50_WS_URL || API_BASE_URL.replace(/^http/, "ws") + "/ws/nifty50";
const NIFTY50_REST_URL = process.env.NEXT_PUBLIC_NIFTY50_REST_URL ||
  NIFTY50_WS_URL.replace(/^ws/, "http").replace(/\/ws\/nifty50$/, "/nifty50-candles");

type Props = {
  open: boolean;
  onClose: () => void;
};

// Candle palettes — bound (index-signal) symbols render cyan/pink so the
// FAKE stream is visually distinct from real option candles.
const REAL_CANDLE_COLORS = {
  upColor: "#0ad125",
  downColor: "#ea3434",
  borderUpColor: "#0ad125",
  borderDownColor: "#ea3434",
  wickUpColor: "#0ad125",
  wickDownColor: "#ea3434",
};
const FAKE_CANDLE_COLORS = {
  upColor: "#22d3ee",
  downColor: "#ec4899",
  borderUpColor: "#22d3ee",
  borderDownColor: "#ec4899",
  wickUpColor: "#22d3ee",
  wickDownColor: "#ec4899",
};

type Nifty50CandleData = {
  completedCandles: CandleData[];
  currentCandle: CandleData | null;
};

export default function ChartPopup({ open, onClose }: Props) {
  const { activeTrades, waitingTrades, niftySignalBindings } = useTradeStore();
  const [symbolCandles, setSymbolCandles] = useState<SymbolCandles>({});
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const chartRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const chartInstances = useRef<Record<string, IChartApi>>({});
  const seriesInstances = useRef<Record<string, { main: ISeriesApi<"Candlestick">; ema1: ISeriesApi<"Line">; ema2: ISeriesApi<"Line">; markerPlugin: ISeriesMarkersPluginApi<Time>; labelPlugin: UTBotLabelsPrimitive }>>({});

  // Nifty50 live chart state
  const [nifty50Data, setNifty50Data] = useState<Nifty50CandleData>({ completedCandles: [], currentCandle: null });
  const [nifty50Connected, setNifty50Connected] = useState(false);
  const nifty50ChartRef = useRef<HTMLDivElement | null>(null);
  const nifty50ChartInstance = useRef<IChartApi | null>(null);
  const nifty50SeriesInstance = useRef<{ main: ISeriesApi<"Candlestick">; ema1: ISeriesApi<"Line">; ema2: ISeriesApi<"Line">; labelPlugin: UTBotLabelsPrimitive } | null>(null);

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

  // Strategy chart mode (Normal / Heiken Ashi)
  const [heikenAshi, setHeikenAshi] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("strategy_heiken_ashi") === "true";
    }
    return false;
  });

  // NIFTY live chart mode (Normal / Heiken Ashi)
  const [niftyHeikenAshi, setNiftyHeikenAshi] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("nifty_heiken_ashi") === "true";
    }
    return false;
  });

  // Strategy chart indicator settings (separate from NIFTY)
  const [strategyIndicatorsOpen, setStrategyIndicatorsOpen] = useState(false);
  const [sEma1Enabled, setSEma1Enabled] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("strategy_ema1_enabled");
      return saved !== null ? saved === "true" : true;
    }
    return true;
  });
  const [sEma1Period, setSEma1Period] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("strategy_ema1_period");
      return saved !== null ? parseInt(saved, 10) : 10;
    }
    return 10;
  });
  const [sEma2Enabled, setSEma2Enabled] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("strategy_ema2_enabled");
      return saved !== null ? saved === "true" : true;
    }
    return true;
  });
  const [sEma2Period, setSEma2Period] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("strategy_ema2_period");
      return saved !== null ? parseInt(saved, 10) : 20;
    }
    return 20;
  });
  const [sUtbot1Enabled, setSUtbot1Enabled] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("strategy_utbot1_enabled");
      return saved !== null ? saved === "true" : false;
    }
    return false;
  });
  const [sUtbot1Key, setSUtbot1Key] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("strategy_utbot1_key");
      return saved !== null ? parseFloat(saved) : 2;
    }
    return 2;
  });
  const [sUtbot1Atr, setSUtbot1Atr] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("strategy_utbot1_atr");
      return saved !== null ? parseInt(saved, 10) : 10;
    }
    return 10;
  });
  const [sUtbot2Enabled, setSUtbot2Enabled] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("strategy_utbot2_enabled");
      return saved !== null ? saved === "true" : false;
    }
    return false;
  });
  const [sUtbot2Key, setSUtbot2Key] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("strategy_utbot2_key");
      return saved !== null ? parseFloat(saved) : 3;
    }
    return 3;
  });
  const [sUtbot2Atr, setSUtbot2Atr] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("strategy_utbot2_atr");
      return saved !== null ? parseInt(saved, 10) : 10;
    }
    return 10;
  });
  const [sUtbot3Enabled, setSUtbot3Enabled] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("strategy_utbot3_enabled");
      return saved !== null ? saved === "true" : false;
    }
    return false;
  });
  const [sUtbot3Key, setSUtbot3Key] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("strategy_utbot3_key");
      return saved !== null ? parseFloat(saved) : 4;
    }
    return 4;
  });
  const [sUtbot3Atr, setSUtbot3Atr] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("strategy_utbot3_atr");
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

    localStorage.setItem("strategy_heiken_ashi", String(heikenAshi));
    localStorage.setItem("nifty_heiken_ashi", String(niftyHeikenAshi));

    localStorage.setItem("strategy_ema1_enabled", String(sEma1Enabled));
    localStorage.setItem("strategy_ema1_period", String(sEma1Period));
    localStorage.setItem("strategy_ema2_enabled", String(sEma2Enabled));
    localStorage.setItem("strategy_ema2_period", String(sEma2Period));

    localStorage.setItem("strategy_utbot1_enabled", String(sUtbot1Enabled));
    localStorage.setItem("strategy_utbot1_key", String(sUtbot1Key));
    localStorage.setItem("strategy_utbot1_atr", String(sUtbot1Atr));

    localStorage.setItem("strategy_utbot2_enabled", String(sUtbot2Enabled));
    localStorage.setItem("strategy_utbot2_key", String(sUtbot2Key));
    localStorage.setItem("strategy_utbot2_atr", String(sUtbot2Atr));

    localStorage.setItem("strategy_utbot3_enabled", String(sUtbot3Enabled));
    localStorage.setItem("strategy_utbot3_key", String(sUtbot3Key));
    localStorage.setItem("strategy_utbot3_atr", String(sUtbot3Atr));
  }, [
    ema1Enabled, ema1Period, ema2Enabled, ema2Period,
    utbot1Enabled, utbot1Key, utbot1Atr,
    utbot2Enabled, utbot2Key, utbot2Atr,
    utbot3Enabled, utbot3Key, utbot3Atr,
    heikenAshi, niftyHeikenAshi,
    sEma1Enabled, sEma1Period, sEma2Enabled, sEma2Period,
    sUtbot1Enabled, sUtbot1Key, sUtbot1Atr,
    sUtbot2Enabled, sUtbot2Key, sUtbot2Atr,
    sUtbot3Enabled, sUtbot3Key, sUtbot3Atr
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

    // Load full session history first (Zerodha-style): REST snapshot, then WS patches
    fetch(NIFTY50_REST_URL)
      .then((r) => r.json())
      .then((data) => {
        if (disposed) return;
        const completed = (data.completedCandles || []).filter((c: any) => isWithinMarketHours(c.time));
        const current = data.currentCandle && isWithinMarketHours(data.currentCandle.time) ? data.currentCandle : null;
        if (completed.length > 0 || current) {
          setNifty50Data({ completedCandles: completed, currentCandle: current });
        }
      })
      .catch(() => {});

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
            const incomingCompleted = (msg.completedCandles || []).filter((c: any) => isWithinMarketHours(c.time));
            const incomingCurrent = msg.currentCandle && isWithinMarketHours(msg.currentCandle.time) ? msg.currentCandle : null;

            setNifty50Data((prev) => {
              // Sticky guard: if incoming data is filtered out entirely but we have data, keep the old data
              if (incomingCompleted.length === 0 && !incomingCurrent && prev.completedCandles.length > 0) {
                return prev;
              }
              // Merge by candle time — WS updates only patch/append, never clobber history
              const map = new Map<number, CandleData>();
              for (const c of prev.completedCandles) map.set(toChartTime(c.time) as number, c);
              for (const c of incomingCompleted) map.set(toChartTime(c.time) as number, c);
              const merged = Array.from(map.values())
                .sort((a, b) => (toChartTime(a.time) as number) - (toChartTime(b.time) as number));
              return {
                completedCandles: merged.slice(-700),
                currentCandle: incomingCurrent,
              };
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

    const allCandles = [...(nifty50Data.completedCandles || [])].filter((c) => c != null);
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

      const labelPlugin = new UTBotLabelsPrimitive();
      series.attachPrimitive(labelPlugin);

      nifty50ChartInstance.current = chart;
      nifty50SeriesInstance.current = { main: series, ema1, ema2, labelPlugin };
    }

    const { main, ema1, ema2, labelPlugin } = nifty50SeriesInstance.current!;

    const mapped = allCandles
      .filter((c) => c != null)
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
      const displayCandles = niftyHeikenAshi ? toHeikenAshi(validCandles) : validCandles;
      main.setData(displayCandles);

      // EMA overlays (computed on displayed candles — HA closes in Heiken Ashi mode)
      const closePrices = displayCandles.map(c => c.close);
      
      if (ema1Enabled) {
        const ema1Values = calculateEMA(closePrices, ema1Period);
        if (ema1Values.length > 0) {
          ema1.setData(ema1Values.map((val, idx) => ({
            time: displayCandles[idx + (closePrices.length - ema1Values.length)].time,
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
            time: displayCandles[idx + (closePrices.length - ema2Values.length)].time,
            value: val,
          })));
        } else {
          ema2.setData([]);
        }
      } else {
        ema2.setData([]);
      }

      // UTBot labels — TradingView-style (computed on HA candles in Heiken Ashi mode)
      const utbotCandles = niftyHeikenAshi ? toHeikenAshi(allCandles) : allCandles;
      const utbotLabels: UTBotLabel[] = [];

      if (utbot1Enabled) {
        calculateUTBot(utbotCandles, utbot1Key, utbot1Atr).forEach(s =>
          utbotLabels.push({ time: s.time, type: s.type, color: s.type === "BUY" ? "#a855f7" : "#fbbf24" })
        );
      }
      if (utbot2Enabled) {
        calculateUTBot(utbotCandles, utbot2Key, utbot2Atr).forEach(s =>
          utbotLabels.push({ time: s.time, type: s.type, color: s.type === "BUY" ? "#06b6d4" : "#f472b6" })
        );
      }
      if (utbot3Enabled) {
        calculateUTBot(utbotCandles, utbot3Key, utbot3Atr).forEach(s =>
          utbotLabels.push({ time: s.time, type: s.type, color: s.type === "BUY" ? "#16a34a" : "#dc2626" })
        );
      }

      labelPlugin.setData(
        displayCandles.map((c) => ({ time: c.time as number, high: c.high, low: c.low })),
        utbotLabels
      );
    }

    return () => {
      // We don't remove chart on every update anymore
    };
  }, [nifty50Data, ema1Enabled, ema1Period, ema2Enabled, ema2Period, 
      utbot1Enabled, utbot1Key, utbot1Atr, 
      utbot2Enabled, utbot2Key, utbot2Atr, 
      utbot3Enabled, utbot3Key, utbot3Atr, niftyHeikenAshi]);

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
      fetchSymbolCandles()
        .then((result) => {
          // Filter out candles outside market hours for each symbol
          const filteredResult: SymbolCandles = {};
          for (const sym of Object.keys(result)) {
            filteredResult[sym] = (result[sym] || []).filter(c => isWithinMarketHours(c.time));
          }
          // Bound symbols chart the candles the strategy actually evaluates
          for (const [sym, src] of Object.entries(niftySignalBindings)) {
            if (filteredResult[src]?.length) filteredResult[sym] = filteredResult[src];
          }
          setSymbolCandles(filteredResult);
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
    const interval = setInterval(fetchCandles, 60000); // 1 minute auto-refresh

    return () => {
      clearTimeout(kickoff);
      clearInterval(interval);
    };
  }, [open, refreshKey, niftySignalBindings]);

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

        const main = chart.addSeries(CandlestickSeries,
          niftySignalBindings[symbol] ? FAKE_CANDLE_COLORS : REAL_CANDLE_COLORS);

        const ema1 = chart.addSeries(LineSeries, { color: "#5488fa", lineWidth: 1 });
        const ema2 = chart.addSeries(LineSeries, { color: "#ffd932", lineWidth: 1 });

        const labelPlugin = new UTBotLabelsPrimitive();
        main.attachPrimitive(labelPlugin);

        chartInstances.current[symbol] = chart;
        seriesInstances.current[symbol] = { main, ema1, ema2, markerPlugin: createSeriesMarkers(main), labelPlugin };
      }

      const { main, ema1, ema2, markerPlugin, labelPlugin } = seriesInstances.current[symbol];
      main.applyOptions(niftySignalBindings[symbol] ? FAKE_CANDLE_COLORS : REAL_CANDLE_COLORS);

      // Filter invalid times, deduplicate, and sort ascending
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

      // Deduplicate by time (keep last occurrence)
      const deduped = new Map<number, typeof mapped[0]>();
      for (const c of mapped) deduped.set(c.time as number, c);
      const validCandles = Array.from(deduped.values())
        .sort((a, b) => (a.time as number) - (b.time as number));

      if (validCandles.length > 0) {
        const displayCandles = heikenAshi ? toHeikenAshi(validCandles) : validCandles;
        main.setData(displayCandles);

        // EMA lines (computed on displayed candles — HA closes in Heiken Ashi mode)
        const closePrices = displayCandles.map(c => c.close);
        const ema1Values = sEma1Enabled ? calculateEMA(closePrices, sEma1Period) : [];
        const ema2Values = sEma2Enabled ? calculateEMA(closePrices, sEma2Period) : [];

        ema1.setData(ema1Values.map((val, idx) => ({
          time: displayCandles[idx + (closePrices.length - ema1Values.length)].time,
          value: val,
        })));
        ema2.setData(ema2Values.map((val, idx) => ({
          time: displayCandles[idx + (closePrices.length - ema2Values.length)].time,
          value: val,
        })));

        // Add BUY/SELL markers
        const markers: SeriesMarker<Time>[] = candles
          .filter((c) => c.signal === "BUY" || c.signal === "SELL" || c.signal === "BOOMBUY")
          .map((c) => ({
            time: toChartTime(c.time) as Time,
            position: (c.signal === "BUY" || c.signal === "BOOMBUY") ? "belowBar" as const : "aboveBar" as const,
            color: c.signal === "BOOMBUY" ? "goldenrod" : (c.signal === "BUY" ? "#90ee90" : "#d12b2b"),
            shape: (c.signal === "BUY" || c.signal === "BOOMBUY") ? "arrowUp" as const : "arrowDown" as const,
            text: "",
          }));

        markerPlugin.setMarkers(markers);

        // UTBot labels — TradingView-style (computed on the displayed candles — HA in Heiken Ashi mode)
        const utbotLabels: UTBotLabel[] = [];

        if (sUtbot1Enabled) {
          calculateUTBot(displayCandles, sUtbot1Key, sUtbot1Atr).forEach(s =>
            utbotLabels.push({ time: s.time, type: s.type, color: s.type === "BUY" ? "#a855f7" : "#fbbf24" })
          );
        }
        if (sUtbot2Enabled) {
          calculateUTBot(displayCandles, sUtbot2Key, sUtbot2Atr).forEach(s =>
            utbotLabels.push({ time: s.time, type: s.type, color: s.type === "BUY" ? "#06b6d4" : "#f472b6" })
          );
        }
        if (sUtbot3Enabled) {
          calculateUTBot(displayCandles, sUtbot3Key, sUtbot3Atr).forEach(s =>
            utbotLabels.push({ time: s.time, type: s.type, color: s.type === "BUY" ? "#16a34a" : "#dc2626" })
          );
        }

        labelPlugin.setData(
          displayCandles.map((c) => ({ time: c.time as number, high: c.high, low: c.low })),
          utbotLabels
        );
      }
    });
  }, [symbolCandles, activeSymbols, heikenAshi, niftySignalBindings,
      sEma1Enabled, sEma1Period, sEma2Enabled, sEma2Period,
      sUtbot1Enabled, sUtbot1Key, sUtbot1Atr,
      sUtbot2Enabled, sUtbot2Key, sUtbot2Atr,
      sUtbot3Enabled, sUtbot3Key, sUtbot3Atr]);

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
            <span
              className="text-xs font-semibold cursor-pointer hover:underline"
              style={{ color: "var(--theme-popup-border)" }}
              title="Open full Nifty chart in new tab"
              onClick={() => window.open(`/chart?symbol=NIFTY50`, "_blank")}
            >
              NIFTY 50
            </span>
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

              {/* Heiken Ashi (NIFTY live chart) */}
              <div className="flex items-center justify-between pt-2" style={{ borderTop: "1px solid rgba(0,0,0,0.05)" }}>
                <span className="text-xs font-medium" style={{ color: "var(--theme-popup-text)" }}>HEIKEN ASHI</span>
                <button
                  type="button"
                  onClick={() => setNiftyHeikenAshi(!niftyHeikenAshi)}
                  style={{
                    width: 32,
                    height: 18,
                    borderRadius: 9,
                    background: niftyHeikenAshi ? "var(--theme-toggle-on, var(--theme-popup-border))" : "var(--theme-toggle-off, var(--theme-popup-field-border))",
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
                      left: niftyHeikenAshi ? 16 : 2,
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      background: "#fff",
                      transition: "left 0.2s",
                    }}
                  />
                </button>
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
                        <span
                          className="cursor-pointer hover:underline"
                          title="Open full chart in new tab"
                          onClick={() => window.open(`/chart?symbol=${encodeURIComponent(symbol)}`, "_blank")}
                        >
                          {symbol}
                        </span>
                        {hasData && (
                          <span className="ml-2 font-normal" style={{ color: "var(--theme-popup-label)" }}>
                            ({symbolCandles[symbol]?.length || 0} candles{niftySignalBindings[symbol] ? ` · ${niftySignalBindings[symbol]}` : ""})
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

            {/* Strategy Indicators Panel */}
            <div className="mt-3">
              <div
                className="flex items-center justify-between cursor-pointer py-2 px-3 rounded-lg hover:bg-black/5 transition"
                onClick={() => setStrategyIndicatorsOpen(!strategyIndicatorsOpen)}
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
                    background: strategyIndicatorsOpen ? "var(--theme-toggle-on, var(--theme-popup-border))" : "var(--theme-toggle-off, var(--theme-popup-field-border))",
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
                      left: strategyIndicatorsOpen ? 16 : 2,
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      background: "#fff",
                      transition: "left 0.2s",
                    }}
                  />
                </button>
              </div>

              {strategyIndicatorsOpen && (
                <div className="mt-2 p-3 rounded-lg space-y-3" style={{ background: "rgba(0,0,0,0.02)", border: "1px solid var(--theme-popup-field-border)" }}>
                  {/* EMA 1 */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={sEma1Enabled}
                        onChange={(e) => setSEma1Enabled(e.target.checked)}
                        className="h-3.5 w-3.5 accent-blue-600"
                      />
                      <span className="text-xs font-medium" style={{ color: "var(--theme-popup-text)" }}>EMA 1</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <NumericField
                        value={sEma1Period}
                        onChange={setSEma1Period}
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
                        checked={sEma2Enabled}
                        onChange={(e) => setSEma2Enabled(e.target.checked)}
                        className="h-3.5 w-3.5 accent-orange-600"
                      />
                      <span className="text-xs font-medium" style={{ color: "var(--theme-popup-text)" }}>EMA 2</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <NumericField
                        value={sEma2Period}
                        onChange={setSEma2Period}
                        className="w-12 h-7 rounded text-center text-xs font-bold"
                        style={{
                          background: "var(--theme-popup-field-bg)",
                          color: "var(--theme-popup-text)",
                          border: "1px solid var(--theme-popup-field-border)",
                        }}
                        fallback="20"
                      />
                    </div>
                  </div>

                  {/* UTBot 1 */}
                  <div className="flex items-center justify-between pt-2" style={{ borderTop: "1px solid rgba(0,0,0,0.05)" }}>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={sUtbot1Enabled}
                        onChange={(e) => setSUtbot1Enabled(e.target.checked)}
                        className="h-3.5 w-3.5 accent-purple-600"
                      />
                      <span className="text-xs font-medium" style={{ color: "var(--theme-popup-text)" }}>UTBOT 1</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] font-bold opacity-50">KEY</span>
                        <NumericField
                          value={sUtbot1Key}
                          onChange={setSUtbot1Key}
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
                          value={sUtbot1Atr}
                          onChange={setSUtbot1Atr}
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
                        checked={sUtbot2Enabled}
                        onChange={(e) => setSUtbot2Enabled(e.target.checked)}
                        className="h-3.5 w-3.5 accent-cyan-600"
                      />
                      <span className="text-xs font-medium" style={{ color: "var(--theme-popup-text)" }}>UTBOT 2</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] font-bold opacity-50">KEY</span>
                        <NumericField
                          value={sUtbot2Key}
                          onChange={setSUtbot2Key}
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
                          value={sUtbot2Atr}
                          onChange={setSUtbot2Atr}
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
                        checked={sUtbot3Enabled}
                        onChange={(e) => setSUtbot3Enabled(e.target.checked)}
                        className="h-3.5 w-3.5 accent-green-600"
                      />
                      <span className="text-xs font-medium" style={{ color: "var(--theme-popup-text)" }}>UTBOT 3</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] font-bold opacity-50">KEY</span>
                        <NumericField
                          value={sUtbot3Key}
                          onChange={setSUtbot3Key}
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
                          value={sUtbot3Atr}
                          onChange={setSUtbot3Atr}
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

                  {/* Heiken Ashi (strategy charts) */}
                  <div className="flex items-center justify-between pt-2" style={{ borderTop: "1px solid rgba(0,0,0,0.05)" }}>
                    <span className="text-xs font-medium" style={{ color: "var(--theme-popup-text)" }}>HEIKEN ASHI</span>
                    <button
                      type="button"
                      onClick={() => setHeikenAshi(!heikenAshi)}
                      style={{
                        width: 32,
                        height: 18,
                        borderRadius: 9,
                        background: heikenAshi ? "var(--theme-toggle-on, var(--theme-popup-border))" : "var(--theme-toggle-off, var(--theme-popup-field-border))",
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
                          left: heikenAshi ? 16 : 2,
                          width: 14,
                          height: 14,
                          borderRadius: "50%",
                          background: "#fff",
                          transition: "left 0.2s",
                        }}
                      />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
        </div>
      </div>
    </div>
  );
}
