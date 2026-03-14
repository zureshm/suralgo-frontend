"use client";

import { useEffect, useState } from "react";
import { getStrategySignal } from "@/lib/api";
import { useTradeStore } from "../store/TradeStore";

export function StrategyTimerProvider({ children }: { children: React.ReactNode }) {
  const {
    waitingTrades,
    removeWaitingTrade,
    activateWaitingTrade,
    completeActiveTrade,
    activeTrades,
    updateActiveTradeBuy,
  } = useTradeStore();
  const [strategySignal, setStrategySignal] = useState<any>(null);
  const [lastHandledSignalKey, setLastHandledSignalKey] = useState("");

  // Global strategy polling - runs everywhere
  useEffect(() => {
    const fetchStrategySignal = async () => {
      const data = await getStrategySignal();
      setStrategySignal(data);
    };

    fetchStrategySignal();
    const interval = setInterval(fetchStrategySignal, 1000);

    return () => clearInterval(interval);
  }, []);

  // Handle strategy signals - same logic as dashboard
  useEffect(() => {
    if (!strategySignal) return;
    const latestClose =
      strategySignal.close ??
      strategySignal.candles?.[strategySignal.candles.length - 1]?.close;

    // handle SELL signal
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

    // handle WAIT signal
    if (strategySignal.signal === "WAIT") {
      const signalKey =
        strategySignal.signal + "-" + strategySignal.lastCandleTime;

      if (signalKey === lastHandledSignalKey) return;

      const active = activeTrades.find(
        (t) => t.symbol === strategySignal.symbol && t.status === "ACTIVE"
      );

      if (active) {
        // Could add WAIT logging here if needed
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

      if (matchingTrade) {
        activateWaitingTrade(
          matchingTrade.symbol,
          String(latestClose ?? ""),
          "BUY triggered for ₹ " + String(latestClose ?? "") + " at " + strategySignal.lastCandleTime
        );
      } else {
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

  return <>{children}</>;
}
