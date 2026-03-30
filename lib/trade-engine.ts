// Server-side trade engine singleton

// Runs setInterval on the Node.js server so browser tab throttling cannot affect it.

// Replicates ALL logic from StrategyTimerProvider + dashboard SL/Target monitoring.

// Persists state to data/trades.json so it survives server restarts.



import fs from "fs";
import path from "path";

const API_URL = process.env.NEXT_PUBLIC_API_BASE_URL!;
const STRATEGY_URL = process.env.NEXT_PUBLIC_STRATEGY_API_URL!;



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

  maxProfitLossEnabled: boolean;

  maxProfit: number;

  maxLoss: number;

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

  maxProfitLossEnabled: boolean;

  maxProfit: number;

  maxLoss: number;

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



let persistInFlight = false;

function persistState() {

  if (persistInFlight) return;

  persistInFlight = true;

  try {

    const dir = path.dirname(DB_PATH);

    if (!fs.existsSync(dir)) {

      fs.mkdirSync(dir, { recursive: true });

    }

    const data = JSON.stringify({

      waitingTrades,

      activeTrades,

      tradeHistory,

      lastStrategyCandleTime,

      lastHandledSignalKey,

    }, null, 2);

    fs.writeFile(DB_PATH, data, "utf-8", (err) => {

      persistInFlight = false;

      if (err) console.error("[trade-engine] Failed to persist state:", err);

    });

  } catch (e) {

    persistInFlight = false;

    console.error("[trade-engine] Failed to persist state:", e);

  }

}



// ─── State Cleanup ───

function cleanupStaleState() {
  const validPositionKeys = new Set();
  
  // Collect valid position keys from current active trades
  for (const trade of activeTrades) {
    if (trade.status === "ACTIVE" && trade.inPosition) {
      const positionKey = `${trade.symbol}-${trade.entryPrice}`;
      validPositionKeys.add(positionKey);
    }
  }
  
  // Remove invalid keys from all tracking Sets
  for (const key of armedPositions) {
    if (!validPositionKeys.has(key)) armedPositions.delete(key);
  }
  
  for (const key of triggeredPositions) {
    if (!validPositionKeys.has(key)) triggeredPositions.delete(key);
  }
  
  for (const key of trailingArmedPositions) {
    if (!validPositionKeys.has(key)) trailingArmedPositions.delete(key);
  }
}

// ─── Helpers ───



function fmtTime(candleTime?: string): string {
  if (!candleTime) return "";
  const m = String(candleTime).match(/(\d{1,2}:\d{2})/);
  const hhmm = m ? m[1] : candleTime;
  const ss = String(new Date().getSeconds()).padStart(2, "0");
  return `${hhmm}:${ss}`;
}

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

    maxProfitLossEnabled: trade.maxProfitLossEnabled,

    maxProfit: trade.maxProfit,

    maxLoss: trade.maxLoss,

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



