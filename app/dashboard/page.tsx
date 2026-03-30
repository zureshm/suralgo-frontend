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
  // Time range guard: skip BUY if outside configured range
  if (trade.rangeEnabled && strategyData.lastCandleTime) {
    const tMatch = String(strategyData.lastCandleTime).match(/(\d{1,2}):(\d{2})/);
    if (tMatch) {
      const cMin = Number(tMatch[1]) * 60 + Number(tMatch[2]);
      let fromH = Number(String(trade.timeFrom).match(/(\d{1,2})/)?.[1] ?? 0);
      const fromM = Number(String(trade.timeFrom).match(/:(\d{2})/)?.[1] ?? 0);
      if (trade.timeFromAmpm === "pm" && fromH < 12) fromH += 12;
      if (trade.timeFromAmpm === "am" && fromH === 12) fromH = 0;
      let toH = Number(String(trade.timeTo).match(/(\d{1,2})/)?.[1] ?? 0);
      const toM = Number(String(trade.timeTo).match(/:(\d{2})/)?.[1] ?? 0);
      if (trade.timeToAmpm === "pm" && toH < 12) toH += 12;
      if (trade.timeToAmpm === "am" && toH === 12) toH = 0;
      const rangeStart = fromH * 60 + fromM;
      const rangeEnd = toH * 60 + toM;
      if (cMin < rangeStart || cMin > rangeEnd) {
        continue;
      }
    }
  }
  const entryPrice = String(strategyData.close ?? trade.price);
  const logLine = `BUY triggered for ₹${entryPrice} at ${strategyData.lastCandleTime || "unknown time"}`;
  activateWaitingTrade(
    trade.symbol,
    entryPrice,
    logLine,
  );
  // Tell server to also activate so syncFromServer doesn't wipe it
  fetch(`/api/trades/${encodeURIComponent(trade.symbol)}/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entryPrice, logLine }),
  }).catch(() => {});
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