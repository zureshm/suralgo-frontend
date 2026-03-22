// Server-side trade engine singleton
// Runs setInterval on the Node.js server so browser tab throttling cannot affect it.
// Replicates ALL logic from StrategyTimerProvider + dashboard SL/Target monitoring.
// Persists state to data/trades.json so it survives server restarts.

import fs from "fs";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "trades.json");

type WaitingTrade = {
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
  waitAfterSellEnabled: boolean;
  waitAfterSellCandles: number;
};

type ActiveTrade = {
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
  waitAfterSellEnabled: boolean;
  waitAfterSellCandles: number;
  lastSellCandleTime?: string;
};

type TradeHistoryItem = {
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

// ─── In-memory state ───
let waitingTrades: WaitingTrade[] = [];
let activeTrades: ActiveTrade[] = [];
let tradeHistory: TradeHistoryItem[] = [];
let lastStrategyCandleTime = "";
let lastHandledSignalKey = "";
let engineRunning = false;
let intervalId: ReturnType<typeof setInterval> | null = null;

// SL/Target monitoring tracking (same as dashboard refs)
const armedPositions = new Set<string>();
const triggeredPositions = new Set<string>();
const trailingArmedPositions = new Set<string>();

// ─── JSON file persistence ───

function loadState() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, "utf-8");
      const data = JSON.parse(raw);
      if (Array.isArray(data.waitingTrades)) waitingTrades = data.waitingTrades;
      if (Array.isArray(data.activeTrades)) activeTrades = data.activeTrades;
      if (Array.isArray(data.tradeHistory)) tradeHistory = data.tradeHistory;
      if (typeof data.lastStrategyCandleTime === "string") lastStrategyCandleTime = data.lastStrategyCandleTime;
      if (typeof data.lastHandledSignalKey === "string") lastHandledSignalKey = data.lastHandledSignalKey;
      console.log(`[trade-engine] Loaded state from ${DB_PATH} (${waitingTrades.length} waiting, ${activeTrades.length} active, ${tradeHistory.length} history)`);
    }
  } catch (e) {
    console.error("[trade-engine] Failed to load state:", e);
  }
}

function persistState() {
  try {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(DB_PATH, JSON.stringify({
      waitingTrades,
      activeTrades,
      tradeHistory,
      lastStrategyCandleTime,
      lastHandledSignalKey,
    }, null, 2), "utf-8");
  } catch (e) {
    console.error("[trade-engine] Failed to persist state:", e);
  }
}

// ─── Helpers ───

function toMinutes(timeStr?: string): number {
  if (!timeStr) return -1;
  const match = String(timeStr).match(/(\d{1,2}):(\d{2})/);
  if (!match) return -1;
  return Number(match[1]) * 60 + Number(match[2]);
}

