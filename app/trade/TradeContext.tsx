"use client";

import React, { createContext, useContext, useMemo, useState } from "react";

type TradeSelection = {
  symbol: string;
  price: string;
} | null;

type TradeContextValue = {
  selection: TradeSelection;
  setSelection: (next: TradeSelection) => void;
};

const TradeContext = createContext<TradeContextValue | null>(null);

export function TradeProvider({ children }: { children: React.ReactNode }) {
  const [selection, setSelection] = useState<TradeSelection>(null);

  const value = useMemo(() => ({ selection, setSelection }), [selection]);

  return <TradeContext.Provider value={value}>{children}</TradeContext.Provider>;
}

export function useTradeSelection() {
  const ctx = useContext(TradeContext);
  if (!ctx) {
    throw new Error("useTradeSelection must be used within TradeProvider");
  }
  return ctx;
}
