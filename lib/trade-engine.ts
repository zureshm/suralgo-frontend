// Server-side trade engine singleton

// Runs setInterval on the Node.js server so browser tab throttling cannot affect it.

// Replicates ALL logic from StrategyTimerProvider + dashboard SL/Target monitoring.

// Persists state to data/trades.json so it survives server restarts.



import fs from "fs";
import path from "path";

const API_URL = process.env.NEXT_PUBLIC_API_BASE_URL!;
const STRATEGY_URL = process.env.NEXT_PUBLIC_STRATEGY_API_URL!;
const ANGELONE_EXECUTION_URL = process.env.NEXT_PUBLIC_TRADE_EXECUTION_URL || "http://localhost:5000";
const FLATTRADE_EXECUTION_URL = process.env.NEXT_PUBLIC_FLATTRADE_EXECUTION_URL || "http://localhost:5001";

// Active broker execution URL — updated when user connects/disconnects a broker
let activeBrokerUrl: string = ANGELONE_EXECUTION_URL;

export function setActiveBrokerUrl(url: string) {
  activeBrokerUrl = url;
  console.log(`[trade-engine] Active broker URL set to: ${url}`);
}

export function getActiveBrokerUrl(): string {
  return activeBrokerUrl;
}

// Auto-detect which broker is logged in (called on engine start)
async function detectActiveBroker() {
  for (const [label, url] of [["angelone", ANGELONE_EXECUTION_URL], ["flattrade", FLATTRADE_EXECUTION_URL]] as const) {
    try {
      const res = await fetch(`${url}/auth/status`);
      const data = await res.json();
      if (data.isLoggedIn) {
        activeBrokerUrl = url;
        console.log(`[trade-engine] Detected active broker: ${label} at ${url}`);
        return;
      }
    } catch {
      // server not reachable
    }
  }
  console.log(`[trade-engine] No broker logged in — defaulting to Angel One URL`);
}



const DB_PATH = path.join(process.cwd(), "data", "trades.json");

// Add a symbol to angel-feed active strategy symbols (fire-and-forget)
function tryAddActiveStrategySymbol(symbol: string) {
  fetch(`${API_URL}/active-strategy-symbols`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol }),
  }).catch(() => {});
}

// Remove a symbol from angel-feed active strategy symbols if no other trade uses it
function tryRemoveActiveStrategySymbol(symbol: string) {
  const stillUsed =
    waitingTrades.some((t) => t.symbol === symbol) ||
    activeTrades.some((t) => t.symbol === symbol && t.status === "ACTIVE");
  if (!stillUsed) {
    fetch(`${API_URL}/active-strategy-symbols`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol }),
    }).catch(() => {});
  }
}

// Full sync: ensure port 2000 activeStrategySymbols matches current waiting+active trades
async function syncActiveStrategySymbols() {
  try {
    const res = await fetch(`${API_URL}/active-strategy-symbols`);
    const data = await res.json();
    const current: string[] = Array.isArray(data.symbols) ? data.symbols : [];

    const desired = new Set<string>();
    for (const t of waitingTrades) desired.add(t.symbol);
    for (const t of activeTrades) {
      if (t.status === "ACTIVE") desired.add(t.symbol);
    }

    // Add missing symbols
    for (const sym of desired) {
      if (!current.includes(sym)) {
        await fetch(`${API_URL}/active-strategy-symbols`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol: sym }),
        }).catch(() => {});
      }
    }

    console.log("[trade-engine] Synced active strategy symbols to feed server:", [...desired]);
  } catch {
    // Feed server not running
  }
}

