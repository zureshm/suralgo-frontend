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

type TradeStoreValue = {
  selection: TradeSelection;
  setSelection: (next: TradeSelection) => void;
  waitingTrades: WaitingTrade[];
  addWaitingTradeFromSelection: () => void;
  removeWaitingTrade: (symbol: string) => void;
};

const TradeStoreContext = createContext<TradeStoreValue | null>(null);

export function TradeStoreProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [selection, setSelection] = useState<TradeSelection>(null);
  const [waitingTrades, setWaitingTrades] = useState<WaitingTrade[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('waitingTrades');
      return saved ? JSON.parse(saved) : [];
    }
    return [];
  });

  const addWaitingTradeFromSelection = () => {
    if (!selection) return;

    // Check if symbol already exists in waitingTrades
    const alreadyExists = waitingTrades.some((trade) => trade.symbol === selection.symbol);
    if (alreadyExists) return;

    const newWaitingTrades = [
      {
        symbol: selection.symbol,
        price: selection.price,
        stateText: "...WAITING",
        logs: [],
      },
      ...waitingTrades,
    ];

    setWaitingTrades(newWaitingTrades);
    localStorage.setItem('waitingTrades', JSON.stringify(newWaitingTrades));

    // Clear selection after adding
    setSelection(null);
  };

  const removeWaitingTrade = (symbol: string) => {
    const newWaitingTrades = waitingTrades.filter((trade) => trade.symbol !== symbol);
    setWaitingTrades(newWaitingTrades);
    localStorage.setItem('waitingTrades', JSON.stringify(newWaitingTrades));
    localStorage.removeItem('tradeForm_' + symbol);
  };

  const value = useMemo(
    () => ({
      selection,
      setSelection,
      waitingTrades,
      addWaitingTradeFromSelection,
      removeWaitingTrade,
    }),
    [selection, waitingTrades]
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