function toMinutes12h(timeStr: string, ampm: string): number {
  const match = String(timeStr).match(/(\d{1,2}):(\d{2})/);
  if (!match) return -1;
  let h = Number(match[1]);
  const m = Number(match[2]);
  if (ampm === "pm" && h < 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  return h * 60 + m;
}

function buildConfigSnapshot(trade: ActiveTrade): TradeHistoryItem["config"] {
  return {
    numberOfTrades: trade.numberOfTrades,
    stopLossNumberEnabled: Boolean(trade.stopLossNumberEnabled),
    stopLossNumber: trade.stopLossNumberEnabled ? trade.stopLossNumber : undefined,
    targetPointsEnabled: Boolean(trade.targetPointsEnabled),
    targetPoints: trade.targetPointsEnabled ? trade.targetPoints : undefined,
    trailingAfterTargetEnabled: Boolean(trade.trailingAfterTargetEnabled),
    trailingAfterTarget: trade.trailingAfterTargetEnabled ? trade.trailingAfterTarget : undefined,
    minToHoldEnabled: Boolean(trade.minToHoldEnabled),
    minToHold: trade.minToHoldEnabled ? trade.minToHold : undefined,
  };
}

function addHistoryEntry(symbol: string, pnl: number, logs: string[], config?: TradeHistoryItem["config"]) {
  const latest = tradeHistory[0];
  const lastLog = logs[logs.length - 1] ?? "";
  const latestLastLog = latest?.logs?.[latest.logs.length - 1] ?? "";
  const now = Date.now();
  const latestCreatedAt = latest?.createdAt ? new Date(latest.createdAt).getTime() : 0;
  if (
    latest &&
    latest.symbol === symbol &&
    latest.pnl === pnl &&
    latest.logs.length === logs.length &&
    latestLastLog === lastLog &&
    (now - latestCreatedAt) < 2000
  ) {
    return;
  }
  tradeHistory = [
    { id: `${symbol}-${Date.now()}`, symbol, pnl, logs, createdAt: new Date().toISOString(), config },
    ...tradeHistory,
  ];
}

// ─── Trade lifecycle (mirrors TradeStore functions) ───

function activateWaitingTrade(symbol: string, entryPrice: string, logLine: string) {
  const trade = waitingTrades.find((t) => t.symbol === symbol);
  if (!trade) return;

  const newActive: ActiveTrade = {
    symbol: trade.symbol,
    entryPrice,
    pnl: 0,
    logs: [...trade.logs, logLine],
    lotSize: trade.lotSize,
    lotValue: trade.lotValue,
    numberOfTrades: trade.numberOfTrades,
    stopLossNumberEnabled: trade.stopLossNumberEnabled,
    stopLossNumber: trade.stopLossNumber,
    targetPointsEnabled: trade.targetPointsEnabled,
    targetPoints: trade.targetPoints,
    minToHoldEnabled: trade.minToHoldEnabled,
    minToHold: trade.minToHold,
    trailingAfterTargetEnabled: trade.trailingAfterTargetEnabled,
    trailingAfterTarget: trade.trailingAfterTarget,
    trailingTrailActive: false,
    trailingHighWatermark: undefined,
    rangeEnabled: trade.rangeEnabled,
    timeFrom: trade.timeFrom,
    timeFromAmpm: trade.timeFromAmpm,
    timeTo: trade.timeTo,
    timeToAmpm: trade.timeToAmpm,
    inPosition: true,
    completedCycles: 0,
    buyOverride: trade.buyOverride,
    entryTime: logLine.includes("at ") ? logLine.split("at ")[1] : undefined,
    exitTime: undefined,
    exitPrice: undefined,
    status: "ACTIVE",
    waitAfterSellEnabled: trade.waitAfterSellEnabled,
    waitAfterSellCandles: trade.waitAfterSellCandles,
    lastSellCandleTime: undefined,
  };

  activeTrades = [...activeTrades, newActive];
  waitingTrades = waitingTrades.filter((t) => t.symbol !== symbol);
}

function completeActiveTrade(symbol: string, exitPrice: string, logLine: string) {
  activeTrades = activeTrades.map((trade) => {
    if (trade.symbol !== symbol || trade.status !== "ACTIVE") return trade;

    const entry = Number(trade.entryPrice);
    const exit = Number(exitPrice);
    if (Number.isNaN(entry) || Number.isNaN(exit)) {
      return { ...trade, logs: [...trade.logs, logLine, "Trade P/L: invalid price data"] };
    }

    const qty = trade.lotSize * trade.lotValue;
    const cyclePnl = (exit - entry) * qty;
    const totalPnl = trade.pnl + cyclePnl;
    const newCompletedCycles = trade.completedCycles + 1;

    if (newCompletedCycles >= trade.numberOfTrades) {
      const finalLogs = [
        ...trade.logs, logLine,
        `Trade P/L: ${cyclePnl.toFixed(2)}`,
        `Completed ${newCompletedCycles}/${trade.numberOfTrades} trades - Auto-exiting`,
      ];
      addHistoryEntry(trade.symbol, totalPnl, finalLogs, buildConfigSnapshot(trade));
      return {
        ...trade, pnl: totalPnl, inPosition: false, completedCycles: newCompletedCycles,
        exitPrice, logs: finalLogs, status: "COMPLETED" as const,
        trailingTrailActive: false, trailingHighWatermark: undefined,
      };
    }

    return {
      ...trade, pnl: totalPnl, inPosition: false, completedCycles: newCompletedCycles,
      logs: [...trade.logs, logLine, `Trade P/L: ${cyclePnl.toFixed(2)}`, `Cycle ${newCompletedCycles}/${trade.numberOfTrades} completed`],
      trailingTrailActive: false, trailingHighWatermark: undefined,
    };
  });
}

function completeCycleWithoutExit(symbol: string, exitPrice: string, logLine: string) {
  activeTrades = activeTrades.map((trade) => {
    if (trade.symbol !== symbol || trade.status !== "ACTIVE") return trade;

    const entry = Number(trade.entryPrice);
    const exit = Number(exitPrice);
    if (Number.isNaN(entry) || Number.isNaN(exit)) {
      return { ...trade, logs: [...trade.logs, logLine, "Trade P/L: invalid price data"] };
    }

    const qty = trade.lotSize * trade.lotValue;
    const cyclePnl = (exit - entry) * qty;
    const totalPnl = trade.pnl + cyclePnl;
    const newCompletedCycles = trade.completedCycles + 1;

    if (newCompletedCycles >= trade.numberOfTrades) {
      const finalLogs = [
        ...trade.logs, logLine,
        `Trade P/L: ${cyclePnl.toFixed(2)}`,
        `Completed ${newCompletedCycles}/${trade.numberOfTrades} trades - Auto-exiting`,
      ];
      addHistoryEntry(trade.symbol, totalPnl, finalLogs, buildConfigSnapshot(trade));
      return {
        ...trade, pnl: totalPnl, inPosition: false, completedCycles: newCompletedCycles,
        exitPrice, logs: finalLogs, status: "COMPLETED" as const,
        trailingTrailActive: false, trailingHighWatermark: undefined,
      };
    }

    return {
      ...trade, pnl: totalPnl, inPosition: false, completedCycles: newCompletedCycles,
      logs: [...trade.logs, logLine, `Trade P/L: ${cyclePnl.toFixed(2)}`, `Cycle ${newCompletedCycles}/${trade.numberOfTrades} completed (SL/Target hit - waiting for next signal)`],
      trailingTrailActive: false, trailingHighWatermark: undefined,
    };
  });
}

function updateActiveTradeBuy(symbol: string, entryPrice: string, logLine: string) {
  activeTrades = activeTrades.map((trade) => {
    if (trade.symbol !== symbol || trade.status !== "ACTIVE") return trade;
    return {
      ...trade, entryPrice, inPosition: true,
      logs: [...trade.logs, logLine],
      trailingTrailActive: false, trailingHighWatermark: undefined,
    };
  });
}

function addLogToWaiting(symbol: string, log: string) {
  waitingTrades = waitingTrades.map((t) =>
    t.symbol === symbol ? { ...t, logs: [...t.logs, log] } : t
  );
}

function addLogToActive(symbol: string, log: string) {
  activeTrades = activeTrades.map((t) =>
    t.symbol === symbol && t.status === "ACTIVE" ? { ...t, logs: [...t.logs, log] } : t
  );
}

function updateLastSellCandleTime(symbol: string, candleTime: string) {
  activeTrades = activeTrades.map((t) => {
    if (t.symbol !== symbol || t.status !== "ACTIVE") return t;
    return { ...t, lastSellCandleTime: candleTime };
  });
}

function activateTrailing(symbol: string, price: number, timeLabel: string) {
  activeTrades = activeTrades.map((t) => {
    if (t.symbol !== symbol || t.status !== "ACTIVE") return t;
    return {
      ...t, trailingTrailActive: true, trailingHighWatermark: price,
      logs: [...t.logs, `Trailing target armed at ₹${price.toFixed(2)} on ${timeLabel}`],
    };
  });
}

function updateHighWatermark(symbol: string, price: number) {
  activeTrades = activeTrades.map((t) => {
    if (t.symbol !== symbol || t.status !== "ACTIVE") return t;
    if (!t.trailingTrailActive) return t;
    if (t.trailingHighWatermark && price <= t.trailingHighWatermark) return t;
    return { ...t, trailingHighWatermark: price };
  });
}

// ─── Strategy signal handling (from StrategyTimerProvider) ───

function handleStrategySignal(signal: any) {
  if (!signal) return;

  const latestClose = signal.close ?? signal.candles?.[signal.candles.length - 1]?.close;
  const signalSymbol = signal.symbol;
  const activeForSymbol = activeTrades.find((t) => t.symbol === signalSymbol && t.status === "ACTIVE");
  const hasWaitingTrade = waitingTrades.some((t) => t.symbol === signalSymbol);
  const waitingForBuy = (!activeForSymbol || !activeForSymbol.inPosition) && (hasWaitingTrade || Boolean(activeForSymbol));
  const waitingForSell = Boolean(activeForSymbol && activeForSymbol.inPosition);

  const candleTime = signal.lastCandleTime || signal.candles?.[signal.candles.length - 1]?.time;
  if (candleTime) {
    lastStrategyCandleTime = candleTime;
  }

  // Auto-sell cutoff at 3:05 PM
  const AUTO_SELL_CUTOFF_MINUTES = 15 * 60 + 5;
  const candleMinutes = toMinutes(signal.lastCandleTime);

  if (candleMinutes >= AUTO_SELL_CUTOFF_MINUTES && activeForSymbol && activeForSymbol.inPosition) {
    completeActiveTrade(
      activeForSymbol.symbol,
      String(latestClose ?? ""),
      `AUTO SELL triggered post 03:05 pm cut-off at ₹${String(latestClose ?? "")} (${signal.lastCandleTime})`
    );
    updateLastSellCandleTime(activeForSymbol.symbol, signal.lastCandleTime ?? "15:05");
    return;
  }

  // STOPLOSS signal
  if (signal.signal === "STOPLOSS") {
    const signalKey = signal.signal + "-" + signal.lastCandleTime;
    if (signalKey === lastHandledSignalKey) return;
    if (!activeForSymbol || !activeForSymbol.inPosition) return;
    completeCycleWithoutExit(activeForSymbol.symbol, String(latestClose ?? ""), "STOPLOSS hit for ₹" + String(latestClose ?? "") + " at " + signal.lastCandleTime);
    lastHandledSignalKey = signalKey;
    return;
  }

  // TARGET signal
  if (signal.signal === "TARGET") {
    const signalKey = signal.signal + "-" + signal.lastCandleTime;
    if (signalKey === lastHandledSignalKey) return;
    if (!activeForSymbol || !activeForSymbol.inPosition) return;
    if (activeForSymbol.trailingAfterTargetEnabled && activeForSymbol.trailingAfterTarget > 0) {
      lastHandledSignalKey = signalKey;
      return;
    }
    completeCycleWithoutExit(activeForSymbol.symbol, String(latestClose ?? ""), "TARGET hit for ₹" + String(latestClose ?? "") + " at " + signal.lastCandleTime);
    lastHandledSignalKey = signalKey;
    return;
  }

  // SELL signal
  if (signal.signal === "SELL") {
    const signalKey = signal.signal + "-" + signal.lastCandleTime;
    if (signalKey === lastHandledSignalKey) return;
    if (waitingForBuy) return;
    if (!activeForSymbol || !activeForSymbol.inPosition) return;
    completeActiveTrade(activeForSymbol.symbol, String(latestClose ?? ""), "SELL triggered for ₹" + String(latestClose ?? "") + " at " + signal.lastCandleTime);
    updateLastSellCandleTime(activeForSymbol.symbol, signal.lastCandleTime);
    lastHandledSignalKey = signalKey;
    return;
  }

  // WAIT signal
  if (signal.signal === "WAIT") {
    const signalKey = signal.signal + "-" + signal.lastCandleTime;
    if (signalKey === lastHandledSignalKey) return;
    lastHandledSignalKey = signalKey;
    return;
  }

  // BUY signal
  if (signal.signal === "BUY") {
    const signalKey = signal.signal + "-" + signal.lastCandleTime;
    if (signalKey === lastHandledSignalKey) return;
    if (waitingForSell) return;

    const matchingTrade = waitingTrades.find((t) => t.symbol === signal.symbol);

    // Candle size check for Wait Strategy (buyOverride)
    const candles = signal.candles;
    const prevCandle = Array.isArray(candles) && candles.length > 0 ? candles[candles.length - 1] : null;
    const candleSize = prevCandle ? Math.abs(Number(prevCandle.close) - Number(prevCandle.open)) : 0;

    // Time range check
    const tradeForRange = matchingTrade ?? (activeForSymbol && !activeForSymbol.inPosition ? activeForSymbol : null);
    if (tradeForRange && tradeForRange.rangeEnabled) {
      const rangeStart = toMinutes12h(tradeForRange.timeFrom, tradeForRange.timeFromAmpm);
      const rangeEnd = toMinutes12h(tradeForRange.timeTo, tradeForRange.timeToAmpm);
      const cMin = toMinutes(signal.lastCandleTime);
      if (cMin >= 0 && (cMin < rangeStart || cMin > rangeEnd)) {
        const skippedLog = `BUY skipped – outside time range (${tradeForRange.timeFrom} ${tradeForRange.timeFromAmpm} – ${tradeForRange.timeTo} ${tradeForRange.timeToAmpm}) for ₹${latestClose ?? ""} at ${signal.lastCandleTime}`;
        if (matchingTrade) { addLogToWaiting(matchingTrade.symbol, skippedLog); }
        else if (activeForSymbol && !activeForSymbol.inPosition) { addLogToActive(activeForSymbol.symbol, skippedLog); }
        lastHandledSignalKey = signalKey;
        return;
      }
    }

    // Wait-after-SELL check
    const tradeForWaitCheck = matchingTrade ?? (activeForSymbol && !activeForSymbol.inPosition ? activeForSymbol : null);
    if (tradeForWaitCheck && tradeForWaitCheck.waitAfterSellEnabled && activeForSymbol?.lastSellCandleTime) {
      const lastSellMin = toMinutes(activeForSymbol.lastSellCandleTime);
      const currentMin = toMinutes(signal.lastCandleTime);
      if (lastSellMin >= 0 && currentMin >= 0) {
        const candlesPassed = currentMin - lastSellMin;
        if (candlesPassed < tradeForWaitCheck.waitAfterSellCandles) {
          const waitLog = `BUY skipped – waiting ${tradeForWaitCheck.waitAfterSellCandles} candles after SELL (${candlesPassed} passed) at ${signal.lastCandleTime}`;
          if (matchingTrade) { addLogToWaiting(matchingTrade.symbol, waitLog); }
          else if (activeForSymbol && !activeForSymbol.inPosition) { addLogToActive(activeForSymbol.symbol, waitLog); }
          lastHandledSignalKey = signalKey;
          return;
        }
      }
    }

    // buyOverride check
    const overrideValue = matchingTrade?.buyOverride ?? activeForSymbol?.buyOverride;
    if (overrideValue != null && overrideValue > 0 && candleSize >= overrideValue) {
      const ignoredLog = `BUY ignored – candle size ${candleSize.toFixed(2)} >= buyOverride ${overrideValue} at ${signal.lastCandleTime}`;
      if (matchingTrade) { addLogToWaiting(matchingTrade.symbol, ignoredLog); }
      else if (activeForSymbol && !activeForSymbol.inPosition) { addLogToActive(activeForSymbol.symbol, ignoredLog); }
      lastHandledSignalKey = signalKey;
      return;
    }

    if (matchingTrade) {
      activateWaitingTrade(matchingTrade.symbol, String(latestClose ?? ""), "BUY triggered for ₹ " + String(latestClose ?? "") + " at " + signal.lastCandleTime);
    } else if (activeForSymbol && !activeForSymbol.inPosition) {
      updateActiveTradeBuy(activeForSymbol.symbol, String(latestClose ?? ""), "BUY triggered for ₹ " + String(latestClose ?? "") + " at " + signal.lastCandleTime);
    }

    lastHandledSignalKey = signalKey;
  }
}

// ─── LTP-based SL/Target/Trailing monitoring (from dashboard/page.tsx) ───

function handleLtpMonitoring(ltpMap: Record<string, number>) {
  for (const trade of activeTrades) {
    if (!trade.inPosition) {
      const positionKey = `${trade.symbol}-${trade.entryPrice}`;
      triggeredPositions.delete(positionKey);
      armedPositions.delete(positionKey);
      trailingArmedPositions.delete(positionKey);
      continue;
    }
    if (trade.status !== "ACTIVE") continue;

    const ltp = ltpMap[trade.symbol];
    const entry = Number(trade.entryPrice);
    if (!Number.isFinite(ltp) || !Number.isFinite(entry)) continue;

    const positionKey = `${trade.symbol}-${trade.entryPrice}`;

    if (!armedPositions.has(positionKey)) {
      armedPositions.add(positionKey);
      continue;
    }
    if (triggeredPositions.has(positionKey)) continue;

    const priceDiff = ltp - entry;
    const currentTime = lastStrategyCandleTime || new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }).replace("am", "").replace("pm", "");

    const trailingEnabled = trade.targetPointsEnabled && trade.targetPoints > 0 && trade.trailingAfterTargetEnabled && trade.trailingAfterTarget > 0;

    // Minimum Target logic
    if (trade.minToHoldEnabled && trade.minToHold > 0) {
      const trailLevel = entry + trade.minToHold;
      const activationLevel = trailLevel + 2;
      if (!trailingArmedPositions.has(positionKey)) {
        if (ltp >= activationLevel) { trailingArmedPositions.add(positionKey); }
      } else {
        if (ltp <= trailLevel) {
          triggeredPositions.add(positionKey);
          trailingArmedPositions.delete(positionKey);
          completeCycleWithoutExit(trade.symbol, String(ltp), `MINIMUM TARGET hit for ₹${ltp} at ${currentTime}`);
          continue;
        }
      }
    } else {
      trailingArmedPositions.delete(positionKey);
    }

    // Trailing after target
    if (trailingEnabled && trade.trailingTrailActive) {
      if (typeof trade.trailingHighWatermark !== "number" || ltp > trade.trailingHighWatermark) {
        updateHighWatermark(trade.symbol, ltp);
      }
      const highMark = trade.trailingHighWatermark ?? ltp;
      const drop = highMark - ltp;
      if (drop >= trade.trailingAfterTarget) {
        triggeredPositions.add(positionKey);
        completeCycleWithoutExit(trade.symbol, String(ltp), `Trailing target hit for ₹${ltp} at ${currentTime}`);
        continue;
      }
    }

    // Target hit
    if (trade.targetPointsEnabled && trade.targetPoints > 0 && priceDiff >= trade.targetPoints) {
      if (trailingEnabled) {
        if (!trade.trailingTrailActive) {
          activateTrailing(trade.symbol, ltp, currentTime);
        }
        continue;
      }
      triggeredPositions.add(positionKey);
      completeCycleWithoutExit(trade.symbol, String(ltp), `TARGET hit for ₹${ltp} at ${currentTime}`);
      continue;
    }

    // Stop loss hit
    if (trade.stopLossNumberEnabled && trade.stopLossNumber > 0 && priceDiff <= -trade.stopLossNumber) {
      triggeredPositions.add(positionKey);
      completeCycleWithoutExit(trade.symbol, String(ltp), `STOPLOSS hit for ₹${ltp} at ${currentTime}`);
      continue;
    }
  }
}

