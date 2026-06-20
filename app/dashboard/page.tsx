"use client";

import styles from "./page.module.scss";
import { useEffect, useState, Suspense } from "react";
import { Settings, BarChart2, Grid2X2, LogOut } from "lucide-react";

import { useTradeStore } from "../store/TradeStore";
import { getPrices } from "@/lib/getPrices";
import TradeHistory from "./TradeHistory";
import BrokerLoginCard from "./BrokerLoginCard";
import ConnectionStatus from "./ConnectionStatus";
import Watchlist from "./Watchlist";
import ActiveTrade from "./ActiveTrade";
import SettingsPopup from "./SettingsPopup";
import ChartPopup from "./ChartPopup";
import OptionChainPopup from "./OptionChainPopup";

export default function DashboardPage() {
  const [isHydrated, setIsHydrated] = useState(false);
  const [activeLtps, setActiveLtps] = useState<Record<string, number>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chartOpen, setChartOpen] = useState(false);
  const [optionChainOpen, setOptionChainOpen] = useState(false);
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

        <Suspense fallback={<div>Loading...</div>}>
          <BrokerLoginCard />
        </Suspense>

        <div className={styles.bottomActions}></div>

        <div className={styles.bottomMenu}>
          <div className={styles.menuItem} onClick={() => setSettingsOpen(true)}>
            <Settings size={20} />
            <span>Settings</span>
          </div>
          <div className={styles.menuItem} onClick={() => setChartOpen(true)}>
            <BarChart2 size={20} />
            <span>Chart</span>
          </div>
          <div className={styles.menuItem} onClick={() => setOptionChainOpen(true)}>
            <Grid2X2 size={20} />
            <span>Options</span>
          </div>
          <div className={styles.menuItem}>
            <LogOut size={20} />
            <span>Exit</span>
          </div>
        </div>

        <SettingsPopup open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        <ChartPopup open={chartOpen} onClose={() => setChartOpen(false)} />
        <OptionChainPopup open={optionChainOpen} onClose={() => setOptionChainOpen(false)} />
      </div>
    </div>
  );
}