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
    <div className="fixed inset-0 z-50 bg-zinc-950 text-zinc-100 overflow-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-zinc-900 border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-wide text-center flex-1">
          Log Monitoring
        </h1>
        <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="accent-amber-500"
          />
          Auto-scroll
        </label>
      </div>

      {/* Log Sections */}
      <div className="p-4 flex flex-col gap-4">
        {sections.map((section, idx) => (
          <div
            key={idx}
            className="w-full border border-zinc-800 rounded-lg overflow-hidden bg-zinc-900"
          >
            {/* Section Header */}
            <div className="px-4 py-2 bg-zinc-800 border-b border-zinc-700 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-amber-400 tracking-wide uppercase">
                {section.title}
              </h2>
              <span className="text-xs text-zinc-500">
                {section.error ? (
                  <span className="text-red-400">{section.error}</span>
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
                <div className="text-zinc-600 italic">No logs yet...</div>
              )}
              {section.logs.map((line, i) => (
                <div
                  key={i}
                  className={`whitespace-pre-wrap break-all ${
                    line.startsWith("[ERR]")
                      ? "text-red-400"
                      : "text-zinc-300"
                  }`}
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