function forceExitTrade(symbol: string, exitPrice: string, totalPnl: number, logLine: string) {
  activeTrades = activeTrades.map((trade) => {
    if (trade.symbol !== symbol || trade.status !== "ACTIVE") return trade;

    const currentTime = logLine.split(" at ").pop() || "";
    const sellLog = trade.inPosition ? `SELL triggered for ₹${exitPrice} at ${currentTime}` : "";

    const entry = Number(trade.entryPrice);
    const exit = Number(exitPrice);
    const qty = trade.lotSize * trade.lotValue;
    const cyclePnl = (trade.inPosition && Number.isFinite(entry) && Number.isFinite(exit)) ? (exit - entry) * qty : 0;
    const newCompletedCycles = trade.inPosition ? trade.completedCycles + 1 : trade.completedCycles;

    const finalLogs = [
      ...trade.logs,
      ...(sellLog ? [sellLog] : []),
      ...(trade.inPosition ? [`Trade P/L: ${cyclePnl.toFixed(2)}`, `Cycle ${newCompletedCycles}/${trade.numberOfTrades} completed`] : []),
      logLine,
      `Total P/L: ${totalPnl.toFixed(2)}`,
    ];

    addHistoryEntry(trade.symbol, totalPnl, finalLogs, buildConfigSnapshot(trade));

    return {
      ...trade,
      pnl: totalPnl,
      inPosition: false,
      completedCycles: newCompletedCycles,
      exitPrice,
      logs: finalLogs,
      status: "COMPLETED" as const,
      trailingTrailActive: false,
      trailingHighWatermark: undefined,
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

    const currentTime = logLine.split(" at ").pop() || "";
    const sellLog = `SELL triggered for ₹${exitPrice} at ${currentTime}`;

    if (newCompletedCycles >= trade.numberOfTrades) {

      const finalLogs = [

        ...trade.logs, sellLog, logLine,

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

      logs: [...trade.logs, sellLog, logLine, `Trade P/L: ${cyclePnl.toFixed(2)}`, `Cycle ${newCompletedCycles}/${trade.numberOfTrades} completed (SL/Target hit - waiting for next signal)`],

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

      `AUTO SELL triggered post 03:05 pm cut-off at ₹${String(latestClose ?? "")} (${fmtTime(signal.lastCandleTime)})`

    );

    updateLastSellCandleTime(activeForSymbol.symbol, signal.lastCandleTime ?? "15:05");

    return;

  }



  // STOPLOSS signal

  if (signal.signal === "STOPLOSS") {

    const signalKey = signal.signal + "-" + signal.lastCandleTime;

    if (signalKey === lastHandledSignalKey) return;

    if (!activeForSymbol || !activeForSymbol.inPosition) return;

    completeCycleWithoutExit(activeForSymbol.symbol, String(latestClose ?? ""), "STOPLOSS hit for ₹" + String(latestClose ?? "") + " at " + fmtTime(signal.lastCandleTime));

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

    completeCycleWithoutExit(activeForSymbol.symbol, String(latestClose ?? ""), "TARGET hit for ₹" + String(latestClose ?? "") + " at " + fmtTime(signal.lastCandleTime));

    lastHandledSignalKey = signalKey;

    return;

  }



  // SELL signal

  if (signal.signal === "SELL") {

    const signalKey = signal.signal + "-" + signal.lastCandleTime;

    if (signalKey === lastHandledSignalKey) return;

    if (waitingForBuy) return;

    if (!activeForSymbol || !activeForSymbol.inPosition) return;

    completeActiveTrade(activeForSymbol.symbol, String(latestClose ?? ""), "SELL triggered for ₹" + String(latestClose ?? "") + " at " + fmtTime(signal.lastCandleTime));

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

        const skippedLog = `BUY skipped – outside time range (${tradeForRange.timeFrom} ${tradeForRange.timeFromAmpm} – ${tradeForRange.timeTo} ${tradeForRange.timeToAmpm}) for ₹${latestClose ?? ""} at ${fmtTime(signal.lastCandleTime)}`;

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

          const waitLog = `BUY skipped – waiting ${tradeForWaitCheck.waitAfterSellCandles} candles after SELL (${candlesPassed} passed) at ${fmtTime(signal.lastCandleTime)}`;

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

      const ignoredLog = `BUY ignored – candle size ${candleSize.toFixed(2)} >= buyOverride ${overrideValue} at ${fmtTime(signal.lastCandleTime)}`;

      if (matchingTrade) { addLogToWaiting(matchingTrade.symbol, ignoredLog); }

      else if (activeForSymbol && !activeForSymbol.inPosition) { addLogToActive(activeForSymbol.symbol, ignoredLog); }

      lastHandledSignalKey = signalKey;

      return;

    }



    if (matchingTrade) {

      activateWaitingTrade(matchingTrade.symbol, String(latestClose ?? ""), "BUY triggered for ₹ " + String(latestClose ?? "") + " at " + fmtTime(signal.lastCandleTime));

    } else if (activeForSymbol && !activeForSymbol.inPosition) {

      updateActiveTradeBuy(activeForSymbol.symbol, String(latestClose ?? ""), "BUY triggered for ₹ " + String(latestClose ?? "") + " at " + fmtTime(signal.lastCandleTime));

    }



    lastHandledSignalKey = signalKey;

  }

}



// ─── LTP-based SL/Target/Trailing monitoring (from dashboard/page.tsx) ───



function handleLtpMonitoring(ltpMap: Record<string, number>) {

  for (const trade of activeTrades) {

    if (trade.status !== "ACTIVE") continue;

    const ltp = ltpMap[trade.symbol];
    if (!Number.isFinite(ltp)) continue;

    const currentTime = fmtTime(lastStrategyCandleTime) || new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

    // ── Max Profit / Max Loss check (runs even when NOT in position) ──
    // This is the overall trade-level guard — takes priority over per-cycle SL/target.
    if (trade.maxProfitLossEnabled) {
      const qty = trade.lotSize * trade.lotValue;
      const entry = Number(trade.entryPrice);
      const currentCyclePnl = (trade.inPosition && Number.isFinite(entry)) ? (ltp - entry) * qty : 0;
      const totalPnl = trade.pnl + currentCyclePnl;

      if (trade.maxProfit > 0 && totalPnl >= trade.maxProfit) {
        forceExitTrade(trade.symbol, String(ltp), totalPnl, `MAX PROFIT ₹${trade.maxProfit} reached (P/L: ₹${totalPnl.toFixed(2)}) at ${currentTime}`);
        continue;
      }

      if (trade.maxLoss > 0 && totalPnl <= -trade.maxLoss) {
        forceExitTrade(trade.symbol, String(ltp), totalPnl, `MAX LOSS ₹${trade.maxLoss} reached (P/L: ₹${totalPnl.toFixed(2)}) at ${currentTime}`);
        continue;
      }
    }

    if (!trade.inPosition) {

      const positionKey = `${trade.symbol}-${trade.entryPrice}`;

      triggeredPositions.delete(positionKey);

      armedPositions.delete(positionKey);

      trailingArmedPositions.delete(positionKey);

      continue;

    }



    const entry = Number(trade.entryPrice);

    if (!Number.isFinite(entry)) continue;



    const positionKey = `${trade.symbol}-${trade.entryPrice}`;



    if (!armedPositions.has(positionKey)) {

      armedPositions.add(positionKey);

      continue;

    }

    if (triggeredPositions.has(positionKey)) continue;



    const priceDiff = ltp - entry;



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

  if (!engineRunning) {
    console.log("[trade-engine] Tick called but engine not running, skipping");
    return;
  }
  
  try {

    // 1. Fetch strategy signals from port 4000 for each relevant symbol
    //    - waiting trades (need BUY to activate)
    //    - active trades not in position (need BUY to re-enter after SELL/SL/Target)

    const symbolsToQuery = new Set<string>();
    for (const t of waitingTrades) symbolsToQuery.add(t.symbol);
    for (const t of activeTrades) {
      if (t.status === "ACTIVE" && !t.inPosition) symbolsToQuery.add(t.symbol);
      if (t.status === "ACTIVE" && t.inPosition) symbolsToQuery.add(t.symbol);
    }

    for (const sym of symbolsToQuery) {
      try {
        const res = await fetch(`${STRATEGY_URL}/evaluate?symbol=${encodeURIComponent(sym)}`);
        const signal = await res.json();
        if (signal && signal.signal) {
          handleStrategySignal(signal);
        }
      } catch { /* strategy engine not running */ }
    }



    // 2. Fetch LTP prices from port 2000 for active trades in position

    const inPositionTrades = activeTrades.filter((t) => t.inPosition && t.status === "ACTIVE");

    if (inPositionTrades.length > 0) {

      const symbols = inPositionTrades.map((t) => t.symbol);

      try {

        const list = symbols.join(",");

        const res = await fetch(`${API_URL}/prices?symbols=${list}`);

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

  // Clean up stale state before adding new trade
  cleanupStaleState();

  waitingTrades = [trade, ...waitingTrades];

  persistState();

  ensureEngineRunning();

}



export function activateWaitingTradeFromClient(symbol: string, entryPrice: string, logLine: string, candleSize?: number) {
  const trade = waitingTrades.find((t) => t.symbol === symbol);
  if (!trade) return;

  // Time range guard
  if (trade.rangeEnabled) {
    const timeMatch = logLine.match(/at (\d{2}:\d{2})/);
    if (timeMatch) {
      const cMin = toMinutes(timeMatch[1]);
      const rangeStart = toMinutes12h(trade.timeFrom, trade.timeFromAmpm);
      const rangeEnd = toMinutes12h(trade.timeTo, trade.timeToAmpm);
      if (cMin >= 0 && (cMin < rangeStart || cMin > rangeEnd)) {
        addLogToWaiting(symbol, `BUY skipped – outside time range (${trade.timeFrom} ${trade.timeFromAmpm} – ${trade.timeTo} ${trade.timeToAmpm}) for ₹${entryPrice} at ${timeMatch[1]}`);
        persistState();
        return;
      }
    }
  }

  // buyOverride guard
  if (trade.buyOverride != null && trade.buyOverride > 0 && typeof candleSize === "number" && candleSize >= trade.buyOverride) {
    const timeMatch = logLine.match(/at (.+)$/);
    const atTime = timeMatch ? timeMatch[1] : "";
    addLogToWaiting(symbol, `BUY ignored – candle size ${candleSize.toFixed(2)} >= buyOverride ${trade.buyOverride} at ${atTime}`);
    persistState();
    return;
  }

  activateWaitingTrade(symbol, entryPrice, logLine);
  persistState();
}

export async function forceBuyWaitingTrade(symbol: string) {
  const trade = waitingTrades.find((t) => t.symbol === symbol);
  if (!trade) return;

  // Fetch current LTP
  let entryPrice = "0";
  try {
    const res = await fetch(`${API_URL}/prices?symbols=${encodeURIComponent(symbol)}`);
    const prices = await res.json();
    if (Array.isArray(prices) && prices.length > 0 && prices[0]?.ltp) {
      entryPrice = String(prices[0].ltp);
    }
  } catch { /* fallback to 0 */ }

  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const timeStr = `${hh}:${mm}:${ss}`;
  const logLine = `FORCE BUY triggered for ₹${entryPrice} at ${timeStr}`;

  activateWaitingTrade(symbol, entryPrice, logLine);
  persistState();
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

