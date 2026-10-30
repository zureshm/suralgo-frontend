"use client";

import { useEffect, useRef, useState } from "react";
import { createChart, CandlestickSeries, IChartApi, ISeriesApi } from "lightweight-charts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart2 } from "lucide-react";
import { CandleData, toChartTime, isWithinMarketHours } from "@/lib/strategy-chart";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:2000";
const NIFTY50_WS_URL = process.env.NEXT_PUBLIC_NIFTY50_WS_URL || API_BASE_URL.replace(/^http/, "ws") + "/ws/nifty50";
const NIFTY50_REST_URL = process.env.NEXT_PUBLIC_NIFTY50_REST_URL ||
  NIFTY50_WS_URL.replace(/^ws/, "http").replace(/\/ws\/nifty50$/, "/nifty50-candles");

type Nifty50CandleData = {
  completedCandles: CandleData[];
  currentCandle: CandleData | null;
};

export default function Nifty50MiniChart() {
  const [data, setData] = useState<Nifty50CandleData>({ completedCandles: [], currentCandle: null });
  const chartRef = useRef<HTMLDivElement | null>(null);
  const chartInstance = useRef<IChartApi | null>(null);
  const seriesInstance = useRef<ISeriesApi<"Candlestick"> | null>(null);

  // REST snapshot, then live WS patches — same feed as ChartDesktop
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    fetch(NIFTY50_REST_URL)
      .then((r) => r.json())
      .then((d) => {
        if (disposed) return;
        const completed = (d.completedCandles || []).filter((c: CandleData) => isWithinMarketHours(c.time));
        const current = d.currentCandle && isWithinMarketHours(d.currentCandle.time) ? d.currentCandle : null;
        if (completed.length > 0 || current) {
          setData({ completedCandles: completed, currentCandle: current });
        }
      })
      .catch(() => {});

    function connect() {
      if (disposed) return;
      ws = new WebSocket(NIFTY50_WS_URL);

      ws.onmessage = (event) => {
        if (disposed) return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "snapshot" || msg.type === "update") {
            const incomingCompleted = (msg.completedCandles || []).filter((c: CandleData) => isWithinMarketHours(c.time));
            const incomingCurrent = msg.currentCandle && isWithinMarketHours(msg.currentCandle.time) ? msg.currentCandle : null;

            setData((prev) => {
              if (incomingCompleted.length === 0 && !incomingCurrent && prev.completedCandles.length > 0) {
                return prev;
              }
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
      setData({ completedCandles: [], currentCandle: null });
    };
  }, []);

  // Chart create + data feed
  useEffect(() => {
    const container = chartRef.current;
    if (!container) return;

    const allCandles = [...(data.completedCandles || [])].filter((c) => c != null);
    if (data.currentCandle) {
      allCandles.push(data.currentCandle);
    }
    if (allCandles.length === 0) return;

    if (!chartInstance.current) {
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
          barSpacing: Math.max(container.clientWidth / 30, 5),
        },
        rightPriceScale: {
          borderColor: "rgba(0,0,0,0.1)",
        },
        handleScroll: { mouseWheel: false },
        handleScale: { mouseWheel: false },
      });

      const series = chart.addSeries(CandlestickSeries, {
        upColor: "#0a8a43",
        downColor: "#d12b2b",
        borderUpColor: "#0a8a43",
        borderDownColor: "#d12b2b",
        wickUpColor: "#0a8a43",
        wickDownColor: "#d12b2b",
      });
      series.priceScale().applyOptions({ scaleMargins: { top: 0.05, bottom: 0.08 } });

      chartInstance.current = chart;
      seriesInstance.current = series;

      const ro = new ResizeObserver(() => {
        if (!chartInstance.current) return;
        chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
        chart.timeScale().applyOptions({ barSpacing: Math.max(container.clientWidth / 30, 5) });
      });
      ro.observe(container);
    }

    if (!seriesInstance.current) return;
    const byTime = new Map<number, CandleData>();
    for (const c of allCandles) byTime.set(toChartTime(c.time) as number, c);
    const seriesData = Array.from(byTime.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([t, c]) => ({
        time: t as unknown as import("lightweight-charts").Time,
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
      }));
    seriesInstance.current.setData(seriesData);
    if (chartInstance.current) {
      const n = seriesData.length;
      chartInstance.current.timeScale().setVisibleLogicalRange({ from: n - 30, to: n + 2 });
    }
  }, [data]);

  // Cleanup chart on unmount
  useEffect(() => {
    return () => {
      if (chartInstance.current) {
        chartInstance.current.remove();
        chartInstance.current = null;
        seriesInstance.current = null;
      }
    };
  }, []);

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg font-semibold">
            <BarChart2 className="w-5 h-5" />
            NIFTY 50
          </CardTitle>
          <div className="text-[10px] font-medium text-muted-foreground">
            {data.currentCandle && (
              <>LTP: {data.currentCandle.close} | {data.completedCandles.length} candles</>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-2">
        <div ref={chartRef} style={{ width: "100%", height: "180px" }} />
      </CardContent>
    </Card>
  );
}
