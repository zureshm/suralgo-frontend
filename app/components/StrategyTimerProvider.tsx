"use client";

import { useEffect, useCallback } from "react";
import { useTradeStore } from "../store/TradeStore";

export function StrategyTimerProvider({ children }: { children: React.ReactNode }) {
  const { syncFromServer } = useTradeStore();

  // Poll the server-side trade engine for state every 1 second.
  // All trade decisions (BUY/SELL/SL/Target/Trailing) now run in
  // a Node.js setInterval inside lib/trade-engine.ts — immune to
  // browser-tab throttling.
  const pollServer = useCallback(async () => {
    try {
      const res = await fetch("/api/trades");
      if (res.ok) {
        const state = await res.json();
        syncFromServer(state);
      }
    } catch { /* server not reachable yet */ }
  }, [syncFromServer]);

  useEffect(() => {
    pollServer();
    const interval = setInterval(pollServer, 1000);
    return () => clearInterval(interval);
  }, [pollServer]);

  // Immediate refresh when tab becomes visible again
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") pollServer();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [pollServer]);

  return <>{children}</>;
}
