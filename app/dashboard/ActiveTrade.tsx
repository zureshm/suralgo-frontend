"use client";

import { useEffect, useState } from "react";
import styles from "./ActiveTrade.module.scss";
import type { ActiveTrade as ActiveTradeType, WaitingTrade } from "../store/TradeStore";

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

  useEffect(() => {
    setMounted(true);
  }, []);

  const safeActiveTrades = mounted ? activeTrades : [];
  const safeWaitingTrades = mounted ? waitingTrades : [];

  return (
    <>
      <h2 className={styles.sectionTitle}>ACTIVE TRADES (COMPONENT)</h2>

      <div className={styles.card}>
        <div className={styles.activeTrades}>
          {/* dummy trades */}
          {safeActiveTrades.length === 0 && (
            <div className={styles.empty}>No active trades</div>
          )}

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
                        strategyLastCandleTime ||
                        new Date().toLocaleTimeString("en-IN", {
                          hour: "2-digit",
                          minute: "2-digit",
                        });

                      onManualExit(t.symbol, String(ltp ?? ""), livePnl, lastCandleTime);
                    }}
                  >
                    EXIT
                  </button>
                </div>
              </div>

              {t.logs.length > 0 && (
                <div className={styles.tradeLogs}>
                  {t.logs.map((line, i) => (
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
                              const className = isProfit
                                ? styles.plProfit
                                : styles.plLoss;
                              return `<span class="${className}">Trade P/L: ${plValue}</span>`;
                            }
                          ),
                      }}
                    />
                  ))}
                </div>
              )}
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
              </div>
            ))}
        </div>
      </div>
    </>
  );
}
