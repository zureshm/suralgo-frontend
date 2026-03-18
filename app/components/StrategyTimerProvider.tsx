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
    completeCycleWithoutExit,
    activeTrades,
    updateActiveTradeBuy,
    setLastStrategyCandleTime,
  } = useTradeStore();
  const [strategySignal, setStrategySignal] = useState<any>(null);
  const [lastHandledSignalKey, setLastHandledSignalKey] = useState("");

  // Global strategy polling - runs everywhere
  useEffect(() => {
    const fetchStrategySignal = async () => {
      const data = await getStrategySignal();
      if (data) {
        console.log("Strategy engine payload", {
          symbol: data.symbol,
          signal: data.signal,
          lastCandleTime: data.lastCandleTime,
          close: data.close,
          candles: data.candles,
        });
      } else {
        console.log("Strategy engine returned empty payload");
      }
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

    const signalSymbol = strategySignal.symbol;
    const activeForSymbol = activeTrades.find(
      (t) => t.symbol === signalSymbol && t.status === "ACTIVE"
    );
    const hasWaitingTrade = waitingTrades.some(
      (t) => t.symbol === signalSymbol
    );
    const waitingForBuy =
      (!activeForSymbol || !activeForSymbol.inPosition) &&
      (hasWaitingTrade || Boolean(activeForSymbol));
    const waitingForSell = Boolean(activeForSymbol && activeForSymbol.inPosition);

    // Update the strategy candle time for manual exits
    const candleTime =
      strategySignal.lastCandleTime ||
      strategySignal.candles?.[strategySignal.candles.length - 1]?.time;
    if (candleTime) {
      setLastStrategyCandleTime(candleTime);
    }

    // handle STOPLOSS signal
    if (strategySignal.signal === "STOPLOSS") {
      const signalKey =
        strategySignal.signal + "-" + strategySignal.lastCandleTime;

      if (signalKey === lastHandledSignalKey) return;

      const active = activeForSymbol;

      if (!active || !active.inPosition) return;

      completeCycleWithoutExit(
        active.symbol,
        String(latestClose ?? ""),
        "STOPLOSS hit for ₹"+ String(latestClose ?? "") + " at " + strategySignal.lastCandleTime
      );

      setLastHandledSignalKey(signalKey);
      return;
    }

    // handle TARGET signal
    if (strategySignal.signal === "TARGET") {
      const signalKey =
        strategySignal.signal + "-" + strategySignal.lastCandleTime;

      if (signalKey === lastHandledSignalKey) return;

      const active = activeForSymbol;

      if (!active || !active.inPosition) return;

      completeCycleWithoutExit(
        active.symbol,
        String(latestClose ?? ""),
        "TARGET hit for ₹"+ String(latestClose ?? "") + " at " + strategySignal.lastCandleTime
      );

      setLastHandledSignalKey(signalKey);
      return;
    }

    // handle SELL signal
    if (strategySignal.signal === "SELL") {
      const signalKey =
        strategySignal.signal + "-" + strategySignal.lastCandleTime;

      if (signalKey === lastHandledSignalKey) return;
      if (waitingForBuy) return;

      const active = activeForSymbol;

      if (!active || !active.inPosition) return;

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

      const active = activeForSymbol;

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
      if (waitingForSell) return;

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
        const active = activeForSymbol;

        // Only allow additional BUY if not already in position
        if (active && !active.inPosition) {
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
    completeCycleWithoutExit,
    updateActiveTradeBuy,
    setLastStrategyCandleTime,
  ]);

  return <>{children}</>;
}
