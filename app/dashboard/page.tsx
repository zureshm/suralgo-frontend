"use client";

import styles from "./page.module.scss";
import { useEffect, useState } from "react";

import { useTradeStore } from "../store/TradeStore";
import { getPrices } from "@/lib/getPrices";
import TradeHistory from "./TradeHistory";
import AccountDetails from "./AccountDetails";
import ConnectionStatus from "./ConnectionStatus";
import Watchlist from "./Watchlist";
import ActiveTrade from "./ActiveTrade";

export default function DashboardPage() {
  const [isHydrated, setIsHydrated] = useState(false);
  const [activeLtps, setActiveLtps] = useState<Record<string, number>>({});
  const {
    waitingTrades,
    removeWaitingTrade,
    activeTrades,
    logManualExit,
  } = useTradeStore();

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  // LTP polling kept for unrealized P&L display in UI
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

        <div className={styles.bottomActions}></div>
      </div>
    </div>
  );
}