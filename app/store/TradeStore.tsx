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

const sanitizeHistoryConfig = (raw: any): TradeHistoryItem["config"] | undefined => {
  if (!raw || typeof raw !== "object") return undefined;

  const toNumber = (value: any): number | undefined => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const numberOfTrades = toNumber(raw.numberOfTrades) ?? 0;
  const stopLossNumberEnabled = Boolean(raw.stopLossNumberEnabled);
  const targetPointsEnabled = Boolean(raw.targetPointsEnabled);
  const trailingAfterTargetEnabled = Boolean(raw.trailingAfterTargetEnabled);
  const minToHoldEnabled = Boolean(raw.minToHoldEnabled);

  return {
    numberOfTrades,
    stopLossNumberEnabled,
    stopLossNumber: stopLossNumberEnabled ? toNumber(raw.stopLossNumber) : undefined,
    targetPointsEnabled,
    targetPoints: targetPointsEnabled ? toNumber(raw.targetPoints) : undefined,
    trailingAfterTargetEnabled,
    trailingAfterTarget: trailingAfterTargetEnabled ? toNumber(raw.trailingAfterTarget) : undefined,
    minToHoldEnabled,
    minToHold: minToHoldEnabled ? toNumber(raw.minToHold) : undefined,
  };
};

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

  tradeHistory: TradeHistoryItem[];
  addTradeHistoryEntry: (entry: TradeHistoryItem) => void;
  removeTradeHistoryEntry: (id: string) => void;
  clearTradeHistory: () => void;

  // strategy timing
  getLastStrategyCandleTime: () => string;
  setLastStrategyCandleTime: (time: string) => void;
};

const TradeStoreContext = createContext<TradeStoreValue | null>(null);