// Send real broker order to trade-execution backend (fire-and-forget)
function sendBrokerOrder(symbol: string, qty: number, side: "BUY" | "SELL") {
  const endpoint = side === "BUY" ? "/orders/place" : "/orders/exit";
  const body = side === "BUY"
    ? { symbol, qty, side: "BUY", orderType: "MARKET", productType: "INTRADAY" }
    : { symbol, qty, side: "BUY" }; // exit a BUY position

  fetch(`${activeBrokerUrl}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
    .then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        const logMsg = `[BROKER] ${side} order SUCCESS for ${symbol} qty=${qty} orderId=${data.orderId || "N/A"}`;
        console.log(`[trade-engine] ${logMsg}`);
        addLogToActive(symbol, logMsg);
      } else {
        const reason = data.message || (data.errors ? data.errors.join(", ") : "unknown");
        const logMsg = `[BROKER] ${side} order FAILED for ${symbol}: ${reason}`;
        console.error(`[trade-engine] ${logMsg}`);
        addLogToActive(symbol, logMsg);
        // Revert trade state on BUY rejection so P/L doesn't tick on a phantom position
        if (side === "BUY") {
          revertRejectedBuy(symbol);
        }
      }
      persistState();
    })
    .catch((err) => {
      // Network errors (broker unreachable) are NOT reverted — keeps backtest mode working
      const logMsg = `[BROKER] ${side} order ERROR for ${symbol}: ${err.message || err}`;
      console.error(`[trade-engine] ${logMsg}`);
      addLogToActive(symbol, logMsg);
      persistState();
    });
}

// Revert a BUY that was rejected by the broker:
// - set inPosition to false so P/L stops ticking
// - restore pnl to whatever it was before this cycle (pnl is unchanged since only SELL mutates it)
// - clean up tracking sets
// - log the rejection
function revertRejectedBuy(symbol: string) {
  activeTrades = activeTrades.map((trade) => {
    if (trade.symbol !== symbol || trade.status !== "ACTIVE" || !trade.inPosition) return trade;
    return {
      ...trade,
      inPosition: false,
      logs: [...trade.logs, `BUY rejected by broker — position reverted, waiting for next signal`],
      trailingTrailActive: false,
      trailingHighWatermark: undefined,
    };
  });
  // Clean up monitoring state for this position
  const positionKey = `${symbol}-${activeTrades.find(t => t.symbol === symbol)?.entryPrice}`;
  armedPositions.delete(positionKey);
  triggeredPositions.delete(positionKey);
  trailingArmedPositions.delete(positionKey);
}

// Get qty from a trade's lot config
function getTradeQty(trade: { lotSize: number; lotValue: number }): number {
  return trade.lotSize * trade.lotValue;
}



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

  minToHoldTrigger: number;

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

  sellWhenLossCandlesEnabled: boolean;

  sellWhenLossCandles: number;

  maxProfitLossEnabled: boolean;

  maxProfit: number;

  maxLoss: number;

  reEntryAfterTargetEnabled: boolean;

  reEntryCandles: number;

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

  minToHoldTrigger: number;

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

  sellWhenLossCandlesEnabled: boolean;

  sellWhenLossCandles: number;

  lastSellCandleTime?: string;

  maxProfitLossEnabled: boolean;

  maxProfit: number;

  maxLoss: number;

  reEntryAfterTargetEnabled: boolean;

  reEntryCandles: number;

  reEntryExitPrice?: number;

  reEntrySellTime?: string;

  reEntryReason?: string;

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

    minToHoldTrigger?: number;

    sellWhenLossCandlesEnabled?: boolean;

    sellWhenLossCandles?: number;

  };

};



// ─── In-memory state ───

let waitingTrades: WaitingTrade[] = [];

let activeTrades: ActiveTrade[] = [];

let tradeHistory: TradeHistoryItem[] = [];

let watchlist: string[] = [];

let lastStrategyCandleTime = "";

let lastHandledSignalKey: Record<string, string> = {};

// ─── Sound event queue (consumed by client via polling) ───
type SoundType = "enter" | "exit" | "profit" | "loss";
let pendingSoundEvents: SoundType[] = [];

function queueSound(type: SoundType) {
  pendingSoundEvents.push(type);
}

export function flushSoundEvents(): SoundType[] {
  const events = pendingSoundEvents;
  pendingSoundEvents = [];
  return events;
}

let engineRunning = false;

let intervalId: ReturnType<typeof setInterval> | null = null;



// SL/Target monitoring tracking (same as dashboard refs)

const armedPositions = new Set<string>();

const triggeredPositions = new Set<string>();

const trailingArmedPositions = new Set<string>();

const lastCandleCloseMap: Record<string, number> = {};

const lastCandleHigh: Record<string, number> = {};

const lastCandleLow: Record<string, number> = {};

// Grace period after BUY: use only real-time LTP (not stale candle low/high) for SL/Target checks
const lastBuyTimestamp: Record<string, number> = {};
const BUY_GRACE_PERIOD_MS = 5000;

// Grace period after minimum-target arming: ignore stale candle data for trigger check
const trailingArmTimestamp: Record<string, number> = {};
const TRAILING_ARM_GRACE_MS = 5000;



// ─── JSON file persistence ───



function loadState() {

  try {

    if (fs.existsSync(DB_PATH)) {

      const raw = fs.readFileSync(DB_PATH, "utf-8");

      const data = JSON.parse(raw);

      if (Array.isArray(data.waitingTrades)) waitingTrades = data.waitingTrades;

      if (Array.isArray(data.activeTrades)) activeTrades = data.activeTrades;

      if (Array.isArray(data.tradeHistory)) tradeHistory = data.tradeHistory;

      if (Array.isArray(data.watchlist)) watchlist = data.watchlist;

      if (typeof data.lastStrategyCandleTime === "string") lastStrategyCandleTime = data.lastStrategyCandleTime;

      if (data.lastHandledSignalKey != null) lastHandledSignalKey = typeof data.lastHandledSignalKey === "string" ? {} : data.lastHandledSignalKey;

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

      watchlist,

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
  if (candleTime) {
    // If candle time already has seconds (HH:MM:SS from live), use as-is
    const full = String(candleTime).match(/(\d{1,2}:\d{2}:\d{2})/);
    if (full) return full[1];
    // If only HH:MM (CSV backtest), return HH:MM
    const hhmm = String(candleTime).match(/(\d{1,2}:\d{2})/);
    if (hhmm) return hhmm[1];
  }
  // Fallback (Force Buy, manual exit, etc.) — use system time
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
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

    minToHoldTrigger: trade.minToHoldEnabled ? trade.minToHoldTrigger : undefined,

    sellWhenLossCandlesEnabled: Boolean(trade.sellWhenLossCandlesEnabled),

    sellWhenLossCandles: trade.sellWhenLossCandlesEnabled ? trade.sellWhenLossCandles : undefined,

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

  queueSound("enter");



  const newActive: ActiveTrade = {

    symbol: trade.symbol,

    entryPrice,

    pnl: 0,

    logs: [
      ...trade.logs,
      logLine,
      ...(trade.reEntryAfterTargetEnabled ? [`ReEntry enabled: will re-enter if price exceeds exit within ${trade.reEntryCandles} candles after profitable exit`] : []),
    ],

    lotSize: trade.lotSize,

    lotValue: trade.lotValue,

    numberOfTrades: trade.numberOfTrades,

    stopLossNumberEnabled: trade.stopLossNumberEnabled,

    stopLossNumber: trade.stopLossNumber,

    targetPointsEnabled: trade.targetPointsEnabled,

    targetPoints: trade.targetPoints,

    minToHoldEnabled: trade.minToHoldEnabled,

    minToHold: trade.minToHold,

    minToHoldTrigger: trade.minToHoldTrigger,

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

    sellWhenLossCandlesEnabled: trade.sellWhenLossCandlesEnabled,

    sellWhenLossCandles: trade.sellWhenLossCandles,

    lastSellCandleTime: undefined,

    maxProfitLossEnabled: trade.maxProfitLossEnabled,

    maxProfit: trade.maxProfit,

    maxLoss: trade.maxLoss,

    reEntryAfterTargetEnabled: trade.reEntryAfterTargetEnabled,

    reEntryCandles: trade.reEntryCandles,

  };



  activeTrades = [...activeTrades, newActive];

  waitingTrades = waitingTrades.filter((t) => t.symbol !== symbol);

  // Reset candle extremes to entry price so stale low/high from the BUY candle
  // cannot trigger a false SL/Target before the next candle arrives.
  const ep = Number(entryPrice);
  if (Number.isFinite(ep)) {
    lastCandleLow[symbol] = ep;
    lastCandleHigh[symbol] = ep;
    lastCandleCloseMap[symbol] = ep;
  }

  // Mark buy timestamp — during grace period, LTP monitoring ignores stale candle low/high
  lastBuyTimestamp[symbol] = Date.now();

  // Send real BUY order to broker
  sendBrokerOrder(symbol, getTradeQty(trade), "BUY");

}



function completeActiveTrade(symbol: string, exitPrice: string, logLine: string) {

  // Send real SELL order to broker if in position
  const tradeToExit = activeTrades.find((t) => t.symbol === symbol && t.status === "ACTIVE" && t.inPosition);
  if (tradeToExit) {
    sendBrokerOrder(symbol, getTradeQty(tradeToExit), "SELL");
  }

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

    queueSound(cyclePnl >= 0 ? "profit" : "loss");

    if (newCompletedCycles >= trade.numberOfTrades) {

      queueSound("exit");

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



    // Check max loss/profit immediately after cycle — don't wait for next tick
    if (trade.maxProfitLossEnabled) {
      if (trade.maxLoss > 0 && totalPnl <= -trade.maxLoss) {
        queueSound("exit");
        const finalLogs = [
          ...trade.logs, logLine,
          `Trade P/L: ${cyclePnl.toFixed(2)}`,
          `Cycle ${newCompletedCycles}/${trade.numberOfTrades} completed`,
          `MAX LOSS ₹${trade.maxLoss} reached (P/L: ₹${totalPnl.toFixed(2)}) - Auto-exiting`,
        ];
        addHistoryEntry(trade.symbol, totalPnl, finalLogs, buildConfigSnapshot(trade));
        return {
          ...trade, pnl: totalPnl, inPosition: false, completedCycles: newCompletedCycles,
          exitPrice, logs: finalLogs, status: "COMPLETED" as const,
          trailingTrailActive: false, trailingHighWatermark: undefined,
        };
      }
      if (trade.maxProfit > 0 && totalPnl >= trade.maxProfit) {
        queueSound("exit");
        const finalLogs = [
          ...trade.logs, logLine,
          `Trade P/L: ${cyclePnl.toFixed(2)}`,
          `Cycle ${newCompletedCycles}/${trade.numberOfTrades} completed`,
          `MAX PROFIT ₹${trade.maxProfit} reached (P/L: ₹${totalPnl.toFixed(2)}) - Auto-exiting`,
        ];
        addHistoryEntry(trade.symbol, totalPnl, finalLogs, buildConfigSnapshot(trade));
        return {
          ...trade, pnl: totalPnl, inPosition: false, completedCycles: newCompletedCycles,
          exitPrice, logs: finalLogs, status: "COMPLETED" as const,
          trailingTrailActive: false, trailingHighWatermark: undefined,
        };
      }
    }

    return {

      ...trade, pnl: totalPnl, inPosition: false, completedCycles: newCompletedCycles,

      logs: [...trade.logs, logLine, `Trade P/L: ${cyclePnl.toFixed(2)}`, `Cycle ${newCompletedCycles}/${trade.numberOfTrades} completed`],

      trailingTrailActive: false, trailingHighWatermark: undefined,

    };

  });

}



function forceExitTrade(symbol: string, exitPrice: string, totalPnl: number, logLine: string) {
  queueSound(totalPnl >= 0 ? "profit" : "loss");
  queueSound("exit");

  // Send real SELL order to broker if in position
  const tradeToExit = activeTrades.find((t) => t.symbol === symbol && t.status === "ACTIVE" && t.inPosition);
  if (tradeToExit) {
    sendBrokerOrder(symbol, getTradeQty(tradeToExit), "SELL");
  }

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

  // Send real SELL order to broker if in position
  const tradeToExit = activeTrades.find((t) => t.symbol === symbol && t.status === "ACTIVE" && t.inPosition);
  if (tradeToExit) {
    sendBrokerOrder(symbol, getTradeQty(tradeToExit), "SELL");
  }

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

    queueSound(cyclePnl >= 0 ? "profit" : "loss");

    const currentTime = logLine.split(" at ").pop() || "";
    const sellLog = `SELL triggered for ₹${exitPrice} at ${currentTime}`;

    if (newCompletedCycles >= trade.numberOfTrades) {

      queueSound("exit");

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



    // Check max loss/profit immediately after cycle — don't wait for next tick
    if (trade.maxProfitLossEnabled) {
      if (trade.maxLoss > 0 && totalPnl <= -trade.maxLoss) {
        queueSound("exit");
        const finalLogs = [
          ...trade.logs, sellLog, logLine,
          `Trade P/L: ${cyclePnl.toFixed(2)}`,
          `Cycle ${newCompletedCycles}/${trade.numberOfTrades} completed`,
          `MAX LOSS ₹${trade.maxLoss} reached (P/L: ₹${totalPnl.toFixed(2)}) - Auto-exiting`,
        ];
        addHistoryEntry(trade.symbol, totalPnl, finalLogs, buildConfigSnapshot(trade));
        return {
          ...trade, pnl: totalPnl, inPosition: false, completedCycles: newCompletedCycles,
          exitPrice, logs: finalLogs, status: "COMPLETED" as const,
          trailingTrailActive: false, trailingHighWatermark: undefined,
        };
      }
      if (trade.maxProfit > 0 && totalPnl >= trade.maxProfit) {
        queueSound("exit");
        const finalLogs = [
          ...trade.logs, sellLog, logLine,
          `Trade P/L: ${cyclePnl.toFixed(2)}`,
          `Cycle ${newCompletedCycles}/${trade.numberOfTrades} completed`,
          `MAX PROFIT ₹${trade.maxProfit} reached (P/L: ₹${totalPnl.toFixed(2)}) - Auto-exiting`,
        ];
        addHistoryEntry(trade.symbol, totalPnl, finalLogs, buildConfigSnapshot(trade));
        return {
          ...trade, pnl: totalPnl, inPosition: false, completedCycles: newCompletedCycles,
          exitPrice, logs: finalLogs, status: "COMPLETED" as const,
          trailingTrailActive: false, trailingHighWatermark: undefined,
        };
      }
    }

    // Determine if this was a profitable exit (target/trailing/min target)
    const isProfitableExit = cyclePnl >= 0 && !logLine.includes("STOPLOSS") && !logLine.includes("in loss");
    const reEntryInfo = (trade.reEntryAfterTargetEnabled && isProfitableExit) ? {
      reEntryExitPrice: Number(exitPrice),
      reEntrySellTime: lastStrategyCandleTime || trade.lastSellCandleTime,
      reEntryReason: logLine,
    } : {
      reEntryExitPrice: undefined,
      reEntrySellTime: undefined,
      reEntryReason: undefined,
    };

    let reEntryMsg = `Cycle ${newCompletedCycles}/${trade.numberOfTrades} completed (SL/Target hit - waiting for next signal)`;
    if (trade.reEntryAfterTargetEnabled && isProfitableExit) {
      reEntryMsg = `ReEntry armed: watching for price > ₹${exitPrice} within ${trade.reEntryCandles} candles`;
    } else if (trade.reEntryAfterTargetEnabled && !isProfitableExit) {
      reEntryMsg += ` [ReEntry skipped: not a profitable exit]`;
    }

    return {

      ...trade, pnl: totalPnl, inPosition: false, completedCycles: newCompletedCycles,

      logs: [...trade.logs, sellLog, logLine, `Trade P/L: ${cyclePnl.toFixed(2)}`, reEntryMsg],

      trailingTrailActive: false, trailingHighWatermark: undefined,

      lastSellCandleTime: lastStrategyCandleTime || trade.lastSellCandleTime,

      ...reEntryInfo,

    };

  });

}



function updateActiveTradeBuy(symbol: string, entryPrice: string, logLine: string) {

  const matchedTrade = activeTrades.find((t) => t.symbol === symbol && t.status === "ACTIVE");

  activeTrades = activeTrades.map((trade) => {

    if (trade.symbol !== symbol || trade.status !== "ACTIVE") return trade;

    return {

      ...trade, entryPrice, inPosition: true,

      entryTime: logLine.includes("at ") ? logLine.split("at ")[1] : undefined,

      logs: [...trade.logs, logLine],

      trailingTrailActive: false, trailingHighWatermark: undefined,

      reEntryExitPrice: undefined, reEntrySellTime: undefined, reEntryReason: undefined,

    };

  });

  // Reset candle extremes to entry price so stale low/high from the BUY candle
  // cannot trigger a false SL/Target before the next candle arrives.
  const ep = Number(entryPrice);
  if (Number.isFinite(ep)) {
    lastCandleLow[symbol] = ep;
    lastCandleHigh[symbol] = ep;
    lastCandleCloseMap[symbol] = ep;
  }

  // Mark buy timestamp — during grace period, LTP monitoring ignores stale candle low/high
  lastBuyTimestamp[symbol] = Date.now();

  // Send real BUY order to broker (re-entry)
  if (matchedTrade) {
    sendBrokerOrder(symbol, getTradeQty(matchedTrade), "BUY");
  }

}



function clearReEntryState(symbol: string) {
  activeTrades = activeTrades.map((t) =>
    t.symbol === symbol && t.status === "ACTIVE"
      ? { ...t, reEntryExitPrice: undefined, reEntrySellTime: undefined, reEntryReason: undefined }
      : t
  );
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

  const lastCandle = signal.candles?.[signal.candles.length - 1];

  if (signalSymbol) {
    if (Number.isFinite(Number(latestClose))) lastCandleCloseMap[signalSymbol] = Number(latestClose);
    const h = Number(signal.high ?? lastCandle?.high);
    const l = Number(signal.low ?? lastCandle?.low);
    if (Number.isFinite(h)) lastCandleHigh[signalSymbol] = h;
    if (Number.isFinite(l)) lastCandleLow[signalSymbol] = l;
  }

  const activeForSymbol = activeTrades.find((t) => t.symbol === signalSymbol && t.status === "ACTIVE");

  const hasWaitingTrade = waitingTrades.some((t) => t.symbol === signalSymbol);

  const waitingForBuy = (!activeForSymbol || !activeForSymbol.inPosition) && (hasWaitingTrade || Boolean(activeForSymbol));

  const waitingForSell = Boolean(activeForSymbol && activeForSymbol.inPosition);



  const candleTime = signal.lastCandleTime || signal.candles?.[signal.candles.length - 1]?.time;

  if (candleTime) {

    lastStrategyCandleTime = candleTime;

  }



  // Auto-sell cutoff at 3:05 PM

  const AUTO_SELL_CUTOFF_MINUTES = 15 * 60  + 15;

  const candleMinutes = toMinutes(signal.lastCandleTime);



  if (candleMinutes >= AUTO_SELL_CUTOFF_MINUTES && activeForSymbol && activeForSymbol.inPosition) {

    completeActiveTrade(

      activeForSymbol.symbol,

      String(latestClose ?? ""),

      `AUTO SELL triggered post 02:55 pm cut-off at ₹${String(latestClose ?? "")} (${fmtTime(signal.lastCandleTime)})`

    );

    updateLastSellCandleTime(activeForSymbol.symbol, signal.lastCandleTime ?? "15:15");

    return;

  }



  // STOPLOSS signal

  if (signal.signal === "STOPLOSS") {

    const signalKey = signal.signal + "-" + signal.lastCandleTime;

    if (signalKey === lastHandledSignalKey[signalSymbol]) return;

    if (!activeForSymbol || !activeForSymbol.inPosition) return;

    completeCycleWithoutExit(activeForSymbol.symbol, String(latestClose ?? ""), "STOPLOSS hit for ₹" + String(latestClose ?? "") + " at " + fmtTime(signal.lastCandleTime));

    lastHandledSignalKey[signalSymbol] = signalKey;

    return;

  }



  // TARGET signal

  if (signal.signal === "TARGET") {

    const signalKey = signal.signal + "-" + signal.lastCandleTime;

    if (signalKey === lastHandledSignalKey[signalSymbol]) return;

    if (!activeForSymbol || !activeForSymbol.inPosition) return;

    if (activeForSymbol.trailingAfterTargetEnabled && activeForSymbol.trailingAfterTarget > 0) {

      lastHandledSignalKey[signalSymbol] = signalKey;

      return;

    }

    completeCycleWithoutExit(activeForSymbol.symbol, String(latestClose ?? ""), "TARGET hit for ₹" + String(latestClose ?? "") + " at " + fmtTime(signal.lastCandleTime));

    lastHandledSignalKey[signalSymbol] = signalKey;

    return;

  }



  // SELL signal

  if (signal.signal === "SELL") {

    const signalKey = signal.signal + "-" + signal.lastCandleTime;

    if (signalKey === lastHandledSignalKey[signalSymbol]) return;

    if (waitingForBuy) return;

    if (!activeForSymbol || !activeForSymbol.inPosition) return;

    completeActiveTrade(activeForSymbol.symbol, String(latestClose ?? ""), "SELL triggered for ₹" + String(latestClose ?? "") + " at " + fmtTime(signal.lastCandleTime));

    updateLastSellCandleTime(activeForSymbol.symbol, signal.lastCandleTime);

    lastHandledSignalKey[signalSymbol] = signalKey;

    return;

  }



  // WAIT signal

  if (signal.signal === "WAIT") {

    const signalKey = signal.signal + "-" + signal.lastCandleTime;

    if (signalKey === lastHandledSignalKey[signalSymbol]) return;

    lastHandledSignalKey[signalSymbol] = signalKey;

    return;

  }



  // BUY signal

  if (signal.signal === "BUY") {

    const signalKey = signal.signal + "-" + signal.lastCandleTime;

    if (signalKey === lastHandledSignalKey[signalSymbol]) return;

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

        lastHandledSignalKey[signalSymbol] = signalKey;

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

          lastHandledSignalKey[signalSymbol] = signalKey;

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

      lastHandledSignalKey[signalSymbol] = signalKey;

      return;

    }



    if (matchingTrade) {

      activateWaitingTrade(matchingTrade.symbol, String(latestClose ?? ""), "BUY triggered for ₹ " + String(latestClose ?? "") + " at " + fmtTime(signal.lastCandleTime));

    } else if (activeForSymbol && !activeForSymbol.inPosition) {

      updateActiveTradeBuy(activeForSymbol.symbol, String(latestClose ?? ""), "BUY triggered for ₹ " + String(latestClose ?? "") + " at " + fmtTime(signal.lastCandleTime));

    }



    lastHandledSignalKey[signalSymbol] = signalKey;

  }

}



// ─── LTP-based SL/Target/Trailing monitoring (from dashboard/page.tsx) ───



function handleLtpMonitoring(ltpMap: Record<string, number>, marketTime?: string) {

  for (const trade of activeTrades) {

    if (trade.status !== "ACTIVE") continue;

    const ltp = ltpMap[trade.symbol];
    if (!Number.isFinite(ltp)) continue;

    // Use only real-time LTP for all SL/Target/Trailing checks.
    // Candle high/low from strategy signals are stale (previous completed candle)
    // and would cause phantom exits on wicks that LTP polling already handles.

    const currentTime = marketTime || fmtTime();

    // ── Max Profit / Max Loss check (runs even when NOT in position) ──
    // This is the overall trade-level guard — takes priority over per-cycle SL/target.
    if (trade.maxProfitLossEnabled) {
      const qty = trade.lotSize * trade.lotValue;
      const entry = Number(trade.entryPrice);
      const bestPnl = (trade.inPosition && Number.isFinite(entry)) ? (ltp - entry) * qty : 0;
      const worstPnl = (trade.inPosition && Number.isFinite(entry)) ? (ltp - entry) * qty : 0;

      const ltpPnl = (trade.inPosition && Number.isFinite(entry)) ? (ltp - entry) * qty : 0;

      if (trade.maxProfit > 0 && (trade.pnl + bestPnl) >= trade.maxProfit) {
        const exitPrice = (trade.pnl + ltpPnl) >= trade.maxProfit ? ltp : entry + (trade.maxProfit - trade.pnl) / qty;
        forceExitTrade(trade.symbol, String(exitPrice), trade.pnl + bestPnl, `MAX PROFIT ₹${trade.maxProfit} reached (P/L: ₹${(trade.pnl + bestPnl).toFixed(2)}) at ${currentTime}`);
        continue;
      }

      if (trade.maxLoss > 0 && (trade.pnl + worstPnl) <= -trade.maxLoss) {
        const exitPrice = (trade.pnl + ltpPnl) <= -trade.maxLoss ? ltp : entry + (-trade.maxLoss - trade.pnl) / qty;
        forceExitTrade(trade.symbol, String(exitPrice), trade.pnl + worstPnl, `MAX LOSS ₹${trade.maxLoss} reached (P/L: ₹${(trade.pnl + worstPnl).toFixed(2)}) at ${currentTime}`);
        continue;
      }
    }

    if (!trade.inPosition) {

      const positionKey = `${trade.symbol}-${trade.entryPrice}`;

      triggeredPositions.delete(positionKey);

      armedPositions.delete(positionKey);

      trailingArmedPositions.delete(positionKey);

      // ReEntry After Target logic
      if (
        trade.reEntryAfterTargetEnabled &&
        trade.reEntryExitPrice &&
        trade.reEntrySellTime &&
        Number.isFinite(ltp)
      ) {
        const sellMin = toMinutes(trade.reEntrySellTime);
        const currentMin = toMinutes(lastStrategyCandleTime);
        if (sellMin >= 0 && currentMin >= 0) {
          const candlesSinceSell = currentMin - sellMin;
          if (candlesSinceSell >= 1 && candlesSinceSell <= trade.reEntryCandles) {
            // Price has trended back up above exit price → re-enter (skip same candle)
            if (ltp > trade.reEntryExitPrice) {
              const reEntryLog = `RE-ENTRY triggered at ₹${ltp.toFixed(2)} (price exceeded exit ₹${trade.reEntryExitPrice.toFixed(2)} within ${candlesSinceSell}/${trade.reEntryCandles} candles) at ${currentTime}`;
              updateActiveTradeBuy(trade.symbol, String(ltp), reEntryLog);
              continue;
            }
          } else if (candlesSinceSell > trade.reEntryCandles) {
            // Window expired — clear re-entry state
            addLogToActive(trade.symbol, `ReEntry window expired (${trade.reEntryCandles} candles passed since exit)`);
            clearReEntryState(trade.symbol);
          }
        }
      }

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

      const activationLevel = trailLevel + (trade.minToHoldTrigger || 2);

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

      const peakPrice = ltp;

      if (typeof trade.trailingHighWatermark !== "number" || peakPrice > trade.trailingHighWatermark) {

        updateHighWatermark(trade.symbol, peakPrice);

      }

      const highMark = trade.trailingHighWatermark ?? peakPrice;

      const currentPrice = ltp;

      const drop = highMark - currentPrice;

      if (drop >= trade.trailingAfterTarget) {

        triggeredPositions.add(positionKey);

        completeCycleWithoutExit(trade.symbol, String(ltp), `Trailing target hit for ₹${ltp} at ${currentTime}`);

        continue;

      }

    }



    // Target hit

    if (trade.targetPointsEnabled && trade.targetPoints > 0 && (ltp - entry) >= trade.targetPoints) {

      const targetLevel = entry + trade.targetPoints;
      const tgtExit = priceDiff >= trade.targetPoints ? ltp : targetLevel;

      if (trailingEnabled) {

        if (!trade.trailingTrailActive) {

          activateTrailing(trade.symbol, tgtExit, currentTime);

        }

        continue;

      }

      triggeredPositions.add(positionKey);

      completeCycleWithoutExit(trade.symbol, String(tgtExit), `TARGET hit for ₹${tgtExit} at ${currentTime}`);

      continue;

    }



    // Stop loss hit

    if (trade.stopLossNumberEnabled && trade.stopLossNumber > 0 && (ltp - entry) <= -trade.stopLossNumber) {

      const slLevel = entry - trade.stopLossNumber;
      const slExit = priceDiff <= -trade.stopLossNumber ? ltp : slLevel;

      triggeredPositions.add(positionKey);

      completeCycleWithoutExit(trade.symbol, String(slExit), `STOPLOSS hit for ₹${slExit} at ${currentTime}`);

      continue;

    }

    // Sell when in loss for X candles
    if (trade.sellWhenLossCandlesEnabled && trade.sellWhenLossCandles > 0 && ltp < entry) {
      const entryMin = toMinutes(trade.entryTime);
      const currentMin = toMinutes(lastStrategyCandleTime);
      if (entryMin >= 0 && currentMin >= 0) {
        const candlesSinceEntry = currentMin - entryMin;
        if (candlesSinceEntry >= trade.sellWhenLossCandles) {
          triggeredPositions.add(positionKey);
          completeCycleWithoutExit(trade.symbol, String(ltp), `SELL (in loss for ${candlesSinceEntry} candles) at ₹${ltp} at ${currentTime}`);
          continue;
        }
      }
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



    // 2. Fetch LTP prices from port 2000 for active trades in position (+ re-entry monitoring)

    const inPositionTrades = activeTrades.filter((t) => t.status === "ACTIVE" && (t.inPosition || (t.reEntryAfterTargetEnabled && t.reEntryExitPrice)));

    if (inPositionTrades.length > 0) {

      const symbols = inPositionTrades.map((t) => t.symbol);

      try {

        const list = symbols.join(",");

        const [priceRes, timeRes] = await Promise.all([
          fetch(`${API_URL}/prices?symbols=${list}`),
          fetch(`${API_URL}/market-time`).catch(() => null),
        ]);

        const prices = await priceRes.json();

        let marketTime = "";
        if (timeRes && timeRes.ok) {
          const timeData = await timeRes.json();
          if (timeData?.marketTime) {
            const timePart = String(timeData.marketTime).match(/(\d{1,2}:\d{2}:\d{2})/);
            if (timePart) marketTime = timePart[1];
          }
        }

        const ltpMap: Record<string, number> = {};

        if (Array.isArray(prices)) {

          for (const p of prices) {

            if (p?.symbol) {

              const v = Number(p.ltp);

              if (Number.isFinite(v)) { ltpMap[p.symbol] = v; }

            }

          }

        }

        handleLtpMonitoring(ltpMap, marketTime);

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

  tryAddActiveStrategySymbol(trade.symbol);

  ensureEngineRunning();

}

export function updateWaitingTrade(trade: WaitingTrade) {
  const idx = waitingTrades.findIndex((t) => t.symbol === trade.symbol);
  if (idx === -1) return false;
  // Preserve existing logs, replace everything else
  const existingLogs = waitingTrades[idx].logs;
  waitingTrades = waitingTrades.map((t, i) =>
    i === idx ? { ...trade, logs: existingLogs } : t
  );
  persistState();
  return true;
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

  tryRemoveActiveStrategySymbol(symbol);

}



export function manualExit(symbol: string, exitPrice: string, lastCandleTime: string) {

  // Send real SELL order to broker if in position
  const tradeToExit = activeTrades.find((t) => t.symbol === symbol && t.status === "ACTIVE" && t.inPosition);
  if (tradeToExit) {
    sendBrokerOrder(symbol, getTradeQty(tradeToExit), "SELL");
  }

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

  tryRemoveActiveStrategySymbol(symbol);

}



export function removeCompletedTrade(symbol: string) {

  activeTrades = activeTrades.filter((t) => t.symbol !== symbol);

  persistState();

  tryRemoveActiveStrategySymbol(symbol);

}



export function clearHistory() {

  tradeHistory = [];

  persistState();

}



export function removeHistoryEntry(id: string) {

  tradeHistory = tradeHistory.filter((t) => t.id !== id);

  persistState();

}



// ─── Watchlist (server-persisted) ───

export function getWatchlist(): string[] {
  return watchlist;
}

export function addWatchlistSymbol(symbol: string) {
  if (watchlist.includes(symbol)) return;
  watchlist = [...watchlist, symbol];
  persistState();
}

export function removeWatchlistSymbol(symbol: string) {
  watchlist = watchlist.filter((s) => s !== symbol);
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

// On startup, detect which broker is logged in and sync strategy symbols
detectActiveBroker();
syncActiveStrategySymbols();

