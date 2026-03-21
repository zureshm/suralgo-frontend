"use client";

import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Activity } from "lucide-react";
import styles from "./ActiveTrade.module.scss";
import type { ActiveTrade as ActiveTradeType, WaitingTrade } from "../store/TradeStore";
import { useTradeStore } from "../store/TradeStore";

function TradeLogsConsole({ logs }: { logs: string[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
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
                /at (\d{2}:\d{2})/g,
                `at <span class="${styles.cyanTime}">$1</span>`
              )
              .replace(
                /Trade P\/L: (-?\d+(?:\.\d+)?)/g,
                (match, plValue) => {
                  const isProfit = !plValue.startsWith("-");
                  const className = isProfit ? styles.plProfit : styles.plLoss;
                  return `<span class="${className}">Trade P/L: ${plValue}</span>`;
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
  const [exitClicked, setExitClicked] = useState<Record<string, boolean>>({});
  const { removeTradeAndFreeSymbol, getLastStrategyCandleTime } = useTradeStore();

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

                  {!exitClicked[t.symbol] && t.status === "ACTIVE" && (
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

                        const lastCandleTime =
                          getLastStrategyCandleTime() ||
                          new Date().toLocaleTimeString("en-IN", {
                            hour: "2-digit",
                            minute: "2-digit",
                          }).replace("am", "").replace("pm", "");

                        onManualExit(t.symbol, String(ltp ?? ""), livePnl, lastCandleTime);
                        setExitClicked((prev) => ({ ...prev, [t.symbol]: true }));
                      }}
                    >
                      EXIT
                    </button>
                  )}
                  {(exitClicked[t.symbol] || t.status === "COMPLETED") && (
                    <button
                      className={`${styles.tradeAction} ${styles.danger}`}
                      type="button"
                      onClick={() => {
                        removeTradeAndFreeSymbol(t.symbol);
                        setExitClicked((prev) => {
                          const next = { ...prev };
                          delete next[t.symbol];
                          return next;
                        });
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

                  <div className={styles.tradeRight}>
                    <div className={`${styles.tradeMeta} ${styles.waiting}`}>
                      {t.stateText}
                    </div>

                    <button
                      className={`${styles.tradeAction} ${styles.danger}`}
                      type="button"
                      onClick={() => onCancelWaiting(t.symbol)}
                    >
                      CANCEL
                    </button>
                  </div>
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
