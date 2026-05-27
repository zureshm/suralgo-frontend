"use client";

import { useState, useEffect, useRef } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_BASE_URL!;
const STRATEGY_URL = process.env.NEXT_PUBLIC_STRATEGY_API_URL!;

interface LogSection {
  title: string;
  url: string;
  logs: string[];
  error: string | null;
}

export default function LogMonitorPage() {
  const [sections, setSections] = useState<LogSection[]>([
    { title: "Angel Feed Server", url: `${API_URL}/logs/server`, logs: [], error: null },
    { title: "Candle Builder", url: `${API_URL}/logs/candle`, logs: [], error: null },
    { title: "Strategy Engine", url: `${STRATEGY_URL}/logs/strategy`, logs: [], error: null },
  ]);

  const [autoScroll, setAutoScroll] = useState(true);
  const logRefs = useRef<(HTMLDivElement | null)[]>([]);

  const fetchLogs = async () => {
    const updated = await Promise.all(
      sections.map(async (section) => {
        try {
          const res = await fetch(section.url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          return { ...section, logs: data.logs || [], error: null };
        } catch (err: any) {
          return { ...section, error: err.message || "Fetch failed" };
        }
      })
    );
    setSections(updated);
  };

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (autoScroll) {
      logRefs.current.forEach((ref) => {
        if (ref) ref.scrollTop = ref.scrollHeight;
      });
    }
  }, [sections, autoScroll]);

  return (
    <div className="fixed inset-0 z-50 overflow-auto" style={{ backgroundColor: "var(--theme-zinc-950)", color: "var(--theme-zinc-100)" }}>
      {/* Header */}
      <div className="sticky top-0 z-10 px-6 py-4 flex items-center justify-between" style={{ backgroundColor: "var(--theme-zinc-900)", borderBottom: "1px solid var(--theme-zinc-800)" }}>
        <h1 className="text-xl font-bold tracking-wide text-center flex-1">
          Log Monitoring
        </h1>
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none" style={{ color: "var(--theme-zinc-400)" }}>
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            style={{ accentColor: "var(--theme-amber-500)" }}
          />
          Auto-scroll
        </label>
      </div>

      {/* Log Sections */}
      <div className="p-4 flex flex-col gap-4">
        {sections.map((section, idx) => (
          <div
            key={idx}
            className="w-full rounded-lg overflow-hidden"
            style={{ border: "1px solid var(--theme-zinc-800)", backgroundColor: "var(--theme-zinc-900)" }}
          >
            {/* Section Header */}
            <div className="px-4 py-2 flex items-center justify-between" style={{ backgroundColor: "var(--theme-zinc-800)", borderBottom: "1px solid var(--theme-zinc-700)" }}>
              <h2 className="text-sm font-semibold tracking-wide uppercase" style={{ color: "var(--theme-amber-400)" }}>
                {section.title}
              </h2>
              <span className="text-xs" style={{ color: "var(--theme-zinc-500)" }}>
                {section.error ? (
                  <span style={{ color: "var(--theme-tailwind-red-400)" }}>{section.error}</span>
                ) : (
                  `${section.logs.length} lines`
                )}
              </span>
            </div>

            {/* Log Content */}
            <div
              ref={(el) => { logRefs.current[idx] = el; }}
              className="p-3 font-mono text-xs leading-relaxed overflow-auto"
              style={{ minHeight: "250px", maxHeight: "400px" }}
            >
              {section.logs.length === 0 && !section.error && (
                <div className="italic" style={{ color: "var(--theme-zinc-600)" }}>No logs yet...</div>
              )}
              {section.logs.map((line, i) => (
                <div
                  key={i}
                  className="whitespace-pre-wrap break-all"
                  style={{
                    color: line.includes("WAIT")
                      ? "#fff"
                      : line.includes("BUY")
                      ? "lime"
                      : line.includes("SELL")
                      ? "red"
                      : line.startsWith("[ERR]")
                      ? "var(--theme-tailwind-red-400)"
                      : "var(--theme-zinc-300)"
                  }}
                >
                  {line}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
