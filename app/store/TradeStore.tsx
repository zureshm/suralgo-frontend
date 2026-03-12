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
};

// active trade shown in top running-trade card after strategy triggers it
export type ActiveTrade = {
  symbol: string;
  entryPrice: string;
  pnl: number;
  logs: string[];
  entryTime?: string;
  exitTime?: string;
  exitPrice?: string;
  status: "ACTIVE" | "COMPLETED";
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
      return saved ? JSON.parse(saved) : [];
    }
    return [];
  });

  // active trades that have been triggered by strategy
  const [activeTrades, setActiveTrades] = useState<ActiveTrade[]>([]);

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
  entryTime: logLine.includes("at ") ? logLine.split("at ")[1] : undefined,
  exitTime: undefined,
  exitPrice: undefined,
  status: "ACTIVE",
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

        const cyclePnl = exit - entry;

        // Accumulate total P/L
        const totalPnl = trade.pnl + cyclePnl;

        return {
          ...trade,
          pnl: totalPnl,
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
          logs: [...trade.logs, logLine],
        };
      })
    );
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
    }),
    [selection, waitingTrades, activeTrades]
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