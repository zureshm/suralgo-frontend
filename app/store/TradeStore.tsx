"use client";

import React, { createContext, useContext, useMemo, useState } from "react";

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
  stopLossNumber: number;
  targetPoints: number;
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
  stopLossNumber: number;
  targetPoints: number;
  inPosition: boolean;
  entryTime?: string;
  exitTime?: string;
  exitPrice?: string;
  status: "ACTIVE" | "COMPLETED";
};

export type TradeHistoryItem = {
  id: string;
  symbol: string;
  pnl: number;
  logs: string[];
  createdAt: string;
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
  // update active trade with new buy signal
  updateActiveTradeBuy: (symbol: string, entryPrice: string, logLine: string) => void;
  // remove active trade completely
  removeActiveTrade: (symbol: string) => void;
  // log manual exit before removing trade
  logManualExit: (symbol: string, exitPrice: string, pnl: number, lastCandleTime: string) => void;
  // remove trade and free symbol
  removeTradeAndFreeSymbol: (symbol: string) => void;

  tradeHistory: TradeHistoryItem[];
  addTradeHistoryEntry: (entry: TradeHistoryItem) => void;

  // strategy timing
  lastStrategyCandleTime: string;
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
          stopLossNumber: Number.isFinite(Number(t.stopLossNumber)) && Number(t.stopLossNumber) > 0 ? Number(t.stopLossNumber) : 15,
          targetPoints: Number.isFinite(Number(t.targetPoints)) && Number(t.targetPoints) > 0 ? Number(t.targetPoints) : 20,
        })) as WaitingTrade[];
      } catch {
        return [];
      }
    }
    return [];
  });

  // active trades that have been triggered by strategy
  const [activeTrades, setActiveTrades] = useState<ActiveTrade[]>([]);

  // strategy timing
  const [lastStrategyCandleTime, setLastStrategyCandleTime] = useState<string>("");

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
      stopLossNumber: tradeToActivate.stopLossNumber,
      targetPoints: tradeToActivate.targetPoints,
      inPosition: true,
      entryTime: logLine.includes("at ") ? logLine.split("at ")[1] : undefined,
      exitTime: undefined,
      exitPrice: undefined,
      status: "ACTIVE",
    };

    setActiveTrades((prev) => [...prev, newActiveTrade]);

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
    setActiveTrades((prev) =>
      prev.map((trade) => {
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

        // Accumulate total P/L
        const totalPnl = trade.pnl + cyclePnl;

        return {
          ...trade,
          pnl: totalPnl,
          inPosition: false,
          logs: [...trade.logs, logLine, `Trade P/L: ${cyclePnl.toFixed(2)}`],
          // Keep status ACTIVE for multiple cycles
        };
      })
    );
  };

  const updateActiveTradeBuy = (
    symbol: string,
    entryPrice: string,
    logLine: string
  ) => {
    setActiveTrades((prev) =>
      prev.map((trade) => {
        if (trade.symbol !== symbol || trade.status !== "ACTIVE") {
          return trade;
        }

        return {
          ...trade,
          entryPrice,
          inPosition: true,
          logs: [...trade.logs, logLine],
        };
      })
    );
  };

  const removeActiveTrade = (symbol: string) => {
    setActiveTrades((prev) => prev.filter((trade) => trade.symbol !== symbol));
  };

  const removeTradeAndFreeSymbol = (symbol: string) => {
    // Remove trade from active trades
    removeActiveTrade(symbol);
    
    // Free the symbol: clear selection if it matches, and remove localStorage data
    if (selection?.symbol === symbol) {
      setSelection(null);
    }
    localStorage.removeItem("tradeForm_" + symbol);
  };

  const logManualExit = (
    symbol: string,
    exitPrice: string,
    pnl: number,
    lastCandleTime: string
  ) => {
    setActiveTrades((prev) =>
      prev.map((trade) => {
        if (trade.symbol !== symbol || trade.status !== "ACTIVE") {
          return trade;
        }

        // Log different messages based on whether we're in position or not
        const exitLog = trade.inPosition 
          ? `SELL manually for ₹${exitPrice} at ${lastCandleTime}`
          : `EXIT  at ${lastCandleTime}`;

        // Calculate current cycle P&L (entry vs exit only)
        const entry = Number(trade.entryPrice);
        const exit = Number(exitPrice);
        const qty = trade.lotSize * trade.lotValue;
        const currentCyclePnl = trade.inPosition && Number.isFinite(exit) && Number.isFinite(entry)
          ? (exit - entry) * qty
          : 0;
        
        const pnlLog = `Trade P/L: ${currentCyclePnl.toFixed(2)}`;
        const finalLogs = [...trade.logs, exitLog, pnlLog];

        // Add to history
        setTradeHistory((historyPrev) => {
          const historyEntry = {
            id: `${trade.symbol}-${Date.now()}`,
            symbol: trade.symbol,
            pnl: pnl, // Use total accumulated P&L
            logs: finalLogs,
            createdAt: new Date().toISOString(),
          };
          const nextHistory = [historyEntry, ...historyPrev];
          localStorage.setItem("tradeHistory", JSON.stringify(nextHistory));
          return nextHistory;
        });

        // Remove completed trade from active trades
        removeActiveTrade(symbol);

        return {
          ...trade,
          exitPrice,
          exitTime: lastCandleTime,
          status: "COMPLETED",
          inPosition: false,
          pnl: pnl, // Keep total accumulated P&L for trade state
          logs: finalLogs,
        };
      })
    );
  };

  const addTradeHistoryEntry = (entry: TradeHistoryItem) => {
    setTradeHistory((prev) => {
      const next = [entry, ...prev];
      localStorage.setItem("tradeHistory", JSON.stringify(next));
      return next;
    });
  };

  const value = useMemo(
    () => ({
      selection,
      setSelection,
      waitingTrades,
      addWaitingTradeFromSelection,
      removeWaitingTrade,
      activeTrades,
      activateWaitingTrade,
      completeActiveTrade,
      updateActiveTradeBuy,
      removeActiveTrade,
      logManualExit,
      removeTradeAndFreeSymbol,
      tradeHistory,
      addTradeHistoryEntry,
      lastStrategyCandleTime,
      setLastStrategyCandleTime,
    }),
    [selection, waitingTrades, activeTrades, tradeHistory, logManualExit, lastStrategyCandleTime]
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