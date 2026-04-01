"use client";

import React, { createContext, useContext, useCallback, useMemo, useRef, useState } from "react";

type TradeSelection = {
  symbol: string;
  price: string;
} | null;

export type WaitingTrade = {
  symbol: string;
  price: string;
  stateText: string;
  logs: string[];
  lotSize: number;
  lotValue: number;
  numberOfTrades: number;
  stopLossNumberEnabled: boolean;
  stopLossNumber: number;
  targetPointsEnabled: boolean;
  targetPoints: number;
  minToHoldEnabled: boolean;
  minToHold: number;
  trailingAfterTargetEnabled: boolean;
  trailingAfterTarget: number;
  rangeEnabled: boolean;
  timeFrom: string;
  timeFromAmpm: string;
  timeTo: string;
  timeToAmpm: string;
  buyOverride?: number;
  waitAfterSellEnabled: boolean;
  waitAfterSellCandles: number;
  maxProfitLossEnabled: boolean;
  maxProfit: number;
  maxLoss: number;
};

// active trade shown in top running-trade card after strategy triggers it
export type ActiveTrade = {
  symbol: string;
  entryPrice: string;
  pnl: number;
  logs: string[];
  lotSize: number;
  lotValue: number;
  numberOfTrades: number;
  stopLossNumberEnabled: boolean;
  stopLossNumber: number;
  targetPointsEnabled: boolean;
  targetPoints: number;
  minToHoldEnabled: boolean;
  minToHold: number;
  trailingAfterTargetEnabled: boolean;
  trailingAfterTarget: number;
  trailingTrailActive: boolean;
  trailingHighWatermark?: number;
  rangeEnabled: boolean;
  timeFrom: string;
  timeFromAmpm: string;
  timeTo: string;
  timeToAmpm: string;
  inPosition: boolean;
  completedCycles: number;
  entryTime?: string;
  exitTime?: string;
  exitPrice?: string;
  status: "ACTIVE" | "COMPLETED";
  buyOverride?: number;
  waitAfterSellEnabled: boolean;
  waitAfterSellCandles: number;
  lastSellCandleTime?: string;
  maxProfitLossEnabled: boolean;
  maxProfit: number;
  maxLoss: number;
};

export type TradeHistoryItem = {
  id: string;
  symbol: string;
  pnl: number;
  logs: string[];
  createdAt: string;
  config?: {
    numberOfTrades: number;
    stopLossNumber?: number;
    stopLossNumberEnabled: boolean;
    targetPoints?: number;
    targetPointsEnabled: boolean;
    trailingAfterTarget?: number;
    trailingAfterTargetEnabled: boolean;
    minToHold?: number;
    minToHoldEnabled: boolean;
  };
};

type TradeConfigSnapshotSource = {
  numberOfTrades: number;
  stopLossNumberEnabled: boolean;
  stopLossNumber: number;
  targetPointsEnabled: boolean;
  targetPoints: number;
  trailingAfterTargetEnabled: boolean;
  trailingAfterTarget: number;
  minToHoldEnabled: boolean;
  minToHold: number;
};

const buildTradeConfigSnapshot = (
  trade: TradeConfigSnapshotSource
): TradeHistoryItem["config"] => ({
  numberOfTrades: trade.numberOfTrades,
  stopLossNumberEnabled: Boolean(trade.stopLossNumberEnabled),
  stopLossNumber: trade.stopLossNumberEnabled ? trade.stopLossNumber : undefined,
  targetPointsEnabled: Boolean(trade.targetPointsEnabled),
  targetPoints: trade.targetPointsEnabled ? trade.targetPoints : undefined,
  trailingAfterTargetEnabled: Boolean(trade.trailingAfterTargetEnabled),
  trailingAfterTarget: trade.trailingAfterTargetEnabled ? trade.trailingAfterTarget : undefined,
  minToHoldEnabled: Boolean(trade.minToHoldEnabled),
  minToHold: trade.minToHoldEnabled ? trade.minToHold : undefined,
});

