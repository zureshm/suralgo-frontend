"use client";

import styles from "./page.module.scss";
import { useEffect, useState, useRef } from "react";
import { useTradeStore, WaitingTrade } from "../store/TradeStore";
import { getPrices } from "@/lib/getPrices";
import TradeHistory from "./TradeHistory";
import AccountDetails from "./AccountDetails";
import ConnectionStatus from "./ConnectionStatus";
import Watchlist from "./Watchlist";
import ActiveTrade from "./ActiveTrade";

export default function DashboardPage() {

  const [isHydrated, setIsHydrated] = useState(false);
  const [activeLtps, setActiveLtps] = useState<Record<string, number>>({});
  const triggeredPositions = useRef<Set<string>>(new Set());
  const armedPositions = useRef<Set<string>>(new Set());
  const trailingArmedPositions = useRef<Set<string>>(new Set());

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  const {
    waitingTrades,
    removeWaitingTrade,
    activeTrades,
    removeActiveTrade,
    addTradeHistoryEntry,
    logManualExit,
    completeCycleWithoutExit,
    lastStrategyCandleTime,
  } = useTradeStore();

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

  // Monitor stop loss and target hits
  useEffect(() => {
    activeTrades.forEach((trade) => {
      // Clean up triggered positions for trades that are no longer in position
      if (!trade.inPosition) {
        const positionKey = `${trade.symbol}-${trade.entryPrice}`;
        triggeredPositions.current.delete(positionKey);
        armedPositions.current.delete(positionKey);
        trailingArmedPositions.current.delete(positionKey);
        return;
      }

      // Only check for trades that are in position and ACTIVE
      if (trade.status !== "ACTIVE") return;

      const ltp = activeLtps[trade.symbol];
      const entry = Number(trade.entryPrice);

      if (!Number.isFinite(ltp) || !Number.isFinite(entry)) return;

      // Create unique key for this position
      const positionKey = `${trade.symbol}-${trade.entryPrice}`;

      // Arm monitoring only after the first seen LTP for a new position,
      // so an old cached LTP from the previous cycle cannot instantly trigger SL/Target.
      if (!armedPositions.current.has(positionKey)) {
        armedPositions.current.add(positionKey);
        return;
      }

      // Skip if already triggered for this position
      if (triggeredPositions.current.has(positionKey)) return;

      const priceDiff = ltp - entry;

      const currentTime =
        lastStrategyCandleTime ||
        new Date().toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
        }).replace("am", "").replace("pm", "");

      // Trailing before target (Minimum Target) logic
      if (trade.minToHoldEnabled && trade.minToHold > 0) {
        const trailLevel = entry + trade.minToHold;
        const activationLevel = trailLevel + 2; // activate trailing after trail level + 2 points

        // Activate trailing once price reaches activation level
        if (!trailingArmedPositions.current.has(positionKey)) {
          if (ltp >= activationLevel) {
            trailingArmedPositions.current.add(positionKey);
          }
        } else {
          // Once trailing is armed, if price falls back to or below the trail level,
          // lock in the minimum target and complete the cycle.
          if (ltp <= trailLevel) {
            triggeredPositions.current.add(positionKey);
            trailingArmedPositions.current.delete(positionKey);
            completeCycleWithoutExit(
              trade.symbol,
              String(ltp),
              `MINIMUM TARGET hit for ₹${ltp} at ${currentTime}`
            );
            return;
          }
        }
      } else {
        trailingArmedPositions.current.delete(positionKey);
      }

      // Check if target hit
      if (
        trade.targetPointsEnabled &&
        trade.targetPoints > 0 &&
        priceDiff >= trade.targetPoints
      ) {
        triggeredPositions.current.add(positionKey);
        completeCycleWithoutExit(
          trade.symbol,
          String(ltp),
          `TARGET hit for ₹${ltp} at ${currentTime}`
        );
        return;
      }

      // Check if stop loss hit
      if (
        trade.stopLossNumberEnabled &&
        trade.stopLossNumber > 0 &&
        priceDiff <= -trade.stopLossNumber
      ) {
        triggeredPositions.current.add(positionKey);
        completeCycleWithoutExit(
          trade.symbol,
          String(ltp),
          `STOPLOSS hit for ₹${ltp} at ${currentTime}`
        );
        return;
      }
    });
  }, [activeLtps, activeTrades, completeCycleWithoutExit, lastStrategyCandleTime]);

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

        <div className={styles.bottomActions}>

        </div>

      </div>

    </div>
  );
}