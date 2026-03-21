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
    addLogToWaitingTrade,
    addLogToActiveTrade,
    updateLastSellCandleTime,
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
    const latestCloseNumber = Number(latestClose ?? NaN);

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

      // If trailing-after-target is enabled, skip — dashboard LTP monitor handles it
      if (
        active.trailingAfterTargetEnabled &&
        active.trailingAfterTarget > 0
      ) {
        setLastHandledSignalKey(signalKey);
        return;
      }

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

      // Update lastSellCandleTime for wait-after-sell strategy
      updateLastSellCandleTime(active.symbol, strategySignal.lastCandleTime);

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

      // Candle size check for Wait Strategy (buyOverride)
      const candles = strategySignal.candles;
      const prevCandle = Array.isArray(candles) && candles.length > 0
        ? candles[candles.length - 1]
        : null;
      const candleSize = prevCandle
        ? Math.abs(Number(prevCandle.close) - Number(prevCandle.open))
        : 0;

      // --- Time range check — log skip to custom console, do NOT block ---
      const tradeForRange = matchingTrade ?? (activeForSymbol && !activeForSymbol.inPosition ? activeForSymbol : null);
      if (tradeForRange && tradeForRange.rangeEnabled) {
        const toMinutes12h = (timeStr: string, ampm: string): number => {
          const match = String(timeStr).match(/(\d{1,2}):(\d{2})/);
          if (!match) return -1;
          let h = Number(match[1]);
          const m = Number(match[2]);
          if (ampm === "pm" && h < 12) h += 12;
          if (ampm === "am" && h === 12) h = 0;
          return h * 60 + m;
        };
        const parseCandleTime = (raw: string): number => {
          const match = String(raw).match(/(\d{1,2}):(\d{2})/);
          if (!match) return -1;
          return Number(match[1]) * 60 + Number(match[2]);
        };

        const rangeStart = toMinutes12h(tradeForRange.timeFrom, tradeForRange.timeFromAmpm);
        const rangeEnd = toMinutes12h(tradeForRange.timeTo, tradeForRange.timeToAmpm);
        const candleMinutes = parseCandleTime(strategySignal.lastCandleTime ?? "");

        if (candleMinutes >= 0 && (candleMinutes < rangeStart || candleMinutes > rangeEnd)) {
          const skippedLog = `BUY skipped – outside time range (${tradeForRange.timeFrom} ${tradeForRange.timeFromAmpm} – ${tradeForRange.timeTo} ${tradeForRange.timeToAmpm}) for ₹${latestClose ?? ""} at ${strategySignal.lastCandleTime}`;
          if (matchingTrade) {
            addLogToWaitingTrade(matchingTrade.symbol, skippedLog);
          } else if (activeForSymbol && !activeForSymbol.inPosition) {
            addLogToActiveTrade(activeForSymbol.symbol, skippedLog);
          }
          setLastHandledSignalKey(signalKey);
          return;
        }
      }

      // Wait-after-SELL check: skip BUY if not enough candles have passed
      const tradeForWaitCheck = matchingTrade ?? (activeForSymbol && !activeForSymbol.inPosition ? activeForSymbol : null);
      if (tradeForWaitCheck && tradeForWaitCheck.waitAfterSellEnabled && activeForSymbol?.lastSellCandleTime) {
        const parseCandleTimeForComparison = (raw: string): number => {
          const match = String(raw).match(/(\d{1,2}):(\d{2})/);
          if (!match) return -1;
          return Number(match[1]) * 60 + Number(match[2]);
        };

        const lastSellMinutes = parseCandleTimeForComparison(activeForSymbol.lastSellCandleTime);
        const currentCandleMinutes = parseCandleTimeForComparison(strategySignal.lastCandleTime ?? "");
        
        if (lastSellMinutes >= 0 && currentCandleMinutes >= 0) {
          const candlesPassed = currentCandleMinutes - lastSellMinutes;
          if (candlesPassed < tradeForWaitCheck.waitAfterSellCandles) {
            const waitLog = `BUY skipped – waiting ${tradeForWaitCheck.waitAfterSellCandles} candles after SELL (${candlesPassed} passed) at ${strategySignal.lastCandleTime}`;
            if (matchingTrade) {
              addLogToWaitingTrade(matchingTrade.symbol, waitLog);
            } else if (activeForSymbol && !activeForSymbol.inPosition) {
              addLogToActiveTrade(activeForSymbol.symbol, waitLog);
            }
            setLastHandledSignalKey(signalKey);
            return;
          }
        }
      }

      const overrideValue = matchingTrade?.buyOverride ?? activeForSymbol?.buyOverride;

      if (overrideValue != null && overrideValue > 0 && candleSize >= overrideValue) {
        const ignoredLog =
          `BUY ignored – candle size ${candleSize.toFixed(2)} >= buyOverride ${overrideValue} at ${strategySignal.lastCandleTime}`;

        if (matchingTrade) {
          addLogToWaitingTrade(matchingTrade.symbol, ignoredLog);
        } else if (activeForSymbol && !activeForSymbol.inPosition) {
          addLogToActiveTrade(activeForSymbol.symbol, ignoredLog);
        }

        setLastHandledSignalKey(signalKey);
        return;
      }

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
    addLogToWaitingTrade,
    addLogToActiveTrade,
    updateLastSellCandleTime,
  ]);

  return <>{children}</>;
}
