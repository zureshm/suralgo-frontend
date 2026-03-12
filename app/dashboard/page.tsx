"use client";

import styles from "./page.module.scss";
import { useEffect, useState } from "react";
import { searchSymbols, getStrategySignal } from "@/lib/api";
import { useRouter } from "next/navigation";
import { useTradeStore, WaitingTrade } from "../store/TradeStore";
import { useWatchlist, WatchlistItem } from "../store/WatchlistContext";
import { getPrices } from "@/lib/getPrices";

const demoActiveTrades = [
  {
    symbol: "NIFTY 10MAR26 24800 CE",
    pnlText: "+2345.75",
    pnlVariant: "profit" as const,
    actionText: "EXIT",
    actionVariant: "dark" as const,
    logs: [
      "09:31  Condition1 true",
      "09:31  Condition2 true",
      "09:31  BUY signal",
    ],
  },
  {
    symbol: "NIFTY 10MAR26 24900 PE",
    pnlText: "-320.00",
    pnlVariant: "loss" as const,
    actionText: "EXIT",
    actionVariant: "dark" as const,
    logs: [
      "Logs comes here",
      "Logs comes here",
      "Logs comes here",
      "Logs comes here",
      "Logs comes here",
      "Logs comes here",
      "Logs comes here",
      "Logs comes here",
      "Logs comes here",
    ],
  },
];

export default function DashboardPage() {

  const [searchText, setSearchText] = useState("");
  const [suggestions, setSuggestions] = useState<WatchlistItem[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);

  const [strategySignal, setStrategySignal] = useState<any>(null);
  const [lastHandledSignalKey, setLastHandledSignalKey] = useState("");

  const router = useRouter();

  const {
    setSelection,
    waitingTrades,
    removeWaitingTrade,
    activateWaitingTrade,
    completeActiveTrade,
    activeTrades,
    updateActiveTradeBuy,
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

    const isActive = waitingTrades.some((t) => t.symbol === row.symbol);

    const buttonClass = isActive
      ? `${styles.symbolButton} ${styles.active}`
      : styles.symbolButton;

    return (
      <div key={row.symbol} className={styles.row}>
        <button
          className={buttonClass}
          type="button"
          onClick={() => {
            setSelection({
              symbol: row.symbol,
              price: String(row.ltp ?? ""),
            });
            router.push("/trade");
          }}
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
            {demoActiveTrades.map((t) => (
              <div key={t.symbol} className={styles.trade}>

                <div className={styles.tradeRow}>

                  <div className={styles.tradeSymbol}>{t.symbol}</div>

                  <div className={styles.tradeRight}>

                    <div
                      className={`${styles.tradeMeta} ${t.pnlVariant === "profit" ? styles.profit : styles.loss
                        }`}
                    >
                      {t.pnlText}
                    </div>

                    <button
                      className={`${styles.tradeAction} ${styles.dark}`}
                      type="button"
                    >
                      {t.actionText}
                    </button>

                  </div>

                </div>

                {t.logs.length > 0 && (
                  <div className={styles.tradeLogs}>
                    {t.logs.map((line, i) => (
                      <div key={i} className={styles.logLine}>
                        {line}
                      </div>
                    ))}
                  </div>
                )}

              </div>
            ))}

            {/* real active trades */}
            {activeTrades.map((t) => (
              <div key={t.symbol} className={styles.trade}>

                <div className={styles.tradeRow}>

                  <div className={styles.tradeSymbol}>{t.symbol}</div>

                  <div className={styles.tradeRight}>

                    <div
                      className={`${styles.tradeMeta} ${t.pnl >= 0 ? styles.profit : styles.loss
                        }`}
                    >
                      {t.pnl.toFixed(2)}
                    </div>

                    <button
                      className={`${styles.tradeAction} ${styles.dark}`}
                      type="button"
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

        <div className={styles.bottomActions}>

          <button
            className={styles.bottomBtn}
            type="button"
            onClick={() => router.push("/account-details")}
          >
            ACCOUNT DETAILS
          </button>

          <button
            className={styles.bottomBtn}
            type="button"
            onClick={() => router.push("/trade-history")}
          >
            TRADE HISTORY
          </button>

        </div>

      </div>

    </div>
  );
}