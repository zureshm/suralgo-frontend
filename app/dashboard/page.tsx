"use client";

import styles from "./page.module.scss";
import { useEffect, useState } from "react";
import { getStrategyEvaluation } from "@/lib/api";
import { useTradeStore } from "../store/TradeStore";
import { getPrices } from "@/lib/getPrices";
import TradeHistory from "./TradeHistory";
import AccountDetails from "./AccountDetails";
import ConnectionStatus from "./ConnectionStatus";
import Watchlist from "./Watchlist";
import ActiveTrade from "./ActiveTrade";

export default function DashboardPage() {
  const [isHydrated, setIsHydrated] = useState(false);
  const [activeLtps, setActiveLtps] = useState<Record<string, number>>({});
  const [strategyBySymbol, setStrategyBySymbol] = useState<Record<string, any>>(
    {}
  );

  const {
    waitingTrades,
    removeWaitingTrade,
    activeTrades,
    logManualExit,
    activateWaitingTrade,
  } = useTradeStore();

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  const waitingTradeSymbols = waitingTrades.map((trade) => trade.symbol).join("|");

useEffect(() => {
  if (waitingTrades.length === 0) {
    return;
  }

  const fetchStrategySignals = async () => {
    const next: Record<string, any> = {};

    for (const trade of waitingTrades) {
      try {
        // Debug exact symbol match between waiting trade and strategy response
        const data = await getStrategyEvaluation(trade.symbol);
        next[trade.symbol] = data;
        console.log("Strategy check:", {
          requestedSymbol: trade.symbol,
          responseSymbol: data.symbol,
          signal: data.signal,
          engineStatus: data.engineStatus,
        });
      } catch (error) {
        console.error("Strategy fetch failed for:", trade.symbol, error);
      }
    }

    setStrategyBySymbol(next);
  };

  fetchStrategySignals();

  const interval = setInterval(fetchStrategySignals, 1000);

  return () => clearInterval(interval);
}, [waitingTradeSymbols]);

useEffect(() => {
  if (waitingTrades.length === 0) {
    return;
  }

  for (const trade of waitingTrades) {
    const strategyData = strategyBySymbol[trade.symbol];

    if (!strategyData) {
      continue;
    }

   if (strategyData.signal === "BUY") {
  activateWaitingTrade(
    trade.symbol,
    String(trade.price),
    `BUY triggered by strategy at ${strategyData.lastCandleTime || "unknown time"}`
  );
}
  }
}, [strategyBySymbol, waitingTrades, activateWaitingTrade]);

  // LTP polling kept for unrealized P&L display in UI
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
        <ConnectionStatus />

        <Watchlist />

        <ActiveTrade
          activeTrades={activeTrades}
          waitingTrades={waitingTrades}
          activeLtps={activeLtps}
          isHydrated={isHydrated}
          strategyLastCandleTime={undefined}
          onManualExit={logManualExit}
          onCancelWaiting={removeWaitingTrade}
        />

        <TradeHistory />

        <AccountDetails />

        <div className={styles.bottomActions}></div>
      </div>
    </div>
  );
}