"use client";

import styles from "./page.module.scss";
import { useEffect, useState, useCallback, Suspense } from "react";
import { Settings, BarChart2, Grid2X2, LogOut, History, User, Activity, Pause, Play } from "lucide-react";

const STRATEGY_URL = process.env.NEXT_PUBLIC_STRATEGY_API_URL || "http://localhost:4000";

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
import TotalExitPopup from "./TotalExitPopup";
import ChartDesktop from "./ChartDesktop";
import OptionsDesktop from "./OptionsDesktop";
import SettingsDesktop from "./SettingsDesktop";
import HistoryDesktop from "./HistoryDesktop";
import AccountDesktop from "./AccountDesktop";
import RiskManagement from "./RiskManagement";
import ActiveTradesDesktop from "./ActiveTradesDesktop";
import Nifty50MiniChart from "./Nifty50MiniChart";

type RightPanelTab = "chart" | "active" | "options" | "history" | "settings" | "account";

export default function DashboardPage() {
  const [isHydrated, setIsHydrated] = useState(false);
  const [activeLtps, setActiveLtps] = useState<Record<string, number>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chartOpen, setChartOpen] = useState(false);
  const [optionChainOpen, setOptionChainOpen] = useState(false);
  const [totalExitOpen, setTotalExitOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<RightPanelTab>("chart");
  const [activeStrategy, setActiveStrategy] = useState<string>("");
  const [previousStrategy, setPreviousStrategy] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("suralgo_previous_strategy") || "";
    }
    return "";
  });
  const [strategyLoading, setStrategyLoading] = useState(false);
  const {
    waitingTrades,
    removeWaitingTrade,
    activeTrades,
    logManualExit,
    desktopViewEnabled,
  } = useTradeStore();

  const fetchStrategyStatus = useCallback(async () => {
    try {
      const res = await fetch(`${STRATEGY_URL}/strategy`);
      if (!res.ok) return;
      const data = await res.json();
      if (data?.activeStrategy) {
        setActiveStrategy(data.activeStrategy);
        if (!data.activeStrategy.toLowerCase().includes("nothing")) {
          setPreviousStrategy(data.activeStrategy);
          if (typeof window !== "undefined") {
            localStorage.setItem("suralgo_previous_strategy", data.activeStrategy);
          }
        }
      }
    } catch {
      // strategy server unreachable
    }
  }, []);

  useEffect(() => {
    fetchStrategyStatus();
    const interval = setInterval(fetchStrategyStatus, 3000);
    const handleStrategyEvent = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (detail?.activeStrategy) {
        setActiveStrategy(detail.activeStrategy);
        if (!detail.activeStrategy.toLowerCase().includes("nothing")) {
          setPreviousStrategy(detail.activeStrategy);
          if (typeof window !== "undefined") {
            localStorage.setItem("suralgo_previous_strategy", detail.activeStrategy);
          }
        }
      }
    };
    window.addEventListener("strategy-changed", handleStrategyEvent);
    return () => {
      clearInterval(interval);
      window.removeEventListener("strategy-changed", handleStrategyEvent);
    };
  }, [fetchStrategyStatus]);

  const handleToggleStrategyPause = async () => {
    if (strategyLoading) return;
    setStrategyLoading(true);
    try {
      const isPaused = activeStrategy.toLowerCase().includes("nothing");
      let targetStrategy = "";
      if (isPaused) {
        targetStrategy = previousStrategy || "HEIKIN_DINKAN_BUGGY";
      } else {
        if (activeStrategy) {
          setPreviousStrategy(activeStrategy);
          if (typeof window !== "undefined") {
            localStorage.setItem("suralgo_previous_strategy", activeStrategy);
          }
        }
        targetStrategy = "NothingStrategy";
      }

      const res = await fetch(`${STRATEGY_URL}/strategy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategy: targetStrategy }),
      });
      const data = await res.json();
      const nextStrat = data?.activeStrategy || targetStrategy;
      setActiveStrategy(nextStrat);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("strategy-changed", { detail: { activeStrategy: nextStrat } }));
      }
    } catch {
      // error
    } finally {
      setStrategyLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
      <div className={`${styles.container} dashboard-container`}>
        <ConnectionStatus />

        <Watchlist />

        {desktopViewEnabled && activeTab === "active" && <Nifty50MiniChart />}

        {!(desktopViewEnabled && activeTab === "active") && <ActiveTrade
          activeTrades={activeTrades}
          waitingTrades={waitingTrades}
          activeLtps={activeLtps}
          isHydrated={isHydrated}
          onManualExit={logManualExit}
          onCancelWaiting={removeWaitingTrade}
        />}

        {!desktopViewEnabled && <TradeHistory />}

        {desktopViewEnabled ? (
          <RiskManagement />
        ) : (
          <Suspense fallback={<div>Loading...</div>}>
            <BrokerLoginCard />
          </Suspense>
        )}

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
          {desktopViewEnabled ? (
            activeStrategy.toLowerCase().includes("nothing") ? (
              <div
                className={styles.menuItem}
                style={{ cursor: strategyLoading ? "wait" : "pointer", color: "var(--theme-tailwind-green-500, #22c55e)" }}
                onClick={handleToggleStrategyPause}
                title={`Strategy Paused — Click to Resume (${previousStrategy || "active strategy"})`}
              >
                <Play size={20} />
                <span>Resume</span>
              </div>
            ) : (
              <div
                className={styles.menuItem}
                style={{ cursor: strategyLoading ? "wait" : "pointer" }}
                onClick={handleToggleStrategyPause}
                title="Click to Pause strategy (switches to Nothing Strategy)"
              >
                <Pause size={20} />
                <span>Pause</span>
              </div>
            )
          ) : (
            <div className={styles.menuItem} onClick={() => setTotalExitOpen(true)}>
              <LogOut size={20} />
              <span>Exit</span>
            </div>
          )}
        </div>

        <SettingsPopup open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        <ChartPopup open={chartOpen} onClose={() => setChartOpen(false)} />
        <OptionChainPopup open={optionChainOpen} onClose={() => setOptionChainOpen(false)} />
        <TotalExitPopup open={totalExitOpen} onClose={() => setTotalExitOpen(false)} />
      </div>
      {desktopViewEnabled && (
        <div className={styles.rightPanel}>
          <div className={styles.rightPanelTop}>
            <div className={`${styles.topMenuItem} ${activeTab === "chart" ? styles.topMenuItemActive : ""}`} onClick={() => setActiveTab("chart")}>
              <BarChart2 size={20} />
              <span>Chart</span>
            </div>
            <div className={`${styles.topMenuItem} ${activeTab === "active" ? styles.topMenuItemActive : ""}`} onClick={() => setActiveTab("active")}>
              <Activity size={20} />
              <span>Active</span>
            </div>
            <div className={`${styles.topMenuItem} ${activeTab === "options" ? styles.topMenuItemActive : ""}`} onClick={() => setActiveTab("options")}>
              <Grid2X2 size={20} />
              <span>Options</span>
            </div>
            <div className={`${styles.topMenuItem} ${activeTab === "history" ? styles.topMenuItemActive : ""}`} onClick={() => setActiveTab("history")}>
              <History size={20} />
              <span>History</span>
            </div>
            <div className={`${styles.topMenuItem} ${activeTab === "settings" ? styles.topMenuItemActive : ""}`} onClick={() => setActiveTab("settings")}>
              <Settings size={20} />
              <span>Settings</span>
            </div>
            <div className={`${styles.topMenuItem} ${activeTab === "account" ? styles.topMenuItemActive : ""}`} onClick={() => setActiveTab("account")}>
              <User size={20} />
              <span>Account</span>
            </div>
          </div>
          <div className={styles.rightPanelMain}>
            {activeTab === "chart" && <ChartDesktop />}
            {activeTab === "active" && (
              <ActiveTradesDesktop
                activeTrades={activeTrades}
                waitingTrades={waitingTrades}
                activeLtps={activeLtps}
                isHydrated={isHydrated}
                onManualExit={logManualExit}
                onCancelWaiting={removeWaitingTrade}
              />
            )}
            {activeTab === "options" && <OptionsDesktop />}
            {activeTab === "settings" && <SettingsDesktop />}
            {activeTab === "history" && <HistoryDesktop />}
            {activeTab === "account" && <AccountDesktop />}
          </div>
        </div>
      )}
    </div>
  );
}