// ─── Main tick: called every 1 second by the server-side setInterval ───

async function tick() {
  try {
    // 1. Fetch strategy signal from port 4000
    let signal = null;
    try {
      const res = await fetch("http://localhost:4000/evaluate");
      signal = await res.json();
    } catch { /* strategy engine not running */ }

    if (signal) {
      handleStrategySignal(signal);
    }

    // 2. Fetch LTP prices from port 2000 for active trades in position
    const inPositionTrades = activeTrades.filter((t) => t.inPosition && t.status === "ACTIVE");
    if (inPositionTrades.length > 0) {
      const symbols = inPositionTrades.map((t) => t.symbol);
      try {
        const list = symbols.join(",");
        const res = await fetch(`http://localhost:2000/prices?symbols=${list}`);
        const prices = await res.json();
        const ltpMap: Record<string, number> = {};
        if (Array.isArray(prices)) {
          for (const p of prices) {
            if (p?.symbol) {
              const v = Number(p.ltp);
              if (Number.isFinite(v)) { ltpMap[p.symbol] = v; }
            }
          }
        }
        handleLtpMonitoring(ltpMap);
      } catch { /* market data not running */ }
    }
  } catch (e) {
    console.error("[trade-engine] tick error:", e);
  }
  persistState();
}

// ─── Public API ───