type TradeStoreValue = {
  selection: TradeSelection;
  setSelection: (s: TradeSelection) => void;

  waitingTrades: WaitingTrade[];
  addWaitingTradeFromSelection: () => void;
  removeWaitingTrade: (symbol: string) => void;

  // active trades shown in the running trade card
  activeTrades: ActiveTrade[];

  // move a waiting trade to active when strategy triggers
  activateWaitingTrade: (symbol: string, entryPrice: string, logLine: string) => void;
  // close an active trade when strategy gives SELL
  completeActiveTrade: (symbol: string, exitPrice: string, logLine: string) => void;
  // complete a cycle without exiting (for stop loss/target hits)
  completeCycleWithoutExit: (symbol: string, exitPrice: string, logLine: string) => void;
  // update active trade with new buy signal
  updateActiveTradeBuy: (symbol: string, entryPrice: string, logLine: string) => void;
  // remove active trade completely
  removeActiveTrade: (symbol: string) => void;
  // log manual exit before removing trade
  logManualExit: (symbol: string, exitPrice: string, pnl: number, lastCandleTime: string) => void;
  // remove trade and free symbol
  removeTradeAndFreeSymbol: (symbol: string) => void;
  // append a log line to a waiting trade
  addLogToWaitingTrade: (symbol: string, log: string) => void;
  // append a log line to an active trade
  addLogToActiveTrade: (symbol: string, log: string) => void;
  // trailing-after-target helpers
  activateTrailingAfterTarget: (symbol: string, price: number, timeLabel: string) => void;
  updateTrailingHighWatermark: (symbol: string, price: number) => void;
  // wait-after-sell helper
  updateLastSellCandleTime: (symbol: string, candleTime: string) => void;

  tradeHistory: TradeHistoryItem[];
  addTradeHistoryEntry: (entry: TradeHistoryItem) => void;
  removeTradeHistoryEntry: (id: string) => void;
  clearTradeHistory: () => void;

  // strategy timing
  getLastStrategyCandleTime: () => string;
  setLastStrategyCandleTime: (time: string) => void;

  // server-side engine sync
  syncFromServer: (state: {
    waitingTrades: WaitingTrade[];
    activeTrades: ActiveTrade[];
    tradeHistory: TradeHistoryItem[];
    lastStrategyCandleTime: string;
  }) => void;
};

const TradeStoreContext = createContext<TradeStoreValue | null>(null);

function readFormField(symbol: string, field: string, fallback: any) {
  try {
    const saved = localStorage.getItem("tradeForm_" + symbol);
    if (!saved) return fallback;
    const data = JSON.parse(saved);
    return data[field] ?? fallback;
  } catch {
    return fallback;
  }
}

