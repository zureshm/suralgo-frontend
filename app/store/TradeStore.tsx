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
  const [waitingTrades, setWaitingTrades] = useState<WaitingTrade[]>([]);

  const addWaitingTradeFromSelection = () => {
    if (!selection) return;

    // Check if symbol already exists in waitingTrades
    const alreadyExists = waitingTrades.some((trade) => trade.symbol === selection.symbol);
    if (alreadyExists) return;

    setWaitingTrades((prev) => [
      {
        symbol: selection.symbol,
        price: selection.price,
        stateText: "...WAITING",
        logs: [],
      },
      ...prev,
    ]);

    // Clear selection after adding
    setSelection(null);
  };

  const removeWaitingTrade = (symbol: string) => {
    setWaitingTrades((prev) => prev.filter((trade) => trade.symbol !== symbol));
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
