"use client";

import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Activity, Zap, XCircle, Loader2, AlertTriangle } from "lucide-react";
import styles from "./ActiveTrade.module.scss";
import type { ActiveTrade as ActiveTradeType, WaitingTrade } from "../store/TradeStore";
import { useTradeStore } from "../store/TradeStore";

function TradeLogsConsole({ logs }: { logs: string[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevLogsLengthRef = useRef(logs.length);

  useEffect(() => {
    const container = containerRef.current;
    if (logs.length > prevLogsLengthRef.current) {
      // Log new broker-related entries to browser console
      const newLogs = logs.slice(prevLogsLengthRef.current);
      for (const line of newLogs) {
        if (line.includes("[BROKER]")) {
          if (line.includes("SUCCESS")) {
            console.log(`%c${line}`, "color: #22c55e; font-weight: bold;");
          } else if (line.includes("FAILED") || line.includes("ERROR")) {
            console.error(`%c${line}`, "color: #ef4444; font-weight: bold;");
          } else {
            console.log(line);
          }
        }
      }
      if (container) container.scrollTop = container.scrollHeight;
    }
    prevLogsLengthRef.current = logs.length;
  }, [logs]);

  return (
    <div className={styles.tradeLogs} ref={containerRef}>
      {logs.map((line, i) => (
        <div
          key={i}
          className={styles.logLine}
          style={line.includes("[BROKER]") ? {
            fontWeight: "bold",
            color: line.includes("SUCCESS") ? "#22c55e" : line.includes("FAILED") || line.includes("ERROR") ? "#ef4444" : undefined,
          } : undefined}
          dangerouslySetInnerHTML={{
            __html: line
              .replace(
                /₹ ?(\d+(?:\.\d+)?)/g,
                `<span class="${styles.rsGold}">₹$1</span>`
              )
              .replace(
                /at (\d{2}:\d{2}(?::\d{2})?)/g,
                `at <span class="${styles.cyanTime}">$1</span>`
              )
              .replace(
                /(Trade P\/L|Total P\/L): (-?\d+(?:\.\d+)?)/g,
                (match, label, plValue) => {
                  const isProfit = !plValue.startsWith("-");
                  const className = isProfit ? styles.plProfit : styles.plLoss;
                  return `<span class="${className}">${label}: ${plValue}</span>`;
                }
              ),
          }}
        />
      ))}
    </div>
  );
}

type Props = {
  activeTrades: ActiveTradeType[];
  waitingTrades: WaitingTrade[];
  activeLtps: Record<string, number>;
  isHydrated: boolean;
  strategyLastCandleTime?: string;
  onManualExit: (symbol: string, exitPrice: string, pnl: number, lastCandleTime: string) => void;
  onCancelWaiting: (symbol: string) => void;
};

export default function ActiveTrade({
  activeTrades,
  waitingTrades,
  activeLtps,
  isHydrated,
  strategyLastCandleTime,
  onManualExit,
  onCancelWaiting,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const { removeTradeAndFreeSymbol, forceBuyEnabled, initializedSymbols, symbolHistoryStatus } = useTradeStore();

  // Track when each waiting symbol was first seen — for 30s loader timeout
  // Stored in state (not ref) so it is safe to read during render.
  const [addedAtMap, setAddedAtMap] = useState<Record<string, number>>({});

  // Register add-time for new symbols; clean up removed ones
  useEffect(() => {
    setAddedAtMap((prev) => {
      const now = Date.now();
      const next: Record<string, number> = {};
      for (const t of waitingTrades) {
        next[t.symbol] = prev[t.symbol] ?? now;
      }
      return next;
    });
  }, [waitingTrades]);

  // Stable "now" timestamp updated every second while any symbol is loading.
  // Stored in state to avoid calling Date.now() during render (React Compiler impure-function).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const ticker = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(ticker);
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  const safeActiveTrades = mounted ? activeTrades : [];
  const safeWaitingTrades = mounted ? waitingTrades : [];

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex flex-col gap-3">
          <CardTitle className="flex items-center gap-2 text-lg font-semibold">
            <Activity className="w-5 h-5" />
            ACTIVE TRADES
          </CardTitle>
          
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              Active: {safeActiveTrades.length} | Waiting: {safeWaitingTrades.length}
            </span>
            {safeActiveTrades.length > 0 && (
              <Badge variant="default" className="font-semibold">
                Running
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-3">
        <Separator />
        <div className={styles.activeTrades}>
          {/* real active trades */}
          {safeActiveTrades.map((t) => (
            <div key={t.symbol} className={styles.trade}>
              <div className={styles.tradeRow}>
                <div className={styles.tradeSymbol}>{t.symbol}</div>

                <div className={styles.tradeRight}>
                  {(() => {
                    const ltp = activeLtps[t.symbol];
                    const entry = Number(t.entryPrice);
                    const qty = t.lotSize * t.lotValue;
                    const unrealized =
                      t.inPosition && Number.isFinite(ltp) && Number.isFinite(entry)
                        ? (ltp - entry) * qty
                        : 0;
                    const livePnl = t.pnl + unrealized;

                    return (
                      <div
                        className={`${styles.tradeMeta} ${
                          livePnl >= 0 ? styles.profit : styles.loss
                        }`}
                      >
                        {livePnl.toFixed(2)}
                      </div>
                    );
                  })()}

                  {t.status === "ACTIVE" && (
                    <button
                      className={`${styles.tradeAction} ${styles.dark}`}
                      type="button"
                      onClick={() => {
                        const ltp = activeLtps[t.symbol];
                        const entry = Number(t.entryPrice);
                        const qty = t.lotSize * t.lotValue;
                        const unrealized =
                          t.inPosition && Number.isFinite(ltp) && Number.isFinite(entry)
                            ? (ltp - entry) * qty
                            : 0;
                        const livePnl = t.pnl + unrealized;

                        const now = new Date();
                        const hh = String(now.getHours()).padStart(2, "0");
                        const mm = String(now.getMinutes()).padStart(2, "0");
                        const ss = String(now.getSeconds()).padStart(2, "0");
                        const lastCandleTime = `${hh}:${mm}:${ss}`;

                        // Notify server-side engine of manual exit
                        fetch(`/next-api/trades/${encodeURIComponent(t.symbol)}/exit`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ exitPrice: String(ltp ?? ""), lastCandleTime }),
                        }).catch(() => {});

                        onManualExit(t.symbol, String(ltp ?? ""), livePnl, lastCandleTime);
                      }}
                    >
                      EXIT
                    </button>
                  )}
                  {t.status === "COMPLETED" && (
                    <button
                      className={`${styles.tradeAction} ${styles.danger}`}
                      type="button"
                      onClick={() => {
                        fetch(`/next-api/trades/${encodeURIComponent(t.symbol)}/remove`, { method: "POST" }).catch(() => {});
                        removeTradeAndFreeSymbol(t.symbol);
                      }}
                    >
                      CLOSE
                    </button>
                  )}
                </div>
              </div>

              {t.logs.length > 0 && <TradeLogsConsole logs={t.logs} />}

              {/* Trade Configuration */}
              <div className={styles.tradeConfig}>
                <div className="text-xs" style={{ color: "var(--theme-text-gray-500)" }}>
                  Trades: {t.numberOfTrades} | SL: {t.stopLossNumberEnabled ? t.stopLossNumber : "OFF"} | Target: {t.targetPointsEnabled ? t.targetPoints : "OFF"} | TSL: {t.trailingAfterTargetEnabled ? t.trailingAfterTarget : "OFF"}
                  {t.minToHoldEnabled && ` | Min Target: ${t.minToHold}`}
                </div>
              </div>
            </div>
          ))}

          {/* Pending symbols — not yet initialized, shown as compact banners */}
          {mounted && isHydrated && (() => {
            const pending = safeWaitingTrades.filter((t) => !initializedSymbols.has(t.symbol));
            if (pending.length === 0) return null;
            return pending.map((t) => {
              const addedAt = addedAtMap[t.symbol] ?? nowMs;
              const elapsedMs = nowMs - addedAt;
              const histStatus = symbolHistoryStatus[t.symbol];
              const historyFailed = histStatus?.status === "failed";
              const isTimedOut = elapsedMs >= 30000;
              const showError = historyFailed || isTimedOut;

              const errorMessage = historyFailed
                ? "History fetch failed (0 candles). Strategy may not work correctly without history. Remove and re-add, or keep with limited accuracy."
                : "Strategy engine did not respond. Check backend or remove and re-add.";

              return showError ? (
                <div key={`pending-${t.symbol}`} style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "8px 10px", borderRadius: "6px", background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", marginBottom: "6px" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
                    <AlertTriangle className="w-4 h-4" style={{ color: "#f59e0b", flexShrink: 0, marginTop: "1px" }} />
                    <div style={{ flex: 1, fontSize: "12px", lineHeight: "16px" }}>
                      <span style={{ fontWeight: 600, color: "#f59e0b" }}>{t.symbol}</span>
                      <span style={{ color: "var(--theme-text-gray-500)", marginLeft: "6px" }}>— {errorMessage}</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "6px", marginLeft: "26px" }}>
                    <button
                      className={`${styles.waitingBtn} ${styles.danger}`}
                      type="button"
                      style={{ padding: "2px 8px", fontSize: "11px" }}
                      onClick={() => {
                        fetch(`/next-api/trades/${encodeURIComponent(t.symbol)}/cancel`, { method: "POST" }).catch(() => {});
                        onCancelWaiting(t.symbol);
                      }}
                    >
                      <XCircle className="w-3 h-3" />
                      Remove
                    </button>
                    {historyFailed && (
                      <button
                        className={`${styles.waitingBtn} ${styles.dark}`}
                        type="button"
                        style={{ padding: "2px 8px", fontSize: "11px" }}
                        onClick={() => {
                          // Force symbol into initialized set — user accepts limited accuracy
                          fetch(`/next-api/trades/${encodeURIComponent(t.symbol)}/force-init`, { method: "POST" }).catch(() => {});
                        }}
                      >
                        Keep anyway
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div key={`pending-${t.symbol}`} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 10px", borderRadius: "6px", background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.15)", marginBottom: "6px" }}>
                  <Loader2 className="w-4 h-4 animate-spin" style={{ color: "#6366f1", flexShrink: 0 }} />
                  <span style={{ fontSize: "12px", fontWeight: 500 }}>{t.symbol}</span>
                  <span style={{ fontSize: "11px", color: "var(--theme-text-gray-500)" }}>Initializing strategy engine...</span>
                  <button
                    className={`${styles.waitingBtn} ${styles.danger}`}
                    type="button"
                    style={{ marginLeft: "auto", padding: "2px 8px", fontSize: "11px" }}
                    onClick={() => {
                      fetch(`/next-api/trades/${encodeURIComponent(t.symbol)}/cancel`, { method: "POST" }).catch(() => {});
                      onCancelWaiting(t.symbol);
                    }}
                  >
                    <XCircle className="w-3 h-3" />
                    Cancel
                  </button>
                </div>
              );
            });
          })()}

          {/* waiting trades — only initialized symbols shown here */}
          {mounted &&
            isHydrated &&
            safeWaitingTrades.filter((t) => initializedSymbols.has(t.symbol)).map((t: WaitingTrade, index: number) => (
              <div key={index} className={styles.trade}>
                <div className={styles.tradeRow}>
                  <div className={styles.tradeSymbol}>{t.symbol}</div>
                </div>

                <div className={styles.waitingActions}>
                  <div className={`${styles.tradeMeta} ${styles.waiting}`}>
                    <span className={styles.dot1}>.</span>
                    <span className={styles.dot2}>.</span>
                    <span className={styles.dot3}>.</span>
                    <span className={styles.w1}>W</span>
                    <span className={styles.w2}>A</span>
                    <span className={styles.w3}>I</span>
                    <span className={styles.w4}>T</span>
                    <span className={styles.w5}>I</span>
                    <span className={styles.w6}>N</span>
                    <span className={styles.w7}>G</span>
                  </div>

                  {forceBuyEnabled && (
                  <button
                    className={`${styles.waitingBtn} ${styles.dark}`}
                    type="button"
                    onClick={() => {
                      fetch(`/next-api/trades/${encodeURIComponent(t.symbol)}/force-buy`, { method: "POST" }).catch(() => {});
                    }}
                  >
                    <Zap className="w-3.5 h-3.5" />
                    Force&nbsp;Buy
                  </button>
                  )}
                  <button
                    className={`${styles.waitingBtn} ${styles.danger}`}
                    type="button"
                    onClick={() => {
                      fetch(`/next-api/trades/${encodeURIComponent(t.symbol)}/cancel`, { method: "POST" }).catch(() => {});
                      onCancelWaiting(t.symbol);
                    }}
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Cancel
                  </button>
                </div>

                {/* Trade Configuration for Waiting Trades */}
                <div className={styles.tradeConfig}>
                  <div className="text-xs" style={{ color: "var(--theme-text-gray-500)" }}>
                    Trades: {t.numberOfTrades} | SL: {t.stopLossNumberEnabled ? t.stopLossNumber : "OFF"} | Target: {t.targetPointsEnabled ? t.targetPoints : "OFF"} | TSL: {t.trailingAfterTargetEnabled ? t.trailingAfterTarget : "OFF"}
                    {t.minToHoldEnabled && ` | Min Target: ${t.minToHold}`}
                  </div>
                </div>
              </div>
            ))}
        </div>
      </CardContent>
    </Card>
  );
}