export function getEngineState() {
  return {
    waitingTrades,
    activeTrades,
    tradeHistory,
    lastStrategyCandleTime,
    engineRunning,
  };
}

export function addWaitingTrade(trade: WaitingTrade) {
  // Don't add duplicate
  if (waitingTrades.some((t) => t.symbol === trade.symbol)) return;
  waitingTrades = [trade, ...waitingTrades];
  persistState();
  ensureEngineRunning();
}

export function cancelWaitingTrade(symbol: string) {
  waitingTrades = waitingTrades.filter((t) => t.symbol !== symbol);
  persistState();
}

export function manualExit(symbol: string, exitPrice: string, lastCandleTime: string) {
  activeTrades = activeTrades.map((trade) => {
    if (trade.symbol !== symbol || trade.status !== "ACTIVE") return trade;

    const exitLog = trade.inPosition
      ? `SELL manually for ₹${exitPrice} at ${lastCandleTime}`
      : `EXIT  at ${lastCandleTime}`;

    const entry = Number(trade.entryPrice);
    const exit = Number(exitPrice);
    const qty = trade.lotSize * trade.lotValue;
    const currentCyclePnl = trade.inPosition && Number.isFinite(exit) && Number.isFinite(entry)
      ? (exit - entry) * qty
      : 0;
    const totalPnl = trade.pnl + currentCyclePnl;

    const pnlLog = `Trade P/L: ${currentCyclePnl.toFixed(2)}`;
    const finalLogs = [...trade.logs, exitLog, pnlLog];

    addHistoryEntry(trade.symbol, totalPnl, finalLogs, buildConfigSnapshot(trade));

    return {
      ...trade, exitPrice, exitTime: lastCandleTime, status: "COMPLETED" as const,
      inPosition: false, pnl: totalPnl, logs: finalLogs,
    };
  });

  // Remove completed trades
  activeTrades = activeTrades.filter((t) => !(t.symbol === symbol && t.status === "COMPLETED"));
  persistState();
}

export function removeCompletedTrade(symbol: string) {
  activeTrades = activeTrades.filter((t) => t.symbol !== symbol);
  persistState();
}

export function clearHistory() {
  tradeHistory = [];
  persistState();
}

export function removeHistoryEntry(id: string) {
  tradeHistory = tradeHistory.filter((t) => t.id !== id);
  persistState();
}

export function ensureEngineRunning() {
  if (engineRunning) return;
  engineRunning = true;
  console.log("[trade-engine] Starting server-side timer loop");
  intervalId = setInterval(tick, 1000);
}

export function stopEngine() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  engineRunning = false;
  console.log("[trade-engine] Stopped server-side timer loop");
}

// Load persisted state and auto-start the engine when this module is first imported on the server
loadState();
ensureEngineRunning();
