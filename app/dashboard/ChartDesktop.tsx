"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { RefreshCw, Loader2, BarChart2, ChevronDown } from "lucide-react";
import { createChart, CandlestickSeries, IChartApi, SeriesMarker, Time, createSeriesMarkers, LineSeries, ISeriesApi, ISeriesMarkersPluginApi } from "lightweight-charts";
import { useTradeStore } from "../store/TradeStore";
import {
  fetchSymbolCandles,
  CandleData,
  SymbolCandles,
  calculateEMA,
  shortMaSeries,
  SHORT_MA_TYPES,
  ShortMaType,
  toHeikenAshi,
  calculateUTBot,
  calculateSuperTrend,
  SuperTrendPrimitive,
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

// Dropdown wrapper for indicator controls — groups checkboxes/inputs behind a
// single toolbar button. enabledCount shows e.g. "UTBOT (2)". Closes on
// outside mousedown.
function IndicatorMenu({ label, enabledCount, children }: { label: string; enabledCount: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 px-2.5 h-6 rounded text-[10px] font-bold"
        style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }}
      >
        {label} ({enabledCount})
        <ChevronDown size={11} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>
      {open && (
        <div
          className="absolute left-0 top-full mt-1 z-50 rounded-md p-2 flex flex-col gap-2"
          style={{ background: "var(--theme-popup-bg, #1e1e2e)", border: "1px solid var(--theme-popup-field-border)", boxShadow: "0 4px 14px rgba(0,0,0,0.35)", minWidth: 185 }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:2000";
const NIFTY50_WS_URL = process.env.NEXT_PUBLIC_NIFTY50_WS_URL || API_BASE_URL.replace(/^http/, "ws") + "/ws/nifty50";
const NIFTY50_REST_URL = process.env.NEXT_PUBLIC_NIFTY50_REST_URL ||
  NIFTY50_WS_URL.replace(/^ws/, "http").replace(/\/ws\/nifty50$/, "/nifty50-candles");

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

// Ctrl+wheel / right-drag+wheel zoom helper — plain wheel scrolls the page
// (chart wheel handlers are disabled via handleScroll/handleScale).
// e.buttons bit 1 (value 2) = right button held during the wheel event.
function attachCtrlWheelZoom(chart: IChartApi, container: HTMLDivElement) {
  let rightDragged = false;
  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey && !(e.buttons & 2)) return;
    e.preventDefault();
    if (e.buttons & 2) rightDragged = true;
    const ts = chart.timeScale();
    const spacing = ts.options().barSpacing;
    ts.applyOptions({ barSpacing: Math.min(100, Math.max(1, e.deltaY < 0 ? spacing * 1.15 : spacing / 1.15)) });
  };
  const onContextMenu = (e: MouseEvent) => {
    if (rightDragged) {
      e.preventDefault();
      rightDragged = false;
    }
  };
  container.addEventListener("wheel", onWheel, { passive: false });
  container.addEventListener("contextmenu", onContextMenu);
}

export default function ChartDesktop() {
  const { activeTrades, waitingTrades, niftySignalBindings } = useTradeStore();
  const [symbolCandles, setSymbolCandles] = useState<SymbolCandles>({});
  const [, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const chartRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const chartInstances = useRef<Record<string, IChartApi>>({});
  const seriesInstances = useRef<Record<string, { main: ISeriesApi<"Candlestick">; ema1: ISeriesApi<"Line">; ema2: ISeriesApi<"Line">; se1: ISeriesApi<"Line">; se2: ISeriesApi<"Line">; markerPlugin: ISeriesMarkersPluginApi<Time>; labelPlugin: UTBotLabelsPrimitive; st1Plugin: SuperTrendPrimitive; st2Plugin: SuperTrendPrimitive }>>({});
  const observers = useRef<Record<string, ResizeObserver>>({});

  // Nifty50 live chart state
  const [nifty50Data, setNifty50Data] = useState<Nifty50CandleData>({ completedCandles: [], currentCandle: null });
  const [nifty50Connected, setNifty50Connected] = useState(false);
  const nifty50ChartRef = useRef<HTMLDivElement | null>(null);
  const nifty50ChartInstance = useRef<IChartApi | null>(null);
  const nifty50SeriesInstance = useRef<{ main: ISeriesApi<"Candlestick">; ema1: ISeriesApi<"Line">; ema2: ISeriesApi<"Line">; se1: ISeriesApi<"Line">; se2: ISeriesApi<"Line">; labelPlugin: UTBotLabelsPrimitive; st1Plugin: SuperTrendPrimitive; st2Plugin: SuperTrendPrimitive } | null>(null);
  const nifty50Observer = useRef<ResizeObserver | null>(null);

  // Indicators state
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
      return saved !== null ? parseFloat(saved) : 1;
    }
    return 1;
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
      return saved !== null ? parseFloat(saved) : 2;
    }
    return 2;
  });
  const [utbot2Atr, setUtbot2Atr] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("nifty_utbot2_atr");
      return saved !== null ? parseInt(saved, 10) : 300;
    }
    return 300;
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
      return saved !== null ? parseFloat(saved) : 2;
    }
    return 2;
  });
  const [utbot3Atr, setUtbot3Atr] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("nifty_utbot3_atr");
      return saved !== null ? parseInt(saved, 10) : 10;
    }
    return 10;
  });

  const [utbot4Enabled, setUtbot4Enabled] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("nifty_utbot4_enabled");
      return saved !== null ? saved === "true" : false;
    }
    return false;
  });
  const [utbot4Key, setUtbot4Key] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("nifty_utbot4_key");
      return saved !== null ? parseFloat(saved) : 3;
    }
    return 3;
  });
  const [utbot4Atr, setUtbot4Atr] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("nifty_utbot4_atr");
      return saved !== null ? parseInt(saved, 10) : 10;
    }
    return 10;
  });

  const [utbot5Enabled, setUtbot5Enabled] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("nifty_utbot5_enabled");
      return saved !== null ? saved === "true" : false;
    }
    return false;
  });
  const [utbot5Key, setUtbot5Key] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("nifty_utbot5_key");
      return saved !== null ? parseFloat(saved) : 4;
    }
    return 4;
  });
  const [utbot5Atr, setUtbot5Atr] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("nifty_utbot5_atr");
      return saved !== null ? parseInt(saved, 10) : 10;
    }
    return 10;
  });

  const [st1Enabled, setSt1Enabled] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("nifty_st1_enabled");
      return saved !== null ? saved === "true" : true;
    }
    return true;
  });
  const [st1Period, setSt1Period] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("nifty_st1_period");
      return saved !== null ? parseInt(saved, 10) : 10;
    }
    return 10;
  });
  const [st1Mult, setSt1Mult] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("nifty_st1_mult");
      return saved !== null ? parseFloat(saved) : 3;
    }
    return 3;
  });
  const [st2Enabled, setSt2Enabled] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("nifty_st2_enabled");
      return saved !== null ? saved === "true" : false;
    }
    return false;
  });
  const [st2Period, setSt2Period] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("nifty_st2_period");
      return saved !== null ? parseInt(saved, 10) : 10;
    }
    return 10;
  });
  const [st2Mult, setSt2Mult] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("nifty_st2_mult");
      return saved !== null ? parseFloat(saved) : 3;
    }
    return 3;
  });

  const [seEnabled, setSeEnabled] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("nifty_se_enabled");
      return saved !== null ? saved === "true" : false;
    }
    return false;
  });
  const [se1Period, setSe1Period] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("nifty_se1_period");
      return saved !== null ? parseInt(saved, 10) : 4;
    }
    return 4;
  });
  const [se2Period, setSe2Period] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("nifty_se2_period");
      return saved !== null ? parseInt(saved, 10) : 8;
    }
    return 8;
  });
  const [seTime, setSeTime] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("nifty_se_time") || "";
    }
    return "";
  });
  const [seCount, setSeCount] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("nifty_se_count");
      return saved !== null ? parseInt(saved, 10) : 30;
    }
    return 30;
  });
  const [seMaType, setSeMaType] = useState<ShortMaType>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("nifty_se_matype");
      return SHORT_MA_TYPES.some((t) => t.value === saved) ? (saved as ShortMaType) : "hma";
    }
    return "hma";
  });
  const [se1Color, setSe1Color] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("nifty_se1_color") || "#1d4ed8";
    }
    return "#1d4ed8";
  });
  const [se2Color, setSe2Color] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("nifty_se2_color") || "#db2777";
    }
    return "#db2777";
  });

  const [heikenAshi, setHeikenAshi] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("strategy_heiken_ashi") === "true";
    }
    return false;
  });

  const [niftyHeikenAshi, setNiftyHeikenAshi] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("nifty_heiken_ashi") === "true";
    }
    return false;
  });

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
      return saved !== null ? parseFloat(saved) : 1;
    }
    return 1;
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
      return saved !== null ? parseFloat(saved) : 2;
    }
    return 2;
  });
  const [sUtbot2Atr, setSUtbot2Atr] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("strategy_utbot2_atr");
      return saved !== null ? parseInt(saved, 10) : 300;
    }
    return 300;
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
      return saved !== null ? parseFloat(saved) : 2;
    }
    return 2;
  });
  const [sUtbot3Atr, setSUtbot3Atr] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("strategy_utbot3_atr");
      return saved !== null ? parseInt(saved, 10) : 10;
    }
    return 10;
  });
  const [sUtbot4Enabled, setSUtbot4Enabled] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("strategy_utbot4_enabled");
      return saved !== null ? saved === "true" : false;
    }
    return false;
  });
  const [sUtbot4Key, setSUtbot4Key] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("strategy_utbot4_key");
      return saved !== null ? parseFloat(saved) : 3;
    }
    return 3;
  });
  const [sUtbot4Atr, setSUtbot4Atr] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("strategy_utbot4_atr");
      return saved !== null ? parseInt(saved, 10) : 10;
    }
    return 10;
  });
  const [sUtbot5Enabled, setSUtbot5Enabled] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("strategy_utbot5_enabled");
      return saved !== null ? saved === "true" : false;
    }
    return false;
  });
  const [sUtbot5Key, setSUtbot5Key] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("strategy_utbot5_key");
      return saved !== null ? parseFloat(saved) : 4;
    }
    return 4;
  });
  const [sUtbot5Atr, setSUtbot5Atr] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("strategy_utbot5_atr");
      return saved !== null ? parseInt(saved, 10) : 10;
    }
    return 10;
  });

  const [sSt1Enabled, setSSt1Enabled] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("strategy_st1_enabled");
      return saved !== null ? saved === "true" : true;
    }
    return true;
  });
  const [sSt1Period, setSSt1Period] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("strategy_st1_period");
      return saved !== null ? parseInt(saved, 10) : 10;
    }
    return 10;
  });
  const [sSt1Mult, setSSt1Mult] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("strategy_st1_mult");
      return saved !== null ? parseFloat(saved) : 3;
    }
    return 3;
  });
  const [sSt2Enabled, setSSt2Enabled] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("strategy_st2_enabled");
      return saved !== null ? saved === "true" : false;
    }
    return false;
  });
  const [sSt2Period, setSSt2Period] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("strategy_st2_period");
      return saved !== null ? parseInt(saved, 10) : 10;
    }
    return 10;
  });
  const [sSt2Mult, setSSt2Mult] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("strategy_st2_mult");
      return saved !== null ? parseFloat(saved) : 3;
    }
    return 3;
  });

  const [sSeEnabled, setSSeEnabled] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("strategy_se_enabled");
      return saved !== null ? saved === "true" : false;
    }
    return false;
  });
  const [sSe1Period, setSSe1Period] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("strategy_se1_period");
      return saved !== null ? parseInt(saved, 10) : 4;
    }
    return 4;
  });
  const [sSe2Period, setSSe2Period] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("strategy_se2_period");
      return saved !== null ? parseInt(saved, 10) : 8;
    }
    return 8;
  });
  const [sSeTime, setSSeTime] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("strategy_se_time") || "";
    }
    return "";
  });
  const [sSeCount, setSSeCount] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("strategy_se_count");
      return saved !== null ? parseInt(saved, 10) : 30;
    }
    return 30;
  });
  const [sSeMaType, setSSeMaType] = useState<ShortMaType>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("strategy_se_matype");
      return SHORT_MA_TYPES.some((t) => t.value === saved) ? (saved as ShortMaType) : "hma";
    }
    return "hma";
  });
  const [sSe1Color, setSSe1Color] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("strategy_se1_color") || "#1d4ed8";
    }
    return "#1d4ed8";
  });
  const [sSe2Color, setSSe2Color] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("strategy_se2_color") || "#db2777";
    }
    return "#db2777";
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

    localStorage.setItem("nifty_utbot4_enabled", String(utbot4Enabled));
    localStorage.setItem("nifty_utbot4_key", String(utbot4Key));
    localStorage.setItem("nifty_utbot4_atr", String(utbot4Atr));

    localStorage.setItem("nifty_utbot5_enabled", String(utbot5Enabled));
    localStorage.setItem("nifty_utbot5_key", String(utbot5Key));
    localStorage.setItem("nifty_utbot5_atr", String(utbot5Atr));

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

    localStorage.setItem("strategy_utbot4_enabled", String(sUtbot4Enabled));
    localStorage.setItem("strategy_utbot4_key", String(sUtbot4Key));
    localStorage.setItem("strategy_utbot4_atr", String(sUtbot4Atr));

    localStorage.setItem("strategy_utbot5_enabled", String(sUtbot5Enabled));
    localStorage.setItem("strategy_utbot5_key", String(sUtbot5Key));
    localStorage.setItem("strategy_utbot5_atr", String(sUtbot5Atr));

    localStorage.setItem("nifty_st1_enabled", String(st1Enabled));
    localStorage.setItem("nifty_st1_period", String(st1Period));
    localStorage.setItem("nifty_st1_mult", String(st1Mult));
    localStorage.setItem("nifty_st2_enabled", String(st2Enabled));
    localStorage.setItem("nifty_st2_period", String(st2Period));
    localStorage.setItem("nifty_st2_mult", String(st2Mult));

    localStorage.setItem("strategy_st1_enabled", String(sSt1Enabled));
    localStorage.setItem("strategy_st1_period", String(sSt1Period));
    localStorage.setItem("strategy_st1_mult", String(sSt1Mult));
    localStorage.setItem("strategy_st2_enabled", String(sSt2Enabled));
    localStorage.setItem("strategy_st2_period", String(sSt2Period));
    localStorage.setItem("strategy_st2_mult", String(sSt2Mult));

    localStorage.setItem("nifty_se_enabled", String(seEnabled));
    localStorage.setItem("nifty_se1_period", String(se1Period));
    localStorage.setItem("nifty_se2_period", String(se2Period));
    localStorage.setItem("nifty_se_time", seTime);
    localStorage.setItem("nifty_se_count", String(seCount));
    localStorage.setItem("nifty_se_matype", seMaType);
    localStorage.setItem("nifty_se1_color", se1Color);
    localStorage.setItem("nifty_se2_color", se2Color);

    localStorage.setItem("strategy_se_enabled", String(sSeEnabled));
    localStorage.setItem("strategy_se1_period", String(sSe1Period));
    localStorage.setItem("strategy_se2_period", String(sSe2Period));
    localStorage.setItem("strategy_se_time", sSeTime);
    localStorage.setItem("strategy_se_count", String(sSeCount));
    localStorage.setItem("strategy_se_matype", sSeMaType);
    localStorage.setItem("strategy_se1_color", sSe1Color);
    localStorage.setItem("strategy_se2_color", sSe2Color);
  }, [
    ema1Enabled, ema1Period, ema2Enabled, ema2Period,
    utbot1Enabled, utbot1Key, utbot1Atr,
    utbot2Enabled, utbot2Key, utbot2Atr,
    utbot3Enabled, utbot3Key, utbot3Atr,
    utbot4Enabled, utbot4Key, utbot4Atr,
    utbot5Enabled, utbot5Key, utbot5Atr,
    st1Enabled, st1Period, st1Mult,
    st2Enabled, st2Period, st2Mult,
    heikenAshi, niftyHeikenAshi,
    sEma1Enabled, sEma1Period, sEma2Enabled, sEma2Period,
    sUtbot1Enabled, sUtbot1Key, sUtbot1Atr,
    sUtbot2Enabled, sUtbot2Key, sUtbot2Atr,
    sUtbot3Enabled, sUtbot3Key, sUtbot3Atr,
    sUtbot4Enabled, sUtbot4Key, sUtbot4Atr,
    sUtbot5Enabled, sUtbot5Key, sUtbot5Atr,
    sSt1Enabled, sSt1Period, sSt1Mult,
    sSt2Enabled, sSt2Period, sSt2Mult,
    seEnabled, se1Period, se2Period, seTime, seCount, seMaType, se1Color, se2Color,
    sSeEnabled, sSe1Period, sSe2Period, sSeTime, sSeCount, sSeMaType, sSe1Color, sSe2Color
  ]);

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

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    // Load full session history first (Zerodha-style): REST snapshot, then WS patches
    fetch(NIFTY50_REST_URL)
      .then((r) => r.json())
      .then((data) => {
        if (disposed) return;
        const completed = (data.completedCandles || []).filter((c: CandleData) => isWithinMarketHours(c.time));
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
            const incomingCompleted = (msg.completedCandles || []).filter((c: CandleData) => isWithinMarketHours(c.time));
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
  }, []);

  useEffect(() => {
    const container = nifty50ChartRef.current;
    if (!container) return;

    const allCandles = [...(nifty50Data.completedCandles || [])].filter((c) => c != null);
    if (nifty50Data.currentCandle) {
      allCandles.push(nifty50Data.currentCandle);
    }

    if (allCandles.length === 0) return;

    if (!nifty50ChartInstance.current) {
      const chart = createChart(container, {
        width: container.clientWidth,
        height: container.clientHeight,
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
          barSpacing: Math.max(container.clientWidth / 120, 5),
        },
        rightPriceScale: {
          borderColor: "rgba(0,0,0,0.1)",
        },
        handleScroll: { mouseWheel: false },
        handleScale: { mouseWheel: false },
      });

      attachCtrlWheelZoom(chart, container);

      const series = chart.addSeries(CandlestickSeries, {
        upColor: "#0a8a43",
        downColor: "#d12b2b",
        borderUpColor: "#0a8a43",
        borderDownColor: "#d12b2b",
        wickUpColor: "#0a8a43",
        wickDownColor: "#d12b2b",
      });

      series.priceScale().applyOptions({ scaleMargins: { top: 0.05, bottom: 0.08 } });

      const ema1Line = chart.addSeries(LineSeries, { color: "#2563eb", lineWidth: 1 });
      const ema2Line = chart.addSeries(LineSeries, { color: "#f97316", lineWidth: 1 });
      const se1Line = chart.addSeries(LineSeries, { color: "#1d4ed8", lineWidth: 2 });
      const se2Line = chart.addSeries(LineSeries, { color: "#db2777", lineWidth: 2 });

      const labelPlugin = new UTBotLabelsPrimitive();
      series.attachPrimitive(labelPlugin);

      const st1Plugin = new SuperTrendPrimitive();
      const st2Plugin = new SuperTrendPrimitive();
      series.attachPrimitive(st1Plugin);
      series.attachPrimitive(st2Plugin);

      nifty50ChartInstance.current = chart;
      nifty50SeriesInstance.current = { main: series, ema1: ema1Line, ema2: ema2Line, se1: se1Line, se2: se2Line, labelPlugin, st1Plugin, st2Plugin };

      const ro = new ResizeObserver(() => {
        if (!nifty50ChartInstance.current) return;
        chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
        chart.timeScale().applyOptions({ barSpacing: Math.max(container.clientWidth / 120, 5) });
      });
      ro.observe(container);
      nifty50Observer.current = ro;
    }

    if (!nifty50SeriesInstance.current) return;
    const { main, ema1: ema1Line, ema2: ema2Line, se1: se1Line, se2: se2Line, labelPlugin, st1Plugin, st2Plugin } = nifty50SeriesInstance.current;

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

      const closePrices = displayCandles.map(c => c.close);

      if (ema1Enabled) {
        const ema1Values = calculateEMA(closePrices, ema1Period);
        if (ema1Values.length > 0) {
          ema1Line.setData(ema1Values.map((val, idx) => ({
            time: displayCandles[idx + (closePrices.length - ema1Values.length)].time,
            value: val,
          })));
        } else {
          ema1Line.setData([]);
        }
      } else {
        ema1Line.setData([]);
      }

      if (ema2Enabled) {
        const ema2Values = calculateEMA(closePrices, ema2Period);
        if (ema2Values.length > 0) {
          ema2Line.setData(ema2Values.map((val, idx) => ({
            time: displayCandles[idx + (closePrices.length - ema2Values.length)].time,
            value: val,
          })));
        } else {
          ema2Line.setData([]);
        }
      } else {
        ema2Line.setData([]);
      }

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
      if (utbot4Enabled) {
        calculateUTBot(utbotCandles, utbot4Key, utbot4Atr).forEach(s =>
          utbotLabels.push({ time: s.time, type: s.type, color: s.type === "BUY" ? "#2563eb" : "#daa520" })
        );
      }
      if (utbot5Enabled) {
        calculateUTBot(utbotCandles, utbot5Key, utbot5Atr).forEach(s =>
          utbotLabels.push({ time: s.time, type: s.type, color: s.type === "BUY" ? "#005050" : "#8b0000" })
        );
      }

      labelPlugin.setData(
        displayCandles.map((c) => ({ time: c.time as number, high: c.high, low: c.low })),
        utbotLabels
      );

      st1Plugin.setData(st1Enabled ? calculateSuperTrend(displayCandles, st1Period, st1Mult) : []);
      st2Plugin.setData(st2Enabled ? calculateSuperTrend(displayCandles, st2Period, st2Mult) : []);

      se1Line?.setData(seEnabled ? shortMaSeries(displayCandles, se1Period, seTime, seCount, seMaType) : []);
      se2Line?.setData(seEnabled ? shortMaSeries(displayCandles, se2Period, seTime, seCount, seMaType) : []);
      se1Line?.applyOptions({ color: se1Color });
      se2Line?.applyOptions({ color: se2Color });
    }
  }, [nifty50Data, ema1Enabled, ema1Period, ema2Enabled, ema2Period,
      utbot1Enabled, utbot1Key, utbot1Atr,
      utbot2Enabled, utbot2Key, utbot2Atr,
      utbot3Enabled, utbot3Key, utbot3Atr,
      utbot4Enabled, utbot4Key, utbot4Atr,
      utbot5Enabled, utbot5Key, utbot5Atr,
      st1Enabled, st1Period, st1Mult,
      st2Enabled, st2Period, st2Mult,
      seEnabled, se1Period, se2Period, seTime, seCount, seMaType, se1Color, se2Color, niftyHeikenAshi]);

  useEffect(() => {
    return () => {
      if (nifty50Observer.current) {
        nifty50Observer.current.disconnect();
        nifty50Observer.current = null;
      }
      Object.values(observers.current).forEach((obs) => obs.disconnect());
      observers.current = {};

      if (nifty50ChartInstance.current) {
        nifty50ChartInstance.current.remove();
        nifty50ChartInstance.current = null;
        nifty50SeriesInstance.current = null;
      }
      Object.values(chartInstances.current).forEach((chart) => chart.remove());
      chartInstances.current = {};
      seriesInstances.current = {};
    };
  }, []);

  useEffect(() => {
    const fetchCandles = () => {
      setSpinning(true);
      fetchSymbolCandles()
        .then((result) => {
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
          setLoading(false);
          setSpinning(false);
        });
    };

    const kickoff = setTimeout(fetchCandles, 0);
    const interval = setInterval(fetchCandles, 60000);

    return () => {
      clearTimeout(kickoff);
      clearInterval(interval);
    };
  }, [refreshKey, niftySignalBindings]);

  useEffect(() => {
    const symbols = Object.keys(symbolCandles)
      .filter((s) => activeSymbols.has(s))
      .slice(0, 8);

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

      if (!chartInstances.current[symbol]) {
        const chart = createChart(container, {
          width: container.clientWidth,
          height: container.clientHeight,
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
            barSpacing: Math.max(container.clientWidth / 120, 5),
          },
          rightPriceScale: {
            borderColor: "rgba(255,255,255.1)",
          },
          handleScroll: { mouseWheel: false },
          handleScale: { mouseWheel: false },
        });

        attachCtrlWheelZoom(chart, container);

        const main = chart.addSeries(CandlestickSeries,
          niftySignalBindings[symbol] ? FAKE_CANDLE_COLORS : REAL_CANDLE_COLORS);

        main.priceScale().applyOptions({ scaleMargins: { top: 0.05, bottom: 0.08 } });

        const ema1Line = chart.addSeries(LineSeries, { color: "#5488fa", lineWidth: 1 });
        const ema2Line = chart.addSeries(LineSeries, { color: "#ffd932", lineWidth: 1 });
        const se1Line = chart.addSeries(LineSeries, { color: "#1d4ed8", lineWidth: 2 });
        const se2Line = chart.addSeries(LineSeries, { color: "#db2777", lineWidth: 2 });

        const labelPlugin = new UTBotLabelsPrimitive();
        main.attachPrimitive(labelPlugin);

        const st1Plugin = new SuperTrendPrimitive();
        const st2Plugin = new SuperTrendPrimitive();
        main.attachPrimitive(st1Plugin);
        main.attachPrimitive(st2Plugin);

        chartInstances.current[symbol] = chart;
        seriesInstances.current[symbol] = { main, ema1: ema1Line, ema2: ema2Line, se1: se1Line, se2: se2Line, markerPlugin: createSeriesMarkers(main), labelPlugin, st1Plugin, st2Plugin };

        const ro = new ResizeObserver(() => {
          if (!chartInstances.current[symbol]) return;
          chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
          chart.timeScale().applyOptions({ barSpacing: Math.max(container.clientWidth / 120, 5) });
        });
        ro.observe(container);
        observers.current[symbol] = ro;
      }

      if (!seriesInstances.current[symbol]) return;
      const { main, ema1: ema1Line, ema2: ema2Line, se1: se1Line, se2: se2Line, markerPlugin, labelPlugin, st1Plugin, st2Plugin } = seriesInstances.current[symbol];
      main.applyOptions(niftySignalBindings[symbol] ? FAKE_CANDLE_COLORS : REAL_CANDLE_COLORS);

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

      const deduped = new Map<number, typeof mapped[0]>();
      for (const c of mapped) deduped.set(c.time as number, c);
      const validCandles = Array.from(deduped.values())
        .sort((a, b) => (a.time as number) - (b.time as number));

      if (validCandles.length > 0) {
        const displayCandles = heikenAshi ? toHeikenAshi(validCandles) : validCandles;
        main.setData(displayCandles);

        const closePrices = displayCandles.map(c => c.close);
        const ema1Values = sEma1Enabled ? calculateEMA(closePrices, sEma1Period) : [];
        const ema2Values = sEma2Enabled ? calculateEMA(closePrices, sEma2Period) : [];

        ema1Line.setData(ema1Values.map((val, idx) => ({
          time: displayCandles[idx + (closePrices.length - ema1Values.length)].time,
          value: val,
        })));
        ema2Line.setData(ema2Values.map((val, idx) => ({
          time: displayCandles[idx + (closePrices.length - ema2Values.length)].time,
          value: val,
        })));

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
        if (sUtbot4Enabled) {
          calculateUTBot(displayCandles, sUtbot4Key, sUtbot4Atr).forEach(s =>
            utbotLabels.push({ time: s.time, type: s.type, color: s.type === "BUY" ? "#2563eb" : "#daa520" })
          );
        }
        if (sUtbot5Enabled) {
          calculateUTBot(displayCandles, sUtbot5Key, sUtbot5Atr).forEach(s =>
            utbotLabels.push({ time: s.time, type: s.type, color: s.type === "BUY" ? "#005050" : "#8b0000" })
          );
        }

        labelPlugin.setData(
          displayCandles.map((c) => ({ time: c.time as number, high: c.high, low: c.low })),
          utbotLabels
        );

        st1Plugin.setData(sSt1Enabled ? calculateSuperTrend(displayCandles, sSt1Period, sSt1Mult) : []);
        st2Plugin.setData(sSt2Enabled ? calculateSuperTrend(displayCandles, sSt2Period, sSt2Mult) : []);

        se1Line?.setData(sSeEnabled ? shortMaSeries(displayCandles, sSe1Period, sSeTime, sSeCount, sSeMaType) : []);
        se2Line?.setData(sSeEnabled ? shortMaSeries(displayCandles, sSe2Period, sSeTime, sSeCount, sSeMaType) : []);
        se1Line?.applyOptions({ color: sSe1Color });
        se2Line?.applyOptions({ color: sSe2Color });
      }
    });
  }, [symbolCandles, activeSymbols, heikenAshi, niftySignalBindings,
      sEma1Enabled, sEma1Period, sEma2Enabled, sEma2Period,
      sUtbot1Enabled, sUtbot1Key, sUtbot1Atr,
      sUtbot2Enabled, sUtbot2Key, sUtbot2Atr,
      sUtbot3Enabled, sUtbot3Key, sUtbot3Atr,
      sUtbot4Enabled, sUtbot4Key, sUtbot4Atr,
      sUtbot5Enabled, sUtbot5Key, sUtbot5Atr,
      sSt1Enabled, sSt1Period, sSt1Mult,
      sSt2Enabled, sSt2Period, sSt2Mult,
      sSeEnabled, sSe1Period, sSe2Period, sSeTime, sSeCount, sSeMaType, sSe1Color, sSe2Color]);



  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ scrollbarWidth: "thin", padding: 16, color: "var(--theme-popup-text)" }}>
      <div className="flex items-center gap-2 mb-6">
        <BarChart2 size={24} style={{ color: "var(--theme-popup-border)" }} />
        <h2 className="text-xl font-bold">Charts</h2>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
      {/* Nifty50 Section */}
      <div className="flex flex-col mb-8">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span
              className="text-sm font-semibold cursor-pointer hover:underline"
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
        </div>

        {/* NIFTY Indicators Bar (Always Visible) */}
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 shrink-0 text-xs mb-1 rounded-t-lg"
          style={{ background: "rgba(0,0,0,0.05)", border: "1px solid var(--theme-popup-field-border)", borderBottom: "none" }}
        >
          <IndicatorMenu label="EMA" enabledCount={Number(ema1Enabled) + Number(ema2Enabled)}>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={ema1Enabled} onChange={(e) => setEma1Enabled(e.target.checked)} className="h-3.5 w-3.5 accent-blue-500" />
              <span style={{ color: "var(--theme-popup-text)", fontSize: "10px", fontWeight: "bold" }}>EMA 1</span>
              <NumericField
                value={ema1Period}
                onChange={setEma1Period}
                className="w-10 h-6 rounded text-center text-[10px] font-bold"
                style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }}
                fallback="10"
              />
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={ema2Enabled} onChange={(e) => setEma2Enabled(e.target.checked)} className="h-3.5 w-3.5 accent-yellow-500" />
              <span style={{ color: "var(--theme-popup-text)", fontSize: "10px", fontWeight: "bold" }}>EMA 2</span>
              <NumericField
                value={ema2Period}
                onChange={setEma2Period}
                className="w-10 h-6 rounded text-center text-[10px] font-bold"
                style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }}
                fallback="30"
              />
            </label>
          </IndicatorMenu>
          <IndicatorMenu label="UTBOT" enabledCount={Number(utbot1Enabled) + Number(utbot2Enabled) + Number(utbot3Enabled) + Number(utbot4Enabled) + Number(utbot5Enabled)}>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={utbot1Enabled} onChange={(e) => setUtbot1Enabled(e.target.checked)} className="h-3.5 w-3.5 accent-purple-500" />
              <span style={{ color: "var(--theme-popup-text)", fontSize: "10px", fontWeight: "bold" }}>UTBOT 1</span>
              <NumericField value={utbot1Key} onChange={setUtbot1Key} className="w-8 h-6 rounded text-center text-[10px] font-bold" style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }} fallback="2" />
              <NumericField value={utbot1Atr} onChange={setUtbot1Atr} className="w-8 h-6 rounded text-center text-[10px] font-bold" style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }} fallback="10" />
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={utbot2Enabled} onChange={(e) => setUtbot2Enabled(e.target.checked)} className="h-3.5 w-3.5 accent-cyan-500" />
              <span style={{ color: "var(--theme-popup-text)", fontSize: "10px", fontWeight: "bold" }}>UTBOT 2</span>
              <NumericField value={utbot2Key} onChange={setUtbot2Key} className="w-8 h-6 rounded text-center text-[10px] font-bold" style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }} fallback="3" />
              <NumericField value={utbot2Atr} onChange={setUtbot2Atr} className="w-8 h-6 rounded text-center text-[10px] font-bold" style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }} fallback="10" />
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={utbot3Enabled} onChange={(e) => setUtbot3Enabled(e.target.checked)} className="h-3.5 w-3.5 accent-green-500" />
              <span style={{ color: "var(--theme-popup-text)", fontSize: "10px", fontWeight: "bold" }}>UTBOT 3</span>
              <NumericField value={utbot3Key} onChange={setUtbot3Key} className="w-8 h-6 rounded text-center text-[10px] font-bold" style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }} fallback="4" />
              <NumericField value={utbot3Atr} onChange={setUtbot3Atr} className="w-8 h-6 rounded text-center text-[10px] font-bold" style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }} fallback="10" />
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={utbot4Enabled} onChange={(e) => setUtbot4Enabled(e.target.checked)} className="h-3.5 w-3.5 accent-blue-600" />
              <span style={{ color: "var(--theme-popup-text)", fontSize: "10px", fontWeight: "bold" }}>UTBOT 4</span>
              <NumericField value={utbot4Key} onChange={setUtbot4Key} className="w-8 h-6 rounded text-center text-[10px] font-bold" style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }} fallback="3" />
              <NumericField value={utbot4Atr} onChange={setUtbot4Atr} className="w-8 h-6 rounded text-center text-[10px] font-bold" style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }} fallback="300" />
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={utbot5Enabled} onChange={(e) => setUtbot5Enabled(e.target.checked)} className="h-3.5 w-3.5 accent-[#005050]" />
              <span style={{ color: "var(--theme-popup-text)", fontSize: "10px", fontWeight: "bold" }}>UTBOT 5</span>
              <NumericField value={utbot5Key} onChange={setUtbot5Key} className="w-8 h-6 rounded text-center text-[10px] font-bold" style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }} fallback="1" />
              <NumericField value={utbot5Atr} onChange={setUtbot5Atr} className="w-8 h-6 rounded text-center text-[10px] font-bold" style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }} fallback="300" />
            </label>
          </IndicatorMenu>
          <IndicatorMenu label="SUPERTREND" enabledCount={Number(st1Enabled) + Number(st2Enabled)}>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={st1Enabled} onChange={(e) => setSt1Enabled(e.target.checked)} className="h-3.5 w-3.5 accent-green-600" />
              <span style={{ color: "var(--theme-popup-text)", fontSize: "10px", fontWeight: "bold" }}>ST 1</span>
              <NumericField value={st1Period} onChange={setSt1Period} className="w-8 h-6 rounded text-center text-[10px] font-bold" style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }} fallback="10" />
              <NumericField value={st1Mult} onChange={setSt1Mult} className="w-8 h-6 rounded text-center text-[10px] font-bold" style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }} fallback="3" />
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={st2Enabled} onChange={(e) => setSt2Enabled(e.target.checked)} className="h-3.5 w-3.5 accent-emerald-500" />
              <span style={{ color: "var(--theme-popup-text)", fontSize: "10px", fontWeight: "bold" }}>ST 2</span>
              <NumericField value={st2Period} onChange={setSt2Period} className="w-8 h-6 rounded text-center text-[10px] font-bold" style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }} fallback="10" />
              <NumericField value={st2Mult} onChange={setSt2Mult} className="w-8 h-6 rounded text-center text-[10px] font-bold" style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }} fallback="3" />
            </label>
          </IndicatorMenu>
          <IndicatorMenu label={`SHORT ${seMaType.toUpperCase()}`} enabledCount={Number(seEnabled)}>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={seEnabled} onChange={(e) => setSeEnabled(e.target.checked)} className="h-3.5 w-3.5 accent-purple-500" />
              <span style={{ color: se1Color, fontSize: "10px", fontWeight: "bold" }}>MA 1</span>
              <NumericField value={se1Period} onChange={setSe1Period} className="w-8 h-6 rounded text-center text-[10px] font-bold" style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }} fallback="4" />
              <input type="color" value={se1Color} onChange={(e) => setSe1Color(e.target.value)} className="w-6 h-6 cursor-pointer" style={{ border: "none", background: "none", padding: 0 }} title="MA 1 color" />
            </label>
            <label className="flex items-center gap-1.5">
              <span className="w-3.5" />
              <span style={{ color: se2Color, fontSize: "10px", fontWeight: "bold" }}>MA 2</span>
              <NumericField value={se2Period} onChange={setSe2Period} className="w-8 h-6 rounded text-center text-[10px] font-bold" style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }} fallback="8" />
              <input type="color" value={se2Color} onChange={(e) => setSe2Color(e.target.value)} className="w-6 h-6 cursor-pointer" style={{ border: "none", background: "none", padding: 0 }} title="MA 2 color" />
            </label>
            <label className="flex items-center gap-1.5">
              <span className="w-3.5" />
              <span style={{ color: "var(--theme-popup-text)", fontSize: "10px", fontWeight: "bold" }}>AT</span>
              <input
                value={seTime}
                onChange={(e) => setSeTime(e.target.value)}
                placeholder="LATEST"
                className="w-14 h-6 rounded text-center text-[10px] font-bold"
                style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }}
              />
            </label>
            <label className="flex items-center gap-1.5">
              <span className="w-3.5" />
              <span style={{ color: "var(--theme-popup-text)", fontSize: "10px", fontWeight: "bold" }}>LAST</span>
              <NumericField value={seCount} onChange={setSeCount} className="w-10 h-6 rounded text-center text-[10px] font-bold" style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }} fallback="30" />
              <span style={{ color: "var(--theme-popup-text)", fontSize: "10px", fontWeight: "bold" }}>CANDLES</span>
            </label>
            <label className="flex items-center gap-1.5">
              <span className="w-3.5" />
              <span style={{ color: "var(--theme-popup-text)", fontSize: "10px", fontWeight: "bold" }}>TYPE</span>
              <select
                value={seMaType}
                onChange={(e) => setSeMaType(e.target.value as ShortMaType)}
                className="h-6 rounded text-center text-[10px] font-bold px-1"
                style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }}
              >
                {SHORT_MA_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
          </IndicatorMenu>
          <div className="flex items-center gap-1.5 ml-auto border-l border-black/10 pl-4">
            <span className="text-[9px] font-bold opacity-50" style={{ color: "var(--theme-popup-text)" }}>HEIKEN ASHI</span>
            <button type="button" onClick={() => setNiftyHeikenAshi(!niftyHeikenAshi)} style={{
              width: 32, height: 18, borderRadius: 9,
              background: niftyHeikenAshi ? "var(--theme-toggle-on, var(--theme-popup-border))" : "var(--theme-toggle-off, var(--theme-popup-field-border))",
              position: "relative", transition: "background 0.2s", border: "none", cursor: "pointer",
            }}>
              <span style={{ position: "absolute", top: 2, left: niftyHeikenAshi ? 16 : 2, width: 14, height: 14, borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
            </button>
          </div>
        </div>

        {nifty50Data.completedCandles.length === 0 && !nifty50Data.currentCandle ? (
          <div className="text-xs py-8 text-center rounded-b-lg" style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)" }}>
            {nifty50Connected ? "Waiting for Nifty50 data..." : "Connecting to Nifty50 feed..."}
          </div>
        ) : (
          <div
            ref={nifty50ChartRef}
            className="w-full rounded-b-lg overflow-hidden"
            style={{ height: "calc(100vh - 280px)", minHeight: 450, background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)" }}
          />
        )}
      </div>

      {/* Strategy Charts Section */}
      {activeSymbols.size > 0 && (
        <div className="flex flex-col mb-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold" style={{ color: "var(--theme-popup-text)" }}>Strategy Chart Status</h3>
            <button
              onClick={() => setRefreshKey(k => k + 1)}
              className="p-1.5 rounded-full transition hover:opacity-80"
              style={{ background: "var(--theme-popup-border)", color: "#fff" }}
              title="Refresh charts"
              disabled={spinning}
            >
              <RefreshCw size={14} className={spinning ? "animate-spin" : ""} />
            </button>
          </div>

          {/* Strategy Indicators Bar (Always Visible) */}
          <div
            className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 shrink-0 text-xs mb-1 rounded-t-lg"
            style={{ background: "rgba(0,0,0,0.05)", border: "1px solid var(--theme-popup-field-border)", borderBottom: "none" }}
          >
            <IndicatorMenu label="EMA" enabledCount={Number(sEma1Enabled) + Number(sEma2Enabled)}>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={sEma1Enabled} onChange={(e) => setSEma1Enabled(e.target.checked)} className="h-3.5 w-3.5 accent-blue-500" />
                <span style={{ color: "var(--theme-popup-text)", fontSize: "10px", fontWeight: "bold" }}>EMA 1</span>
                <NumericField value={sEma1Period} onChange={setSEma1Period} className="w-10 h-6 rounded text-center text-[10px] font-bold" style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }} fallback="10" />
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={sEma2Enabled} onChange={(e) => setSEma2Enabled(e.target.checked)} className="h-3.5 w-3.5 accent-yellow-500" />
                <span style={{ color: "var(--theme-popup-text)", fontSize: "10px", fontWeight: "bold" }}>EMA 2</span>
                <NumericField value={sEma2Period} onChange={setSEma2Period} className="w-10 h-6 rounded text-center text-[10px] font-bold" style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }} fallback="20" />
              </label>
            </IndicatorMenu>
            <IndicatorMenu label="UTBOT" enabledCount={Number(sUtbot1Enabled) + Number(sUtbot2Enabled) + Number(sUtbot3Enabled) + Number(sUtbot4Enabled) + Number(sUtbot5Enabled)}>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={sUtbot1Enabled} onChange={(e) => setSUtbot1Enabled(e.target.checked)} className="h-3.5 w-3.5 accent-purple-500" />
                <span style={{ color: "var(--theme-popup-text)", fontSize: "10px", fontWeight: "bold" }}>UTBOT 1</span>
                <NumericField value={sUtbot1Key} onChange={setSUtbot1Key} className="w-8 h-6 rounded text-center text-[10px] font-bold" style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }} fallback="2" />
                <NumericField value={sUtbot1Atr} onChange={setSUtbot1Atr} className="w-8 h-6 rounded text-center text-[10px] font-bold" style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }} fallback="10" />
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={sUtbot2Enabled} onChange={(e) => setSUtbot2Enabled(e.target.checked)} className="h-3.5 w-3.5 accent-cyan-500" />
                <span style={{ color: "var(--theme-popup-text)", fontSize: "10px", fontWeight: "bold" }}>UTBOT 2</span>
                <NumericField value={sUtbot2Key} onChange={setSUtbot2Key} className="w-8 h-6 rounded text-center text-[10px] font-bold" style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }} fallback="3" />
                <NumericField value={sUtbot2Atr} onChange={setSUtbot2Atr} className="w-8 h-6 rounded text-center text-[10px] font-bold" style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }} fallback="10" />
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={sUtbot3Enabled} onChange={(e) => setSUtbot3Enabled(e.target.checked)} className="h-3.5 w-3.5 accent-green-500" />
                <span style={{ color: "var(--theme-popup-text)", fontSize: "10px", fontWeight: "bold" }}>UTBOT 3</span>
                <NumericField value={sUtbot3Key} onChange={setSUtbot3Key} className="w-8 h-6 rounded text-center text-[10px] font-bold" style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }} fallback="4" />
                <NumericField value={sUtbot3Atr} onChange={setSUtbot3Atr} className="w-8 h-6 rounded text-center text-[10px] font-bold" style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }} fallback="10" />
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={sUtbot4Enabled} onChange={(e) => setSUtbot4Enabled(e.target.checked)} className="h-3.5 w-3.5 accent-blue-600" />
                <span style={{ color: "var(--theme-popup-text)", fontSize: "10px", fontWeight: "bold" }}>UTBOT 4</span>
                <NumericField value={sUtbot4Key} onChange={setSUtbot4Key} className="w-8 h-6 rounded text-center text-[10px] font-bold" style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }} fallback="3" />
                <NumericField value={sUtbot4Atr} onChange={setSUtbot4Atr} className="w-8 h-6 rounded text-center text-[10px] font-bold" style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }} fallback="300" />
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={sUtbot5Enabled} onChange={(e) => setSUtbot5Enabled(e.target.checked)} className="h-3.5 w-3.5 accent-[#005050]" />
                <span style={{ color: "var(--theme-popup-text)", fontSize: "10px", fontWeight: "bold" }}>UTBOT 5</span>
                <NumericField value={sUtbot5Key} onChange={setSUtbot5Key} className="w-8 h-6 rounded text-center text-[10px] font-bold" style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }} fallback="1" />
                <NumericField value={sUtbot5Atr} onChange={setSUtbot5Atr} className="w-8 h-6 rounded text-center text-[10px] font-bold" style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }} fallback="300" />
              </label>
            </IndicatorMenu>
            <IndicatorMenu label="SUPERTREND" enabledCount={Number(sSt1Enabled) + Number(sSt2Enabled)}>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={sSt1Enabled} onChange={(e) => setSSt1Enabled(e.target.checked)} className="h-3.5 w-3.5 accent-green-600" />
                <span style={{ color: "var(--theme-popup-text)", fontSize: "10px", fontWeight: "bold" }}>ST 1</span>
                <NumericField value={sSt1Period} onChange={setSSt1Period} className="w-8 h-6 rounded text-center text-[10px] font-bold" style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }} fallback="10" />
                <NumericField value={sSt1Mult} onChange={setSSt1Mult} className="w-8 h-6 rounded text-center text-[10px] font-bold" style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }} fallback="3" />
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={sSt2Enabled} onChange={(e) => setSSt2Enabled(e.target.checked)} className="h-3.5 w-3.5 accent-emerald-500" />
                <span style={{ color: "var(--theme-popup-text)", fontSize: "10px", fontWeight: "bold" }}>ST 2</span>
                <NumericField value={sSt2Period} onChange={setSSt2Period} className="w-8 h-6 rounded text-center text-[10px] font-bold" style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }} fallback="10" />
                <NumericField value={sSt2Mult} onChange={setSSt2Mult} className="w-8 h-6 rounded text-center text-[10px] font-bold" style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }} fallback="3" />
              </label>
            </IndicatorMenu>
            <IndicatorMenu label={`SHORT ${sSeMaType.toUpperCase()}`} enabledCount={Number(sSeEnabled)}>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={sSeEnabled} onChange={(e) => setSSeEnabled(e.target.checked)} className="h-3.5 w-3.5 accent-purple-500" />
                <span style={{ color: sSe1Color, fontSize: "10px", fontWeight: "bold" }}>MA 1</span>
                <NumericField value={sSe1Period} onChange={setSSe1Period} className="w-8 h-6 rounded text-center text-[10px] font-bold" style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }} fallback="4" />
                <input type="color" value={sSe1Color} onChange={(e) => setSSe1Color(e.target.value)} className="w-6 h-6 cursor-pointer" style={{ border: "none", background: "none", padding: 0 }} title="MA 1 color" />
              </label>
              <label className="flex items-center gap-1.5">
                <span className="w-3.5" />
                <span style={{ color: sSe2Color, fontSize: "10px", fontWeight: "bold" }}>MA 2</span>
                <NumericField value={sSe2Period} onChange={setSSe2Period} className="w-8 h-6 rounded text-center text-[10px] font-bold" style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }} fallback="8" />
                <input type="color" value={sSe2Color} onChange={(e) => setSSe2Color(e.target.value)} className="w-6 h-6 cursor-pointer" style={{ border: "none", background: "none", padding: 0 }} title="MA 2 color" />
              </label>
              <label className="flex items-center gap-1.5">
                <span className="w-3.5" />
                <span style={{ color: "var(--theme-popup-text)", fontSize: "10px", fontWeight: "bold" }}>AT</span>
                <input
                  value={sSeTime}
                  onChange={(e) => setSSeTime(e.target.value)}
                  placeholder="LATEST"
                  className="w-14 h-6 rounded text-center text-[10px] font-bold"
                  style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }}
                />
              </label>
              <label className="flex items-center gap-1.5">
                <span className="w-3.5" />
                <span style={{ color: "var(--theme-popup-text)", fontSize: "10px", fontWeight: "bold" }}>LAST</span>
                <NumericField value={sSeCount} onChange={setSSeCount} className="w-10 h-6 rounded text-center text-[10px] font-bold" style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }} fallback="30" />
                <span style={{ color: "var(--theme-popup-text)", fontSize: "10px", fontWeight: "bold" }}>CANDLES</span>
              </label>
              <label className="flex items-center gap-1.5">
                <span className="w-3.5" />
                <span style={{ color: "var(--theme-popup-text)", fontSize: "10px", fontWeight: "bold" }}>TYPE</span>
                <select
                  value={sSeMaType}
                  onChange={(e) => setSSeMaType(e.target.value as ShortMaType)}
                  className="h-6 rounded text-center text-[10px] font-bold px-1"
                  style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)", color: "var(--theme-popup-text)" }}
                >
                  {SHORT_MA_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </label>
            </IndicatorMenu>
            <div className="flex items-center gap-1.5 ml-auto border-l border-black/10 pl-4">
              <span className="text-[9px] font-bold opacity-50" style={{ color: "var(--theme-popup-text)" }}>HEIKEN ASHI</span>
              <button type="button" onClick={() => setHeikenAshi(!heikenAshi)} style={{
                width: 32, height: 18, borderRadius: 9,
                background: heikenAshi ? "var(--theme-toggle-on, var(--theme-popup-border))" : "var(--theme-toggle-off, var(--theme-popup-field-border))",
                position: "relative", transition: "background 0.2s", border: "none", cursor: "pointer",
              }}>
                <span style={{ position: "absolute", top: 2, left: heikenAshi ? 16 : 2, width: 14, height: 14, borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
              </button>
            </div>
          </div>

          {error ? (
            <div className="text-sm py-8 text-center rounded-b-lg" style={{ background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)" }}>{error}</div>
          ) : (
            <div className="flex flex-col gap-8">
              {[...activeSymbols].slice(0, 8).map((symbol) => {
                const hasData = symbolCandles[symbol] && symbolCandles[symbol].length > 0;
                return (
                  <div key={symbol}>
                    <div className="text-xs font-semibold mb-1 truncate px-1" style={{ color: "var(--theme-popup-border)" }}>
                      <span>{symbol}</span>
                      {hasData && (
                        <span className="ml-2 font-normal opacity-50">
                          ({symbolCandles[symbol]?.length || 0} candles{niftySignalBindings[symbol] ? ` · ${niftySignalBindings[symbol]}` : ""})
                        </span>
                      )}
                    </div>
                    {hasData ? (
                      <div
                        ref={(el) => { chartRefs.current[symbol] = el; }}
                        className="w-full rounded-b-lg overflow-hidden"
                        style={{ height: 450, background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)" }}
                      />
                    ) : (
                      <div
                        className="w-full rounded-b-lg flex items-center justify-center gap-2"
                        style={{ height: 450, background: "var(--theme-popup-field-bg)", border: "1px solid var(--theme-popup-field-border)" }}
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
        </div>
      )}
      </div>
    </div>
  );
}
