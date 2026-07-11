"use client";

import { useState, useEffect, useRef } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_BASE_URL!;
const STRATEGY_URL = process.env.NEXT_PUBLIC_STRATEGY_API_URL!;

interface LogSection {
  title: string;
  url: string;
  logs: string[];
  error: string | null;
  filter: string;
  filterOptions: string[];
}

const FILTER_OPTIONS = ["ALL", "BUY", "SELL", "REENTER", "ERROR"];
const BASIC_FILTER_OPTIONS = ["ALL", "ERROR"];

function getLogColor(line: string): string {
  if (line.includes("REENTER")) return "cyan";
  if (line.includes("WAIT")) return "#fff";
  if (line.includes("BUY")) return "lime";
  if (line.includes("SELL")) return "red";
  if (line.startsWith("[ERR]") || line.includes("error") || line.includes("Error") || line.includes("ERROR")) return "var(--theme-tailwind-red-400)";
  return "var(--theme-zinc-300)";
}

function matchesFilter(line: string, filter: string): boolean {
  if (filter === "ALL") return true;
  if (filter === "ERROR") return line.startsWith("[ERR]") || line.includes("error") || line.includes("Error") || line.includes("ERROR");
  return line.includes(filter);
}

export default function LogMonitorPage() {
  const [sections, setSections] = useState<LogSection[]>([
    { title: "Angel Feed Server", url: `${API_URL}/logs/server`, logs: [], error: null, filter: "ALL", filterOptions: BASIC_FILTER_OPTIONS },
    { title: "Candle Builder", url: `${API_URL}/logs/candle`, logs: [], error: null, filter: "ALL", filterOptions: FILTER_OPTIONS },
    { title: "Strategy Engine", url: `${STRATEGY_URL}/logs/strategy`, logs: [], error: null, filter: "ALL", filterOptions: FILTER_OPTIONS },
    { title: "AI Guard", url: `/next-api/ai/logs`, logs: [], error: null, filter: "ALL", filterOptions: FILTER_OPTIONS },
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

  const setFilter = (idx: number, filter: string) => {
    setSections((prev) => prev.map((s, i) => (i === idx ? { ...s, filter } : s)));
  };

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
        {sections.map((section, idx) => {
          const filteredLogs = section.logs.filter((line) => matchesFilter(line, section.filter));
          return (
          <div
            key={idx}
            className="w-full rounded-lg overflow-hidden"
            style={{ border: "1px solid var(--theme-zinc-800)", backgroundColor: "var(--theme-zinc-900)" }}
          >
            {/* Section Header */}
            <div className="px-4 py-2 flex items-center justify-between flex-wrap gap-2" style={{ backgroundColor: "var(--theme-zinc-800)", borderBottom: "1px solid var(--theme-zinc-700)" }}>
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-semibold tracking-wide uppercase" style={{ color: "var(--theme-amber-400)" }}>
                  {section.title}
                </h2>
                {/* Filter pills */}
                <div className="flex items-center gap-1">
                  {section.filterOptions.map((opt) => (
                    <button
                      key={opt}
                      onClick={() => setFilter(idx, opt)}
                      className="text-xs px-2 py-0.5 rounded transition-colors"
                      style={{
                        background: section.filter === opt ? "var(--theme-amber-500)" : "var(--theme-zinc-700)",
                        color: section.filter === opt ? "#000" : "var(--theme-zinc-400)",
                        fontWeight: section.filter === opt ? 600 : 400,
                        border: "none",
                        cursor: "pointer",
                      }}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
              <span className="text-xs" style={{ color: "var(--theme-zinc-500)" }}>
                {section.error ? (
                  <span style={{ color: "var(--theme-tailwind-red-400)" }}>{section.error}</span>
                ) : section.filter === "ALL" ? (
                  `${section.logs.length} lines`
                ) : (
                  `${filteredLogs.length}/${section.logs.length} lines`
                )}
              </span>
            </div>

            {/* Log Content */}
            <div
              ref={(el) => { logRefs.current[idx] = el; }}
              className="p-3 font-mono text-xs leading-relaxed overflow-auto"
              style={{ minHeight: "250px", maxHeight: "400px" }}
            >
              {filteredLogs.length === 0 && !section.error && (
                <div className="italic" style={{ color: "var(--theme-zinc-600)" }}>
                  {section.logs.length === 0 ? "No logs yet..." : "No lines match this filter"}
                </div>
              )}
              {filteredLogs.map((line, i) => (
                <div
                  key={i}
                  className="whitespace-pre-wrap break-all"
                  style={{ color: getLogColor(line) }}
                >
                  {line}
                </div>
              ))}
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
}
