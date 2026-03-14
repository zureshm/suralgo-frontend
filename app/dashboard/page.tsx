"use client";

import styles from "./page.module.scss";
import { useEffect, useState } from "react";
import { getStrategySignal } from "@/lib/api";
import { useTradeStore, WaitingTrade } from "../store/TradeStore";
import { getPrices } from "@/lib/getPrices";
import TradeHistory from "./TradeHistory";
import AccountDetails from "./AccountDetails";
import ConnectionStatus from "./ConnectionStatus";
import Watchlist from "./Watchlist";
import ActiveTrade from "./ActiveTrade";

export default function DashboardPage() {

  const [isHydrated, setIsHydrated] = useState(false);
  const [strategySignal, setStrategySignal] = useState<any>(null);
  const [lastHandledSignalKey, setLastHandledSignalKey] = useState("");
  const [activeLtps, setActiveLtps] = useState<Record<string, number>>({});

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  const {
    waitingTrades,
    removeWaitingTrade,
    activateWaitingTrade,
    completeActiveTrade,
    activeTrades,
    updateActiveTradeBuy,
    removeActiveTrade,
    addTradeHistoryEntry,
    logManualExit,
  } = useTradeStore();

  // polling strategy
  useEffect(() => {

    const fetchStrategySignal = async () => {
      const data = await getStrategySignal();
      setStrategySignal(data);
    };

    fetchStrategySignal();

    const interval = setInterval(fetchStrategySignal, 1000);

    return () => clearInterval(interval);

  }, []);

  useEffect(() => {
    if (activeTrades.length === 0) return;

    const fetchActivePrices = async () => {
      const symbols = activeTrades.map((t) => t.symbol);
      const latestPrices = await getPrices(symbols);

      setActiveLtps((prev) => {
        const next = { ...prev };
        for (const p of latestPrices) {
          if (!p?.symbol) continue;
          const ltpNum = Number(p.ltp);
          if (Number.isFinite(ltpNum)) {
            next[p.symbol] = ltpNum;
          }
        }
        return next;
      });
    };

    fetchActivePrices();
    const interval = setInterval(fetchActivePrices, 1000);
    return () => clearInterval(interval);
  }, [activeTrades]);

  useEffect(() => {

    if (!strategySignal) return;
    const latestClose =
      strategySignal.close ??
      strategySignal.candles?.[strategySignal.candles.length - 1]?.close;

    // handle SELL signal (close cycle in active trade)
    if (strategySignal.signal === "SELL") {

      const signalKey =
        strategySignal.signal + "-" + strategySignal.lastCandleTime;

      if (signalKey === lastHandledSignalKey) return;

      const active = activeTrades.find(
        (t) => t.symbol === strategySignal.symbol && t.status === "ACTIVE"
      );

      if (!active) return;

      completeActiveTrade(
        active.symbol,
        String(latestClose ?? ""),
        "SELL triggered for ₹"+ String(latestClose ?? "") + " at " + strategySignal.lastCandleTime
      );

      setLastHandledSignalKey(signalKey);
      return;
    }

    // handle WAIT signal (log wait in active trade)
    if (strategySignal.signal === "WAIT") {
      const signalKey =
        strategySignal.signal + "-" + strategySignal.lastCandleTime;

      if (signalKey === lastHandledSignalKey) return;

      const active = activeTrades.find(
        (t) => t.symbol === strategySignal.symbol && t.status === "ACTIVE"
      );

      if (active) {
        // Update active trade logs with WAIT - this should be handled in store
        // For now, we'll just continue with the existing logic
      }

      setLastHandledSignalKey(signalKey);
      return;
    }

    // handle BUY signal
    if (strategySignal.signal === "BUY") {
      const signalKey =
        strategySignal.signal + "-" + strategySignal.lastCandleTime;

      if (signalKey === lastHandledSignalKey) return;

      const matchingTrade = waitingTrades.find(
        (t) => t.symbol === strategySignal.symbol
      );

      // If waiting trade exists, activate it
      if (matchingTrade) {
        activateWaitingTrade(
          matchingTrade.symbol,
          String(latestClose ?? ""),
          "BUY triggered for ₹ " + String(latestClose ?? "") + " at " + strategySignal.lastCandleTime
        );
      } else {
        // If already active, update entry price for next cycle
        const active = activeTrades.find(
          (t) => t.symbol === strategySignal.symbol && t.status === "ACTIVE"
        );

        if (active) {
          updateActiveTradeBuy(
            active.symbol,
            String(latestClose ?? ""),
            "BUY triggered for ₹ " + String(latestClose ?? "") + " at " + strategySignal.lastCandleTime
          );
        }
      }

      setLastHandledSignalKey(signalKey);
    }

  }, [
    strategySignal,
    waitingTrades,
    activeTrades,
    activateWaitingTrade,
    completeActiveTrade,
    updateActiveTradeBuy,
  ]);

  return (
    <div className={styles.page}>
      <div className={styles.container}>

        <header className={styles.header}>

          <ConnectionStatus />

        </header>

        <Watchlist />

        <h2 className={styles.sectionTitle}>ACTIVE TRADES</h2>

        <div className={styles.card}>

          <div className={styles.activeTrades}>

            {/* dummy trades */}
            {activeTrades.length === 0 && (
              <div className={styles.empty}>No active trades</div>
            )}

            {/* real active trades */}
            {activeTrades.map((t) => (
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
                          className={`${styles.tradeMeta} ${livePnl >= 0 ? styles.profit : styles.loss
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

                        // Use backend time from strategy signal
                        const lastCandleTime = strategySignal?.lastCandleTime || new Date().toLocaleTimeString('en-IN', { 
                          hour: '2-digit', 
                          minute: '2-digit' 
                        });

                        // Just log manual exit, don't remove trade
                        logManualExit(t.symbol, String(ltp ?? ""), livePnl, lastCandleTime);
                      }}
                    >
                      EXIT
                    </button>

                  </div>

                </div>

                {t.logs.length > 0 && (
                  <div className={styles.tradeLogs}>
                    {t.logs.map((line, i) => (
                      <div key={i} className={styles.logLine} dangerouslySetInnerHTML={{
                        __html: line.replace(/₹ ?(\d+(?:\.\d+)?)/g, `<span class="${styles.rsGold}">₹$1</span>`)
                                  .replace(/at (\d{2}:\d{2})/g, `at <span class="${styles.cyanTime}">$1</span>`)
                                  .replace(/Trade P\/L: (-?\d+(?:\.\d+)?)/g, (match, plValue) => {
                                    const isProfit = !plValue.startsWith('-');
                                    const className = isProfit ? styles.plProfit : styles.plLoss;
                                    return `<span class="${className}">Trade P/L: ${plValue}</span>`;
                                  })
                      }} />
                    ))}
                  </div>
                )}

              </div>
            ))}

            {/* waiting trades */}
            {isHydrated &&
              waitingTrades.map((t: WaitingTrade, index: number) => (
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
                        onClick={() => removeWaitingTrade(t.symbol)}
                      >
                        CANCEL
                      </button>

                    </div>

                  </div>

                </div>
              ))}
          </div>

        </div>

        <ActiveTrade
          activeTrades={activeTrades}
          waitingTrades={waitingTrades}
          activeLtps={activeLtps}
          isHydrated={isHydrated}
          strategyLastCandleTime={strategySignal?.lastCandleTime}
          onManualExit={logManualExit}
          onCancelWaiting={removeWaitingTrade}
        />

        <TradeHistory />

        <AccountDetails />

        <div className={styles.bottomActions}>

        </div>

      </div>

    </div>
  );
}