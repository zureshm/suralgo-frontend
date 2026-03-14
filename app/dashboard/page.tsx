"use client";

import styles from "./page.module.scss";
import { useEffect, useState } from "react";
import { searchSymbols, getStrategySignal } from "@/lib/api";
import { useRouter } from "next/navigation";
import { useTradeStore, WaitingTrade } from "../store/TradeStore";
import { useWatchlist, WatchlistItem } from "../store/WatchlistContext";
import { getPrices } from "@/lib/getPrices";
import TradeHistory from "./TradeHistory";
import AccountDetails from "./AccountDetails";



export default function DashboardPage() {

  const [searchText, setSearchText] = useState("");
  const [suggestions, setSuggestions] = useState<WatchlistItem[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);

  const [strategySignal, setStrategySignal] = useState<any>(null);
  const [lastHandledSignalKey, setLastHandledSignalKey] = useState("");
  const [activeLtps, setActiveLtps] = useState<Record<string, number>>({});

  const router = useRouter();

  const {
    setSelection,
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

  const {
    watchlist,
    addToWatchlist,
    removeFromWatchlist,
    updateWatchlistPrices,
  } = useWatchlist();

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  const watchlistItems = watchlist.map((row) => {

    const isWaiting = waitingTrades.some((t) => t.symbol === row.symbol);
    const isRunning = activeTrades.some((t) => t.symbol === row.symbol);

    const buttonClass = isWaiting
      ? `${styles.symbolButton} ${styles.active}`
      : isRunning
      ? `${styles.symbolButton} ${styles.running}`
      : styles.symbolButton;

    return (
      <div key={row.symbol} className={styles.row}>
        <button
          className={buttonClass}
          type="button"
          onClick={isRunning ? undefined : () => {
            setSelection({
              symbol: row.symbol,
              price: String(row.ltp ?? ""),
            });
            router.push("/trade");
          }}
          style={isRunning ? { pointerEvents: "none" } : {}}
        >
          {row.symbol}
        </button>

        <div className={styles.ltp}>{row.ltp ?? "-"}</div>

        <button
          className={styles.trash}
          type="button"
          onClick={() => removeFromWatchlist(row.symbol)}
        >
          🗑️
        </button>
      </div>
    );
  });

  useEffect(() => {

    if (watchlist.length === 0) return;

    const fetchPrices = async () => {

      const symbols = watchlist.map((item) => item.symbol);

      const latestPrices = await getPrices(symbols);

      updateWatchlistPrices(latestPrices);
    };

    fetchPrices();

    const interval = setInterval(fetchPrices, 1000);

    return () => clearInterval(interval);

  }, [watchlist.length]);

  useEffect(() => {

    const text = searchText.trim();

    if (!text) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {

      try {

        const data: WatchlistItem[] = await searchSymbols(text);

        const filtered = data.filter((item) =>
          item.symbol.toLowerCase().includes(text.toLowerCase())
        );

        setSuggestions(filtered.slice(0, 8));

      } catch {

        setSuggestions([]);

      }

    }, 300);

    return () => clearTimeout(timer);

  }, [searchText]);

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

  // trigger waiting → active or update active trade
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

  return (
    <div className={styles.page}>
      <div className={styles.container}>

        <header className={styles.header}>

          <input
            className={styles.search}
            placeholder="Search symbol"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />

          <button
            className={styles.addBtn}
            type="button"
            onClick={() => {
              if (suggestions.length > 0) {
                addToWatchlist(suggestions[0]);
                setSearchText("");
                setSuggestions([]);
              }
            }}
          >
            ADD
          </button>

          {suggestions.length > 0 && (
            <div className={styles.suggestions}>
              {suggestions.map((item) => (
                <button
                  key={item.symbol}
                  type="button"
                  className={styles.suggestionItem}
                  onClick={() => {
                    addToWatchlist(item);
                    setSearchText("");
                    setSuggestions([]);
                  }}
                >
                  {item.symbol}
                </button>
              ))}
            </div>
          )}

        </header>

        <h2 className={styles.sectionTitle}>WATCHLIST</h2>

        <div className={styles.card}>

          <div className={styles.tableHeader}>
            <div className={styles.thLeft}>SYMBOL</div>
            <div className={styles.thRight}>LTP</div>
            <div className={styles.thIcon} />
          </div>

          <hr />

          <div className={styles.rows}>

            {!isHydrated ? (
              <div className={styles.empty}>Loading watchlist...</div>
            ) : !watchlist.length ? (
              <div className={styles.empty}>No symbols in watchlist</div>
            ) : (
              watchlistItems
            )}

          </div>

        </div>

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

        <TradeHistory />

        <AccountDetails />

        <div className={styles.bottomActions}>

        </div>

      </div>

    </div>
  );
}