function readFormNumber(symbol: string, field: string, fallback: number) {
  const raw = readFormField(symbol, field, fallback);
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function readFormBool(symbol: string, field: string, fallback: boolean) {
  const raw = readFormField(symbol, field, fallback);
  return Boolean(raw ?? fallback);
}

function readFormString(symbol: string, field: string, fallback: string) {
  return String(readFormField(symbol, field, fallback));
}

export function TradeStoreProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [selection, setSelection] = useState<TradeSelection>(null);

  // Server JSON file is the single source of truth — start empty, syncFromServer fills it
  const [waitingTrades, setWaitingTrades] = useState<WaitingTrade[]>([]);
  const [activeTrades, setActiveTrades] = useState<ActiveTrade[]>([]);
  const [tradeHistory, setTradeHistory] = useState<TradeHistoryItem[]>([]);

  // Track whether we've done the initial sync from server
  const initialSyncDone = useRef(false);

  // Pending exits — prevents sync from re-adding trades that were just exited locally
  const pendingExits = useRef<Set<string>>(new Set());

  // Pending history deletes — prevents sync from overwriting optimistic local deletions
  const pendingHistoryDeletes = useRef<Set<string>>(new Set());
  const pendingClearAll = useRef(false);

  // strategy timing (ref to avoid re-render cascade every second)
  const lastStrategyCandleTimeRef = useRef<string>("");
  const getLastStrategyCandleTime = useCallback(() => lastStrategyCandleTimeRef.current, []);
  const setLastStrategyCandleTime = useCallback((time: string) => {
    lastStrategyCandleTimeRef.current = time;
  }, []);

  const addWaitingTradeFromSelection = () => {
    if (!selection) return;
    const alreadyExists = waitingTrades.some((trade) => trade.symbol === selection.symbol);
    if (alreadyExists) return;

    const sym = selection.symbol;
    const newWaitingTrades = [
      {
        symbol: sym,
        price: selection.price,
        stateText: "...WAITING",
        logs: ["Strategy initialized - waiting for signals"],
        lotSize: readFormNumber(sym, "lotSize", 65),
        lotValue: readFormNumber(sym, "lotValue", 1),
        numberOfTrades: readFormNumber(sym, "numberOfTrades", 3),
        stopLossNumberEnabled: readFormBool(sym, "stopLossNumberEnabled", true),
        stopLossNumber: readFormNumber(sym, "stopLossNumber", 15),
        targetPointsEnabled: readFormBool(sym, "targetPointsEnabled", true),
        targetPoints: readFormNumber(sym, "targetPoints", 20),
        minToHoldEnabled: readFormBool(sym, "minToHoldEnabled", false),
        minToHold: readFormNumber(sym, "minToHold", 8),
        trailingAfterTargetEnabled: readFormBool(sym, "trailingAfterTargetEnabled", false),
        trailingAfterTarget: readFormNumber(sym, "trailingAfterTarget", 15),
        rangeEnabled: readFormBool(sym, "rangeEnabled", false),
        timeFrom: readFormString(sym, "timeFrom", "10:00"),
        timeFromAmpm: readFormString(sym, "timeFromAmpm", "am"),
        timeTo: readFormString(sym, "timeTo", "02:45"),
        timeToAmpm: readFormString(sym, "timeToAmpm", "pm"),
        buyOverride: (() => {
          try {
            const saved = localStorage.getItem("tradeForm_" + sym);
            if (!saved) return undefined;
            const data = JSON.parse(saved);
            if (!data.waitStrategyEnabled) return undefined;
            const v = Number(data.stopLossNumber);
            return Number.isFinite(v) && v > 0 ? v : undefined;
          } catch {
            return undefined;
          }
        })(),
        waitAfterSellEnabled: readFormBool(sym, "waitAfterSellEnabled", true),
        waitAfterSellCandles: readFormNumber(sym, "waitAfterSellCandles", 8),
        maxProfitLossEnabled: readFormBool(sym, "maxProfitLossEnabled", false),
        maxProfit: readFormNumber(sym, "maxProfit", 1100),
        maxLoss: readFormNumber(sym, "maxLoss", 900),
      },
      ...waitingTrades,
    ];

    setWaitingTrades(newWaitingTrades);
    setSelection(null);
  };

  const removeWaitingTrade = (symbol: string) => {
    const newWaitingTrades = waitingTrades.filter(
      (trade) => trade.symbol !== symbol
    );
    setWaitingTrades(newWaitingTrades);
    localStorage.removeItem("tradeForm_" + symbol);
  };

  const addLogToWaitingTrade = (symbol: string, log: string) => {
    setWaitingTrades((prev) =>
      prev.map((t) =>
        t.symbol === symbol ? { ...t, logs: [...t.logs, log] } : t
      )
    );
  };

  // move a waiting trade to active after strategy signal
  const activateWaitingTrade = (
    symbol: string,
    entryPrice: string,
    logLine: string
  ) => {
    const tradeToActivate = waitingTrades.find((t) => t.symbol === symbol);
    if (!tradeToActivate) return;

    const newActiveTrade: ActiveTrade = {
      symbol: tradeToActivate.symbol,
      entryPrice,
      pnl: 0,
      logs: [...tradeToActivate.logs, logLine],
      lotSize: tradeToActivate.lotSize,
      lotValue: tradeToActivate.lotValue,
      numberOfTrades: tradeToActivate.numberOfTrades,
      stopLossNumberEnabled: tradeToActivate.stopLossNumberEnabled,
      stopLossNumber: tradeToActivate.stopLossNumber,
      targetPointsEnabled: tradeToActivate.targetPointsEnabled,
      targetPoints: tradeToActivate.targetPoints,
      minToHoldEnabled: tradeToActivate.minToHoldEnabled,
      minToHold: tradeToActivate.minToHold,
      trailingAfterTargetEnabled: tradeToActivate.trailingAfterTargetEnabled,
      trailingAfterTarget: tradeToActivate.trailingAfterTarget,
      trailingTrailActive: false,
      trailingHighWatermark: undefined,
      rangeEnabled: tradeToActivate.rangeEnabled,
      timeFrom: tradeToActivate.timeFrom,
      timeFromAmpm: tradeToActivate.timeFromAmpm,
      timeTo: tradeToActivate.timeTo,
      timeToAmpm: tradeToActivate.timeToAmpm,
      inPosition: true,
      completedCycles: 0,
      buyOverride: tradeToActivate.buyOverride,
      entryTime: logLine.includes("at ") ? logLine.split("at ")[1] : undefined,
      exitTime: undefined,
      exitPrice: undefined,
      status: "ACTIVE",
      waitAfterSellEnabled: tradeToActivate.waitAfterSellEnabled,
      waitAfterSellCandles: tradeToActivate.waitAfterSellCandles,
      lastSellCandleTime: undefined,
      maxProfitLossEnabled: tradeToActivate.maxProfitLossEnabled,
      maxProfit: tradeToActivate.maxProfit,
      maxLoss: tradeToActivate.maxLoss,
    };

    setActiveTrades((prev) => [...prev, newActiveTrade]);
    setWaitingTrades((prev) => prev.filter((t) => t.symbol !== symbol));
  };

  // close an active trade when strategy gives SELL and accumulate pnl
  const completeActiveTrade = (
    symbol: string,
    exitPrice: string,
    logLine: string
  ) => {
    setActiveTrades((prev) => {
      const next = prev.map((trade) => {
        if (trade.symbol !== symbol || trade.status !== "ACTIVE") {
          return trade;
        }

        const entry = Number(trade.entryPrice);
        const exit = Number(exitPrice);

        if (Number.isNaN(entry) || Number.isNaN(exit)) {
          return {
            ...trade,
            logs: [...trade.logs, logLine, "Trade P/L: invalid price data"],
          };
        }

        const qty = trade.lotSize * trade.lotValue;
        const cyclePnl = (exit - entry) * qty;
        const totalPnl = trade.pnl + cyclePnl;
        const newCompletedCycles = trade.completedCycles + 1;

        if (newCompletedCycles >= trade.numberOfTrades) {
          const finalLogs = [
            ...trade.logs,
            logLine,
            `Trade P/L: ${cyclePnl.toFixed(2)}`,
            `Completed ${newCompletedCycles}/${trade.numberOfTrades} trades - Auto-exiting`,
          ];

          appendTradeHistoryEntry(trade.symbol, totalPnl, finalLogs, buildTradeConfigSnapshot(trade));

          return {
            ...trade,
            pnl: totalPnl,
            inPosition: false,
            completedCycles: newCompletedCycles,
            exitPrice,
            logs: finalLogs,
            status: "COMPLETED" as const,
            trailingTrailActive: false,
            trailingHighWatermark: undefined,
          };
        }

        return {
          ...trade,
          pnl: totalPnl,
          inPosition: false,
          completedCycles: newCompletedCycles,
          logs: [
            ...trade.logs,
            logLine,
            `Trade P/L: ${cyclePnl.toFixed(2)}`,
            `Cycle ${newCompletedCycles}/${trade.numberOfTrades} completed`,
          ],
          trailingTrailActive: false,
          trailingHighWatermark: undefined,
        };
      });
      return next;
    });
  };

  // complete a cycle without exiting (for stop loss/target hits)
  const completeCycleWithoutExit = (
    symbol: string,
    exitPrice: string,
    logLine: string
  ) => {
    setActiveTrades((prev) => {
      const next = prev.map((trade) => {
        if (trade.symbol !== symbol || trade.status !== "ACTIVE") {
          return trade;
        }

        const entry = Number(trade.entryPrice);
        const exit = Number(exitPrice);

        if (Number.isNaN(entry) || Number.isNaN(exit)) {
          return {
            ...trade,
            logs: [...trade.logs, logLine, "Trade P/L: invalid price data"],
          };
        }

        const qty = trade.lotSize * trade.lotValue;
        const cyclePnl = (exit - entry) * qty;
        const totalPnl = trade.pnl + cyclePnl;
        const newCompletedCycles = trade.completedCycles + 1;

        if (newCompletedCycles >= trade.numberOfTrades) {
          const finalLogs = [
            ...trade.logs,
            logLine,
            `Trade P/L: ${cyclePnl.toFixed(2)}`,
            `Completed ${newCompletedCycles}/${trade.numberOfTrades} trades - Auto-exiting`,
          ];

          appendTradeHistoryEntry(trade.symbol, totalPnl, finalLogs, buildTradeConfigSnapshot(trade));

          return {
            ...trade,
            pnl: totalPnl,
            inPosition: false,
            completedCycles: newCompletedCycles,
            exitPrice,
            logs: finalLogs,
            status: "COMPLETED" as const,
            trailingTrailActive: false,
            trailingHighWatermark: undefined,
          };
        }

        return {
          ...trade,
          pnl: totalPnl,
          inPosition: false,
          completedCycles: newCompletedCycles,
          logs: [
            ...trade.logs,
            logLine,
            `Trade P/L: ${cyclePnl.toFixed(2)}`,
            `Cycle ${newCompletedCycles}/${trade.numberOfTrades} completed (SL/Target hit - waiting for next signal)`,
          ],
          trailingTrailActive: false,
          trailingHighWatermark: undefined,
        };
      });
      return next;
    });
  };

  const updateActiveTradeBuy = (
    symbol: string,
    entryPrice: string,
    logLine: string
  ) => {
    setActiveTrades((prev) => {
      const next = prev.map((trade) => {
        if (trade.symbol !== symbol || trade.status !== "ACTIVE") {
          return trade;
        }
        return {
          ...trade,
          entryPrice,
          inPosition: true,
          logs: [...trade.logs, logLine],
          trailingTrailActive: false,
          trailingHighWatermark: undefined,
        };
      });
      return next;
    });
  };

  const removeActiveTrade = (symbol: string) => {
    setActiveTrades((prev) => prev.filter((trade) => trade.symbol !== symbol));
  };

  const removeTradeAndFreeSymbol = (symbol: string) => {
    removeActiveTrade(symbol);
    if (selection?.symbol === symbol) {
      setSelection(null);
    }
    localStorage.removeItem("tradeForm_" + symbol);
  };

  const addLogToActiveTrade = (symbol: string, log: string) => {
    setActiveTrades((prev) =>
      prev.map((t) =>
        t.symbol === symbol && t.status === "ACTIVE"
          ? { ...t, logs: [...t.logs, log] }
          : t
      )
    );
  };

  const activateTrailingAfterTarget = (
    symbol: string,
    price: number,
    timeLabel: string
  ) => {
    setActiveTrades((prev) =>
      prev.map((t) => {
        if (t.symbol !== symbol || t.status !== "ACTIVE") return t;
        return {
          ...t,
          trailingTrailActive: true,
          trailingHighWatermark: price,
          logs: [
            ...t.logs,
            `Trailing target armed at ₹${price.toFixed(2)} on ${timeLabel}`,
          ],
        };
      })
    );
  };

  const updateTrailingHighWatermark = (symbol: string, price: number) => {
    setActiveTrades((prev) =>
      prev.map((t) => {
        if (t.symbol !== symbol || t.status !== "ACTIVE") return t;
        if (!t.trailingTrailActive) return t;
        if (t.trailingHighWatermark && price <= t.trailingHighWatermark) return t;
        return { ...t, trailingHighWatermark: price };
      })
    );
  };

  const updateLastSellCandleTime = (symbol: string, candleTime: string) => {
    setActiveTrades((prev) =>
      prev.map((t) => {
        if (t.symbol !== symbol || t.status !== "ACTIVE") return t;
        return { ...t, lastSellCandleTime: candleTime };
      })
    );
  };

  const logManualExit = (
    symbol: string,
    exitPrice: string,
    pnl: number,
    lastCandleTime: string
  ) => {
    setActiveTrades((prev) => {
      const trade = prev.find((t) => t.symbol === symbol && t.status === "ACTIVE");
      if (trade) {
        const exitLog = trade.inPosition
          ? `SELL manually for ₹${exitPrice} at ${lastCandleTime}`
          : `EXIT  at ${lastCandleTime}`;

        const entry = Number(trade.entryPrice);
        const exit = Number(exitPrice);
        const qty = trade.lotSize * trade.lotValue;
        const currentCyclePnl = trade.inPosition && Number.isFinite(exit) && Number.isFinite(entry)
          ? (exit - entry) * qty
          : 0;

        const pnlLog = `Trade P/L: ${currentCyclePnl.toFixed(2)}`;
        const finalLogs = [...trade.logs, exitLog, pnlLog];

        appendTradeHistoryEntry(trade.symbol, pnl, finalLogs, buildTradeConfigSnapshot(trade));
      }
      // Mark as pending exit so syncFromServer won't re-add it
      pendingExits.current.add(symbol);
      setTimeout(() => { pendingExits.current.delete(symbol); }, 5000);
      // Remove the trade immediately — no COMPLETED limbo
      return prev.filter((t) => t.symbol !== symbol);
    });
  };

  const clearTradeHistory = () => {
    pendingClearAll.current = true;
    setTradeHistory([]);
    setTimeout(() => { pendingClearAll.current = false; }, 3000);
  };

  const removeTradeHistoryEntry = (id: string) => {
    pendingHistoryDeletes.current.add(id);
    setTradeHistory((prev) => prev.filter((item) => item.id !== id));
    setTimeout(() => { pendingHistoryDeletes.current.delete(id); }, 3000);
  };

  const appendTradeHistoryEntry = (
    symbol: string,
    pnl: number,
    logs: string[],
    config?: TradeHistoryItem["config"]
  ) => {
    setTradeHistory((historyPrev) => {
      const latest = historyPrev[0];
      const lastLog = logs[logs.length - 1] ?? "";
      const latestLastLog = latest?.logs?.[latest.logs.length - 1] ?? "";

      const now = Date.now();
      const latestCreatedAt = latest?.createdAt ? new Date(latest.createdAt).getTime() : 0;
      const timeDiffMs = now - latestCreatedAt;

      if (
        latest &&
        latest.symbol === symbol &&
        latest.pnl === pnl &&
        latest.logs.length === logs.length &&
        latestLastLog === lastLog &&
        timeDiffMs < 2000
      ) {
        return historyPrev;
      }

      const historyEntry: TradeHistoryItem = {
        id: `${symbol}-${Date.now()}`,
        symbol,
        pnl,
        logs,
        createdAt: new Date().toISOString(),
        config,
      };
      return [historyEntry, ...historyPrev];
    });
  };

  const addTradeHistoryEntry = (entry: TradeHistoryItem) => {
    appendTradeHistoryEntry(entry.symbol, entry.pnl, entry.logs, entry.config);
  };

  const syncFromServer = useCallback((state: {
    waitingTrades: WaitingTrade[];
    activeTrades: ActiveTrade[];
    tradeHistory: TradeHistoryItem[];
    lastStrategyCandleTime: string;
  }) => {
    // On first sync (page load/refresh), populate waitingTrades from server.
    // After that, waitingTrades is frontend-owned — only remove trades that
    // the server has activated.
    if (!initialSyncDone.current) {
      initialSyncDone.current = true;
      setWaitingTrades(state.waitingTrades);
    } else {
      setWaitingTrades((prev) =>
        prev.filter((w) => !state.activeTrades.some((a) => a.symbol === w.symbol))
      );
    }
    // Merge: use server trades as base, but keep frontend-only trades that server
    // doesn't know about yet (e.g. just activated, POST hasn't reached server)
    setActiveTrades((prev) => {
      // Start from server state, but filter out trades pending local exit
      const merged = state.activeTrades.filter((t) => !pendingExits.current.has(t.symbol));
      for (const local of prev) {
        if (local.status === "COMPLETED") continue;
        if (pendingExits.current.has(local.symbol)) continue;
        if (!merged.some((s) => s.symbol === local.symbol)) {
          merged.push(local);
        }
      }
      return merged;
    });
    if (pendingClearAll.current) {
      // Don't overwrite — user just cleared all history
    } else if (pendingHistoryDeletes.current.size > 0) {
      setTradeHistory(state.tradeHistory.filter(
        (item) => !pendingHistoryDeletes.current.has(item.id)
      ));
    } else {
      setTradeHistory(state.tradeHistory);
    }
    if (state.lastStrategyCandleTime) {
      lastStrategyCandleTimeRef.current = state.lastStrategyCandleTime;
    }
  }, []);

  const value = useMemo(
    () => ({
      selection,
      setSelection,
      waitingTrades,
      addWaitingTradeFromSelection,
      removeWaitingTrade,
      addLogToWaitingTrade,
      activeTrades,
      activateWaitingTrade,
      completeActiveTrade,
      completeCycleWithoutExit,
      updateActiveTradeBuy,
      removeActiveTrade,
      logManualExit,
      removeTradeAndFreeSymbol,
      addLogToActiveTrade,
      activateTrailingAfterTarget,
      updateTrailingHighWatermark,
      updateLastSellCandleTime,
      tradeHistory,
      addTradeHistoryEntry,
      removeTradeHistoryEntry,
      clearTradeHistory,
      getLastStrategyCandleTime,
      setLastStrategyCandleTime,
      syncFromServer,
    }),
    [selection, waitingTrades, activeTrades, tradeHistory, syncFromServer]
  );

  return (
    <TradeStoreContext.Provider value={value}>
      {children}
    </TradeStoreContext.Provider>
  );
}

export function useTradeStore() {
  const ctx = useContext(TradeStoreContext);
  if (!ctx) {
    throw new Error("useTradeStore must be used within TradeStoreProvider");
  }
  return ctx;
}