export function TradeStoreProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [selection, setSelection] = useState<TradeSelection>(null);

  const [waitingTrades, setWaitingTrades] = useState<WaitingTrade[]>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("waitingTrades");
      if (!saved) return [];
      try {
        const parsed = JSON.parse(saved);
        if (!Array.isArray(parsed)) return [];

        return parsed.map((t: any) => ({
          symbol: String(t.symbol ?? ""),
          price: String(t.price ?? ""),
          stateText: String(t.stateText ?? "...WAITING"),
          logs: Array.isArray(t.logs) ? t.logs.map(String) : [],
          lotSize: Number.isFinite(Number(t.lotSize)) && Number(t.lotSize) > 0 ? Number(t.lotSize) : 65,
          lotValue: Number.isFinite(Number(t.lotValue)) && Number(t.lotValue) > 0 ? Number(t.lotValue) : 1,
          numberOfTrades: Number.isFinite(Number(t.numberOfTrades)) && Number(t.numberOfTrades) > 0 ? Number(t.numberOfTrades) : 3,
          stopLossNumberEnabled: Boolean(t.stopLossNumberEnabled ?? true),
          stopLossNumber: Number.isFinite(Number(t.stopLossNumber)) && Number(t.stopLossNumber) > 0 ? Number(t.stopLossNumber) : 15,
          targetPointsEnabled: Boolean(t.targetPointsEnabled ?? true),
          targetPoints: Number.isFinite(Number(t.targetPoints)) && Number(t.targetPoints) > 0 ? Number(t.targetPoints) : 20,
          minToHoldEnabled: Boolean(t.minToHoldEnabled ?? false),
          minToHold: Number.isFinite(Number(t.minToHold)) && Number(t.minToHold) > 0 ? Number(t.minToHold) : 8,
          trailingAfterTargetEnabled: Boolean(t.trailingAfterTargetEnabled ?? false),
          trailingAfterTarget: Number.isFinite(Number(t.trailingAfterTarget)) && Number(t.trailingAfterTarget) > 0 ? Number(t.trailingAfterTarget) : 15,
          rangeEnabled: Boolean(t.rangeEnabled ?? false),
          timeFrom: String(t.timeFrom ?? "10:00"),
          timeFromAmpm: String(t.timeFromAmpm ?? "am"),
          timeTo: String(t.timeTo ?? "02:45"),
          timeToAmpm: String(t.timeToAmpm ?? "pm"),
          buyOverride: Number.isFinite(Number(t.buyOverride)) ? Number(t.buyOverride) : undefined,
        })) as WaitingTrade[];
      } catch {
        return [];
      }
    }
    return [];
  });

  // active trades that have been triggered by strategy
  const [activeTrades, setActiveTrades] = useState<ActiveTrade[]>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("activeTrades");
      if (!saved) return [];
      try {
        const parsed = JSON.parse(saved);
        if (!Array.isArray(parsed)) return [];

        return parsed.map((t: any) => ({
          symbol: String(t.symbol ?? ""),
          entryPrice: String(t.entryPrice ?? ""),
          pnl: Number(t.pnl ?? 0),
          logs: Array.isArray(t.logs) ? t.logs.map(String) : [],
          lotSize: Number.isFinite(Number(t.lotSize)) && Number(t.lotSize) > 0 ? Number(t.lotSize) : 65,
          lotValue: Number.isFinite(Number(t.lotValue)) && Number(t.lotValue) > 0 ? Number(t.lotValue) : 1,
          numberOfTrades: Number.isFinite(Number(t.numberOfTrades)) && Number(t.numberOfTrades) > 0 ? Number(t.numberOfTrades) : 3,
          stopLossNumberEnabled: Boolean(t.stopLossNumberEnabled ?? true),
          stopLossNumber: Number.isFinite(Number(t.stopLossNumber)) && Number(t.stopLossNumber) > 0 ? Number(t.stopLossNumber) : 15,
          targetPointsEnabled: Boolean(t.targetPointsEnabled ?? true),
          targetPoints: Number.isFinite(Number(t.targetPoints)) && Number(t.targetPoints) > 0 ? Number(t.targetPoints) : 20,
          minToHoldEnabled: Boolean(t.minToHoldEnabled ?? false),
          minToHold: Number.isFinite(Number(t.minToHold)) && Number(t.minToHold) > 0 ? Number(t.minToHold) : 8,
          trailingAfterTargetEnabled: Boolean(t.trailingAfterTargetEnabled ?? false),
          trailingAfterTarget: Number.isFinite(Number(t.trailingAfterTarget)) && Number(t.trailingAfterTarget) > 0 ? Number(t.trailingAfterTarget) : 15,
          trailingTrailActive: Boolean(t.trailingTrailActive ?? false),
          trailingHighWatermark: Number.isFinite(Number(t.trailingHighWatermark)) ? Number(t.trailingHighWatermark) : undefined,
          rangeEnabled: Boolean(t.rangeEnabled ?? false),
          timeFrom: String(t.timeFrom ?? "10:00"),
          timeFromAmpm: String(t.timeFromAmpm ?? "am"),
          timeTo: String(t.timeTo ?? "02:45"),
          timeToAmpm: String(t.timeToAmpm ?? "pm"),
          inPosition: Boolean(t.inPosition ?? false),
          completedCycles: Number.isFinite(Number(t.completedCycles)) ? Number(t.completedCycles) : 0,
          entryTime: t.entryTime ? String(t.entryTime) : undefined,
          exitTime: t.exitTime ? String(t.exitTime) : undefined,
          exitPrice: t.exitPrice ? String(t.exitPrice) : undefined,
          status: t.status === "COMPLETED" ? "COMPLETED" : "ACTIVE",
          buyOverride: Number.isFinite(Number(t.buyOverride)) ? Number(t.buyOverride) : undefined,
        })) as ActiveTrade[];
      } catch {
        return [];
      }
    }
    return [];
  });

  // strategy timing (ref to avoid re-render cascade every second)
  const lastStrategyCandleTimeRef = useRef<string>("");
  const getLastStrategyCandleTime = useCallback(() => lastStrategyCandleTimeRef.current, []);
  const setLastStrategyCandleTime = useCallback((time: string) => {
    lastStrategyCandleTimeRef.current = time;
  }, []);

  const [tradeHistory, setTradeHistory] = useState<TradeHistoryItem[]>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("tradeHistory");
      if (!saved) return [];
      try {
        const parsed = JSON.parse(saved);
        if (!Array.isArray(parsed)) return [];

        return parsed
          .map((t: any) => ({
            id: String(t.id ?? ""),
            symbol: String(t.symbol ?? ""),
            pnl: Number(t.pnl ?? 0),
            logs: Array.isArray(t.logs) ? t.logs.map(String) : [],
            createdAt: String(t.createdAt ?? ""),
            config: sanitizeHistoryConfig(t.config),
          }))
          .filter((t: TradeHistoryItem) => Boolean(t.id) && Boolean(t.symbol));
      } catch {
        return [];
      }
    }
    return [];
  });

  const addWaitingTradeFromSelection = () => {
    if (!selection) return;

    const alreadyExists = waitingTrades.some(
      (trade) => trade.symbol === selection.symbol
    );
    if (alreadyExists) return;

    const newWaitingTrades = [
      {
        symbol: selection.symbol,
        price: selection.price,
        stateText: "...WAITING",
        logs: ["Strategy initialized - waiting for signals"],
        lotSize: (() => {
          try {
            const saved = localStorage.getItem("tradeForm_" + selection.symbol);
            if (!saved) return 65;
            const data = JSON.parse(saved);
            const v = Number(data.lotSize);
            return Number.isFinite(v) && v > 0 ? v : 65;
          } catch {
            return 65;
          }
        })(),
        lotValue: (() => {
          try {
            const saved = localStorage.getItem("tradeForm_" + selection.symbol);
            if (!saved) return 1;
            const data = JSON.parse(saved);
            const v = Number(data.lotValue);
            return Number.isFinite(v) && v > 0 ? v : 1;
          } catch {
            return 1;
          }
        })(),
        numberOfTrades: (() => {
          try {
            const saved = localStorage.getItem("tradeForm_" + selection.symbol);
            if (!saved) return 3;
            const data = JSON.parse(saved);
            const v = Number(data.numberOfTrades);
            return Number.isFinite(v) && v > 0 ? v : 3;
          } catch {
            return 3;
          }
        })(),
        stopLossNumberEnabled: (() => {
          try {
            const saved = localStorage.getItem("tradeForm_" + selection.symbol);
            if (!saved) return true;
            const data = JSON.parse(saved);
            return Boolean(data.stopLossNumberEnabled ?? true);
          } catch {
            return true;
          }
        })(),
        stopLossNumber: (() => {
          try {
            const saved = localStorage.getItem("tradeForm_" + selection.symbol);
            if (!saved) return 15;
            const data = JSON.parse(saved);
            const v = Number(data.stopLossNumber);
            return Number.isFinite(v) && v > 0 ? v : 15;
          } catch {
            return 15;
          }
        })(),
        targetPointsEnabled: (() => {
          try {
            const saved = localStorage.getItem("tradeForm_" + selection.symbol);
            if (!saved) return true;
            const data = JSON.parse(saved);
            return Boolean(data.targetPointsEnabled ?? true);
          } catch {
            return true;
          }
        })(),
        targetPoints: (() => {
          try {
            const saved = localStorage.getItem("tradeForm_" + selection.symbol);
            if (!saved) return 20;
            const data = JSON.parse(saved);
            const v = Number(data.targetPoints);
            return Number.isFinite(v) && v > 0 ? v : 20;
          } catch {
            return 20;
          }
        })(),
        minToHoldEnabled: (() => {
          try {
            const saved = localStorage.getItem("tradeForm_" + selection.symbol);
            if (!saved) return false;
            const data = JSON.parse(saved);
            return Boolean(data.minToHoldEnabled ?? false);
          } catch {
            return false;
          }
        })(),
        minToHold: (() => {
          try {
            const saved = localStorage.getItem("tradeForm_" + selection.symbol);
            if (!saved) return 8;
            const data = JSON.parse(saved);
            const v = Number(data.minToHold);
            return Number.isFinite(v) && v > 0 ? v : 8;
          } catch {
            return 8;
          }
        })(),
        trailingAfterTargetEnabled: (() => {
          try {
            const saved = localStorage.getItem("tradeForm_" + selection.symbol);
            if (!saved) return false;
            const data = JSON.parse(saved);
            return Boolean(data.trailingAfterTargetEnabled ?? false);
          } catch {
            return false;
          }
        })(),
        trailingAfterTarget: (() => {
          try {
            const saved = localStorage.getItem("tradeForm_" + selection.symbol);
            if (!saved) return 15;
            const data = JSON.parse(saved);
            const v = Number(data.trailingAfterTarget);
            return Number.isFinite(v) && v > 0 ? v : 15;
          } catch {
            return 15;
          }
        })(),
        rangeEnabled: (() => {
          try {
            const saved = localStorage.getItem("tradeForm_" + selection.symbol);
            if (!saved) return false;
            const data = JSON.parse(saved);
            return Boolean(data.rangeEnabled ?? false);
          } catch {
            return false;
          }
        })(),
        timeFrom: (() => {
          try {
            const saved = localStorage.getItem("tradeForm_" + selection.symbol);
            if (!saved) return "10:00";
            const data = JSON.parse(saved);
            return String(data.timeFrom ?? "10:00");
          } catch {
            return "10:00";
          }
        })(),
        timeFromAmpm: (() => {
          try {
            const saved = localStorage.getItem("tradeForm_" + selection.symbol);
            if (!saved) return "am";
            const data = JSON.parse(saved);
            return String(data.timeFromAmpm ?? "am");
          } catch {
            return "am";
          }
        })(),
        timeTo: (() => {
          try {
            const saved = localStorage.getItem("tradeForm_" + selection.symbol);
            if (!saved) return "02:45";
            const data = JSON.parse(saved);
            return String(data.timeTo ?? "02:45");
          } catch {
            return "02:45";
          }
        })(),
        timeToAmpm: (() => {
          try {
            const saved = localStorage.getItem("tradeForm_" + selection.symbol);
            if (!saved) return "pm";
            const data = JSON.parse(saved);
            return String(data.timeToAmpm ?? "pm");
          } catch {
            return "pm";
          }
        })(),
        buyOverride: (() => {
          try {
            const saved = localStorage.getItem("tradeForm_" + selection.symbol);
            if (!saved) return undefined;
            const data = JSON.parse(saved);
            if (!data.waitStrategyEnabled) return undefined;
            const v = Number(data.stopLossNumber);
            return Number.isFinite(v) && v > 0 ? v : undefined;
          } catch {
            return undefined;
          }
        })(),
      },
      ...waitingTrades,
    ];

    setWaitingTrades(newWaitingTrades);
    localStorage.setItem("waitingTrades", JSON.stringify(newWaitingTrades));

    setSelection(null);
  };

  const removeWaitingTrade = (symbol: string) => {
    const newWaitingTrades = waitingTrades.filter(
      (trade) => trade.symbol !== symbol
    );

    setWaitingTrades(newWaitingTrades);
    localStorage.setItem("waitingTrades", JSON.stringify(newWaitingTrades));
    localStorage.removeItem("tradeForm_" + symbol);
  };

  const addLogToWaitingTrade = (symbol: string, log: string) => {
    setWaitingTrades((prev) => {
      const next = prev.map((t) =>
        t.symbol === symbol ? { ...t, logs: [...t.logs, log] } : t
      );
      localStorage.setItem("waitingTrades", JSON.stringify(next));
      return next;
    });
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
    };

    setActiveTrades((prev) => {
      const next = [...prev, newActiveTrade];
      localStorage.setItem("activeTrades", JSON.stringify(next));
      return next;
    });

    setWaitingTrades((prev) => {
      const next = prev.filter((t) => t.symbol !== symbol);
      localStorage.setItem("waitingTrades", JSON.stringify(next));
      return next;
    });
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
      localStorage.setItem("activeTrades", JSON.stringify(next));
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
      localStorage.setItem("activeTrades", JSON.stringify(next));
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
      localStorage.setItem("activeTrades", JSON.stringify(next));
      return next;
    });
  };

  const removeActiveTrade = (symbol: string) => {
    setActiveTrades((prev) => {
      const next = prev.filter((trade) => trade.symbol !== symbol);
      localStorage.setItem("activeTrades", JSON.stringify(next));
      return next;
    });
  };

  const removeTradeAndFreeSymbol = (symbol: string) => {
    removeActiveTrade(symbol);

    if (selection?.symbol === symbol) {
      setSelection(null);
    }

    localStorage.removeItem("tradeForm_" + symbol);
  };

  const addLogToActiveTrade = (symbol: string, log: string) => {
    setActiveTrades((prev) => {
      const next = prev.map((t) =>
        t.symbol === symbol && t.status === "ACTIVE"
          ? { ...t, logs: [...t.logs, log] }
          : t
      );
      localStorage.setItem("activeTrades", JSON.stringify(next));
      return next;
    });
  };

  const activateTrailingAfterTarget = (
    symbol: string,
    price: number,
    timeLabel: string
  ) => {
    setActiveTrades((prev) => {
      const next = prev.map((t) => {
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
      });
      localStorage.setItem("activeTrades", JSON.stringify(next));
      return next;
    });
  };

  const updateTrailingHighWatermark = (symbol: string, price: number) => {
    setActiveTrades((prev) => {
      const next = prev.map((t) => {
        if (t.symbol !== symbol || t.status !== "ACTIVE") return t;
        if (!t.trailingTrailActive) return t;
        if (t.trailingHighWatermark && price <= t.trailingHighWatermark) return t;

        return {
          ...t,
          trailingHighWatermark: price,
        };
      });
      localStorage.setItem("activeTrades", JSON.stringify(next));
      return next;
    });
  };

  const logManualExit = (
    symbol: string,
    exitPrice: string,
    pnl: number,
    lastCandleTime: string
  ) => {
    setActiveTrades((prev) => {
      const next = prev.map((trade) => {
        if (trade.symbol !== symbol || trade.status !== "ACTIVE") {
          return trade;
        }

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

        removeActiveTrade(symbol);

        return {
          ...trade,
          exitPrice,
          exitTime: lastCandleTime,
          status: "COMPLETED" as const,
          inPosition: false,
          pnl,
          logs: finalLogs,
        };
      });
      localStorage.setItem("activeTrades", JSON.stringify(next));
      return next;
    });
  };

  const clearTradeHistory = () => {
    setTradeHistory([]);
    if (typeof window !== "undefined") {
      localStorage.removeItem("tradeHistory");
    }
  };

  const removeTradeHistoryEntry = (id: string) => {
    setTradeHistory((prev) => {
      const next = prev.filter((item) => item.id !== id);
      localStorage.setItem("tradeHistory", JSON.stringify(next));
      return next;
    });
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

      if (
        latest &&
        latest.symbol === symbol &&
        latest.pnl === pnl &&
        latest.logs.length === logs.length &&
        latestLastLog === lastLog
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
      const nextHistory = [historyEntry, ...historyPrev];
      localStorage.setItem("tradeHistory", JSON.stringify(nextHistory));
      return nextHistory;
    });
  };

  const addTradeHistoryEntry = (entry: TradeHistoryItem) => {
    appendTradeHistoryEntry(entry.symbol, entry.pnl, entry.logs, entry.config);
  };

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
      tradeHistory,
      addTradeHistoryEntry,
      removeTradeHistoryEntry,
      clearTradeHistory,
      getLastStrategyCandleTime,
      setLastStrategyCandleTime,
    }),
    [selection, waitingTrades, activeTrades, tradeHistory]
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