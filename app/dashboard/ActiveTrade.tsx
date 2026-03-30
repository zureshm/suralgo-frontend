"use client";

import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Activity, Zap, XCircle } from "lucide-react";
import styles from "./ActiveTrade.module.scss";
import type { ActiveTrade as ActiveTradeType, WaitingTrade } from "../store/TradeStore";
import { useTradeStore } from "../store/TradeStore";

function TradeLogsConsole({ logs }: { logs: string[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevLogsLengthRef = useRef(logs.length);

  useEffect(() => {
    const container = containerRef.current;
    if (container && logs.length > prevLogsLengthRef.current) {
      container.scrollTop = container.scrollHeight;
    }
    prevLogsLengthRef.current = logs.length;
  }, [logs]);

  return (
    <div className={styles.tradeLogs} ref={containerRef}>
      {logs.map((line, i) => (
        <div
          key={i}
          className={styles.logLine}
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
  const { removeTradeAndFreeSymbol } = useTradeStore();

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
                        fetch(`/api/trades/${encodeURIComponent(t.symbol)}/exit`, {
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
                        fetch(`/api/trades/${encodeURIComponent(t.symbol)}/remove`, { method: "POST" }).catch(() => {});
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
                <div className="text-xs text-gray-500">
                  Trades: {t.numberOfTrades} | SL: {t.stopLossNumberEnabled ? t.stopLossNumber : "OFF"} | Target: {t.targetPointsEnabled ? t.targetPoints : "OFF"} | TSL: {t.trailingAfterTargetEnabled ? t.trailingAfterTarget : "OFF"}
                  {t.minToHoldEnabled && ` | Min Target: ${t.minToHold}`}
                </div>
              </div>
            </div>
          ))}

          {/* waiting trades */}
          {mounted &&
            isHydrated &&
            safeWaitingTrades.map((t: WaitingTrade, index: number) => (
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

                  <button
                    className={`${styles.waitingBtn} ${styles.dark}`}
                    type="button"
                    onClick={() => {
                      fetch(`/api/trades/${encodeURIComponent(t.symbol)}/force-buy`, { method: "POST" }).catch(() => {});
                    }}
                  >
                    <Zap className="w-3.5 h-3.5" />
                    Force Buy
                  </button>
                  <button
                    className={`${styles.waitingBtn} ${styles.danger}`}
                    type="button"
                    onClick={() => {
                      fetch(`/api/trades/${encodeURIComponent(t.symbol)}/cancel`, { method: "POST" }).catch(() => {});
                      onCancelWaiting(t.symbol);
                    }}
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Cancel
                  </button>
                </div>

                {/* Trade Configuration for Waiting Trades */}
                <div className={styles.tradeConfig}>
                  <div className="text-xs text-gray-500">
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
