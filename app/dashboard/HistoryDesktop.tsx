"use client";

import { useEffect, useState } from "react";
import { useTradeStore } from "../store/TradeStore";
import { History, Trash2, XCircle, Loader2 } from "lucide-react";
import { Pagination } from "@/components/ui/pagination";

export default function HistoryDesktop() {
  const [mounted, setMounted] = useState(false);
  const { tradeHistory, clearTradeHistory, removeTradeHistoryEntry } = useTradeStore();
  const [currentPage, setCurrentPage] = useState(1);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  const tradesPerPage = 20; // More per page for desktop

  useEffect(() => {
    setMounted(true);
  }, []);

  const safeHistory = mounted ? tradeHistory : [];

  const totalPages = Math.ceil(safeHistory.length / tradesPerPage);
  const startIndex = (currentPage - 1) * tradesPerPage;
  const endIndex = startIndex + tradesPerPage;
  const currentTrades = safeHistory.slice(startIndex, endIndex);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const labelStyle = { color: "var(--theme-popup-label)", fontSize: "10px", fontWeight: "bold", textTransform: "uppercase" as const, letterSpacing: "0.5px" };
  const iconStyle = { color: "var(--theme-popup-border)" };

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ padding: 16, color: "var(--theme-popup-text)" }}>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <History size={24} style={iconStyle} />
          <h2 className="text-xl font-bold">Trade History</h2>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs font-bold" style={{ color: "var(--theme-popup-label)" }}>
            Total: {safeHistory.length}
          </span>
          {safeHistory.length > 0 && (
            <button
              type="button"
              className="p-2 rounded-lg transition hover:bg-red-500/10"
              style={{ color: "#ef4444" }}
              onClick={() => {
                if (window.confirm("Clear all trade history?")) {
                  fetch("/next-api/trades/history/clear", { method: "POST" }).catch(() => {});
                  clearTradeHistory();
                }
              }}
            >
              <Trash2 size={20} />
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4">
        {safeHistory.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold py-1 px-2 rounded" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e" }}>
              {safeHistory.filter(item => item.pnl > 0).length} WINS
            </span>
            <span className="text-[10px] font-bold py-1 px-2 rounded" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>
              {safeHistory.filter(item => item.pnl < 0).length} LOSSES
            </span>
          </div>
        )}
        {totalPages > 1 && (
          <span className="text-xs font-bold ml-auto" style={{ color: "var(--theme-popup-label)" }}>
            Page {currentPage} of {totalPages}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto pr-1" style={{ scrollbarWidth: "thin" }}>
        {safeHistory.length === 0 ? (
          <div className="flex-1 flex items-center justify-center py-20 opacity-30">
            <div className="text-center">
              <History size={48} className="mx-auto mb-2" />
              <div className="text-sm font-bold uppercase tracking-widest">No history yet</div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {currentTrades.map((item, index) => {
              const pnlText = item.pnl >= 0 ? `+${item.pnl.toFixed(2)}` : item.pnl.toFixed(2);
              const completedCycles = item.logs.reduce((count, log) => {
                const normalized = log.trim().toUpperCase();
                if (normalized.startsWith("BUY TRIGGERED") || normalized.startsWith("RE-ENTRY TRIGGERED") || normalized.startsWith("SELL MANUALLY")) {
                  return count + 1;
                }
                return count;
              }, 0);
              const tradesDisplay = item.config
                ? `Trades: ${completedCycles} of ${item.config.numberOfTrades}`
                : `Trades: ${completedCycles}`;
              const hasAiInvolved = item.logs.some(log => 
                log.toLowerCase().includes("ai guard") || 
                log.toLowerCase().includes("ai detected")
              );

              return (
                <div
                  key={`${item.id}-${index}`}
                  className="p-4 rounded-xl border transition-all hover:border-white/10"
                  style={{ background: "var(--theme-popup-field-bg)", borderColor: "var(--theme-popup-field-border)" }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-black" style={{ color: "var(--theme-popup-border)" }}>{item.symbol}</div>
                      {hasAiInvolved && <span className="text-base">🤖</span>}
                    </div>
                    <div className="flex items-center gap-3">
                      <div
                        className="text-sm font-mono font-bold"
                        style={{ color: item.pnl >= 0 ? "#22c55e" : "#ef4444" }}
                      >
                        {pnlText}
                      </div>
                      <button
                        type="button"
                        style={{ color: "var(--theme-popup-label)" }}
                        className="opacity-50 hover:opacity-100 transition-opacity"
                        disabled={deletingIds.has(item.id)}
                        onClick={() => {
                          setDeletingIds((prev) => new Set(prev).add(item.id));
                          fetch(`/next-api/trades/history/${encodeURIComponent(item.id)}/remove`, { method: "POST" })
                            .then(() => removeTradeHistoryEntry(item.id))
                            .catch(() => {})
                            .finally(() => {
                              setDeletingIds((prev) => { const next = new Set(prev); next.delete(item.id); return next; });
                            });
                        }}
                      >
                        {deletingIds.has(item.id) ? <Loader2 size={16} className="animate-spin" /> : <XCircle size={16} />}
                      </button>
                    </div>
                  </div>

                  {item.config && (
                    <div className="flex flex-wrap gap-x-3 gap-y-1 mb-3 opacity-60" style={{ fontSize: "10px", fontWeight: "bold" }}>
                      <span style={{ color: "var(--theme-popup-text)" }}>{tradesDisplay}</span>
                      {item.config.stopLossNumberEnabled && <span>| SL: {item.config.stopLossNumber}</span>}
                      {item.config.targetPointsEnabled && <span>| TGT: {item.config.targetPoints}</span>}
                      {item.config.trailingAfterTargetEnabled && <span>| TSL: {item.config.trailingAfterTarget}</span>}
                    </div>
                  )}

                  <details className="group">
                    <summary className="text-[10px] font-bold cursor-pointer opacity-40 group-open:opacity-100 hover:opacity-100 transition-opacity uppercase tracking-widest list-none flex items-center gap-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-current opacity-50" />
                      Details
                    </summary>
                    <div className="mt-3 space-y-1 pl-2 border-l-2 border-white/5" style={{ maxHeight: "200px", overflowY: "auto", scrollbarWidth: "thin" }}>
                      {item.logs.length === 0 ? (
                        <div className="text-[10px] opacity-30 italic">No logs</div>
                      ) : (
                        item.logs.map((line, i) => (
                          <div
                            key={i}
                            className="text-[11px] font-mono leading-relaxed"
                            style={{ color: "var(--theme-popup-text)", opacity: 0.8 }}
                            dangerouslySetInnerHTML={{
                              __html: line
                                .replace(/₹ ?(\d+(?:\.\d+)?)/g, `<span style="color:var(--theme-log-rs-gold, #fcd34d)">₹$1</span>`)
                                .replace(/at (\d{2}:\d{2}(?::\d{2})?)/g, `at <span style="color:var(--theme-log-cyan-time, #38bdf8)">$1</span>`)
                                .replace(/(Trade P\/L|Total P\/L): (-?\d+(?:\.\d+)?)/g, (match, label, plValue) => {
                                  const isProfit = !plValue.startsWith("-");
                                  const color = isProfit ? "#22c55e" : "#ef4444";
                                  return `<span style="color:${color}; font-weight:bold">${label}: ${plValue}</span>`;
                                }),
                            }}
                          />
                        ))
                      )}
                    </div>
                  </details>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="mt-4 pt-4 border-t" style={{ borderColor: "var(--theme-popup-field-border)" }}>
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={handlePageChange}
          />
        </div>
      )}
    </div>
  );
}
