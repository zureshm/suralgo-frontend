// Server-side trade engine singleton

// Runs setInterval on the Node.js server so browser tab throttling cannot affect it.

// Replicates ALL logic from StrategyTimerProvider + dashboard SL/Target monitoring.

// Persists state to data/trades.json so it survives server restarts.



import fs from "fs";
import path from "path";

import { getAiGuardSettings, isAiGuardActive, analyzeMarketRegime, loadAiSettingsFromDisk, addAiLog, addAiErrorLog, type AiSuggestion, type AiAnalysisResult } from "./ai-guard";

import { getNiftyLive } from "./nifty-live";

const API_URL = process.env.NEXT_PUBLIC_API_BASE_URL!;
const STRATEGY_URL = process.env.NEXT_PUBLIC_STRATEGY_API_URL!;
const ANGELONE_EXECUTION_URL = process.env.NEXT_PUBLIC_TRADE_EXECUTION_URL || "http://localhost:5000";
const FLATTRADE_EXECUTION_URL = process.env.NEXT_PUBLIC_FLATTRADE_EXECUTION_URL || "http://localhost:5001";

// Active broker execution URL â€” updated when user connects/disconnects a broker
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
  console.log(`[trade-engine] No broker logged in â€” defaulting to Angel One URL`);
}



const DB_PATH = path.join(process.cwd(), "data", "trades.json");

// Add a symbol to angel-feed active strategy symbols (fire-and-forget)
function tryAddActiveStrategySymbol(symbol: string) {
  console.log(`[trade-engine] Notifying feed server to start monitoring ${symbol}...`);
  fetch(`${API_URL}/active-strategy-symbols`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol }),
  })
    .then(() => console.log(`[trade-engine] Notified feed server for ${symbol}`))
    .catch((e) => console.error(`[trade-engine] Failed to notify feed server for ${symbol}:`, e));
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

// Infer exchange from symbol name: SENSEX options â†’ BFO, everything else â†’ NFO
function getExchangeForSymbol(symbol: string): string {
  return symbol && symbol.startsWith("SENSEX") ? "BFO" : "NFO";
}

// Send real broker order to trade-execution backend (fire-and-forget)
function sendBrokerOrder(symbol: string, qty: number, side: "BUY" | "SELL") {
  const exchange = getExchangeForSymbol(symbol);
  const endpoint = side === "BUY" ? "/orders/place" : "/orders/exit";
  const body = side === "BUY"
    ? { symbol, qty, side: "BUY", orderType: "MARKET", productType: "INTRADAY", exchange }
    : { symbol, qty, side: "BUY", exchange }; // exit a BUY position

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
      // Network errors (broker unreachable) are NOT reverted â€” keeps backtest mode working
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
      logs: [...trade.logs, `BUY rejected by broker â€” position reverted, waiting for next signal`],
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

  targetMode: "live" | "candleClose";

  minToHoldEnabled: boolean;

  minToHold: number;

  minToHoldTrigger: number;

  minToHoldTrailing: boolean;

  trailingAfterTargetEnabled: boolean;

  trailingAfterTarget: number;

  trailingMode: "live" | "candleClose";

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
  reEntryPoints: number;

  reEntryStopLossEnabled: boolean;
  reEntryStopLoss: number;
  reEntryAsTrailingEnabled: boolean;
  reEntryTrailingPoints: number;

  reEntryMinTargetEnabled: boolean;
  reEntryMinTargetPoints: number;
  reEntryMinTargetTrigger: number;
  reEntryMinTargetTrailing: boolean;

  pendingSkippedBuy?: boolean;

  signalReEntryEnabled: boolean;
  triggerTimerEnabled?: boolean;
  triggerTimeEnabled?: boolean;
  triggerPriceEnabled?: boolean;
  triggerHours?: number;
  triggerMinutes?: number;
  triggerSeconds?: number;
  triggerMinPrice?: number;
  triggerMaxPrice?: number;
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

  targetMode: "live" | "candleClose";

  minToHoldEnabled: boolean;

  minToHold: number;

  minToHoldTrigger: number;

  minToHoldTrailing: boolean;

  trailingAfterTargetEnabled: boolean;

  trailingAfterTarget: number;

  trailingMode: "live" | "candleClose";

  trailingTrailActive: boolean;

  trailingHighWatermark?: number;

  minTargetHighWatermark?: number;

  minTargetLockedPrice?: number;

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
  reEntryPoints: number;

  reEntryStopLossEnabled: boolean;
  reEntryStopLoss: number;
  reEntryAsTrailingEnabled: boolean;
  reEntryTrailingPoints: number;

  reEntryMinTargetEnabled: boolean;
  reEntryMinTargetPoints: number;
  reEntryMinTargetTrigger: number;
  reEntryMinTargetTrailing: boolean;
  isReEntryCycle?: boolean;

  reEntryExitPrice?: number;

  reEntrySellTime?: string;

  reEntryReason?: string;

  pendingSkippedBuy?: boolean;

  signalReEntryEnabled: boolean;

  signalReEntryArmed?: boolean;
  triggerTimerEnabled?: boolean;
  triggerTimeEnabled?: boolean;
  triggerPriceEnabled?: boolean;
  triggerHours?: number;
  triggerMinutes?: number;
  triggerSeconds?: number;
  triggerMinPrice?: number;
  triggerMaxPrice?: number;
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



// â”€â”€â”€ In-memory state â”€â”€â”€

let waitingTrades: WaitingTrade[] = [];

let activeTrades: ActiveTrade[] = [];

let tradeHistory: TradeHistoryItem[] = [];

let watchlist: string[] = [];

let lastStrategyCandleTime = "";

let lastHandledSignalKey: Record<string, string> = {};

// Trigger Timer state — tracks which symbols have already fired today to prevent re-firing
const triggerTimerFired: Set<string> = new Set();

// â”€â”€â”€ Sound event queue (consumed by client via polling) â”€â”€â”€
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

// --- Total Exit State ---
let totalTargetEnabled = false;
let totalTargetValue = 1200;
let totalLossEnabled = false;
let totalLossValue = -1200;

export function getTotalExitSettings() {
  return { totalTargetEnabled, totalTargetValue, totalLossEnabled, totalLossValue };
}

export function setTotalExitSettings(settings: { totalTargetEnabled?: boolean; totalTargetValue?: number; totalLossEnabled?: boolean; totalLossValue?: number }) {
  if (settings.totalTargetEnabled !== undefined) totalTargetEnabled = settings.totalTargetEnabled;
  if (settings.totalTargetValue !== undefined) totalTargetValue = settings.totalTargetValue;
  if (settings.totalLossEnabled !== undefined) totalLossEnabled = settings.totalLossEnabled;
  if (settings.totalLossValue !== undefined) totalLossValue = -Math.abs(settings.totalLossValue);
  persistState();
}

function executeTotalExit(reason: string, ltpMap: Record<string, number> = {}) {
  console.log(`[trade-engine] ${reason}`);
  
  for (const trade of activeTrades) {
    if (trade.status === "ACTIVE") {
      const currentLtp = ltpMap[trade.symbol] || lastCandleCloseMap[trade.symbol] || Number(trade.entryPrice);
      let exitPnl = trade.pnl;
      if (trade.inPosition && Number.isFinite(Number(trade.entryPrice))) {
        const qty = trade.lotSize * trade.lotValue;
        exitPnl = trade.pnl + (currentLtp - Number(trade.entryPrice)) * qty;
      }
      forceExitTrade(trade.symbol, String(currentLtp), exitPnl, reason);
    }
  }

  waitingTrades = [];
  persistState();
}

let engineRunning = false;

// Tracks which waiting symbols have received at least one valid signal from the strategy server.
// Used by the frontend to show a loader until the strategy engine is actually processing the symbol.
// Not persisted â€” resets on server restart (correct: symbol needs to re-init after restart).
const symbolsWithFirstSignal = new Set<string>();

// Tracks per-symbol history fetch status from the feed server (angel-feed).
// 'loading' = history fetch in progress, 'ready' = history loaded, 'failed' = 0 candles
const symbolHistoryStatus: Record<string, { status: string; candleCount: number }> = {};

// Ring buffer of history-fetch log lines for the Log Monitor page
const historyFetchLogs: string[] = [];
const MAX_HISTORY_LOGS = 200;
function pushHistoryLog(msg: string) {
  const ts = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  historyFetchLogs.push(`[${ts}] ${msg}`);
  if (historyFetchLogs.length > MAX_HISTORY_LOGS) historyFetchLogs.shift();
}

// Check history status from angel-feed server for a symbol.

// Phase 1: poll every 5s for up to 60s. If not ready, mark "failed".

// Phase 2: keep re-checking every 30s for up to 10 min â€” angel-feed may

// eventually succeed (e.g. morning history fetch delays). If found ready,

// upgrade status and mark initialized so the frontend error banner clears.

async function checkSymbolHistoryStatus(symbol: string) {

  console.log(`[trade-engine] Starting history status poll for ${symbol}`);
  pushHistoryLog(`Starting history status poll for ${symbol}`);

  const maxAttempts = 12; // Phase 1: ~60s total (every 5s)

  for (let i = 0; i < maxAttempts; i++) {

    try {

      console.log(`[trade-engine] Checking history status for ${symbol} (attempt ${i + 1}/${maxAttempts})...`);
      pushHistoryLog(`Checking history status for ${symbol} (attempt ${i + 1}/${maxAttempts}) — GET ${API_URL}/symbol-history-status/${encodeURIComponent(symbol)}`);

      const res = await fetch(`${API_URL}/symbol-history-status/${encodeURIComponent(symbol)}`);

      const data = await res.json();

      if (data.status === "ready") {

        console.log(`[trade-engine] Symbol ${symbol} history is READY (${data.candleCount || 0} candles)`);
        pushHistoryLog(`Symbol ${symbol} history is READY (${data.candleCount || 0} candles)`);

        symbolHistoryStatus[symbol] = { status: "ready", candleCount: data.candleCount || 0 };

        symbolsWithFirstSignal.add(symbol);

        return;

      }

      if (data.status === "failed") {

        console.error(`[trade-engine] Symbol ${symbol} history fetch FAILED at feed server`);
        pushHistoryLog(`Symbol ${symbol} history fetch FAILED at feed server`);

        break;

      }

    } catch (e) {

      console.warn(`[trade-engine] Feed server unreachable for ${symbol} check, retrying...`);
      pushHistoryLog(`Feed server unreachable for ${symbol} check — ${e instanceof Error ? e.message : String(e)}`);

    }

    await new Promise((r) => setTimeout(r, 5000));

  }

  // Phase 1 ended without "ready" — mark as failed

  if (symbolHistoryStatus[symbol]?.status !== "ready") {

    console.log(`[trade-engine] Phase 1 poll ended for ${symbol} without readiness. Switching to Phase 2 (30s background poll).`);
    pushHistoryLog(`Phase 1 poll ended for ${symbol} without readiness. Switching to Phase 2 (30s background poll).`);

    symbolHistoryStatus[symbol] = { status: "failed", candleCount: 0 };

  }

  // Phase 2: background re-checks every 30s for up to 10 min

  const maxBgAttempts = 20;

  for (let i = 0; i < maxBgAttempts; i++) {

    if (!waitingTrades.some((t) => t.symbol === symbol)) return;

    if (symbolHistoryStatus[symbol]?.status === "ready") return;

    await new Promise((r) => setTimeout(r, 30000));

    if (!waitingTrades.some((t) => t.symbol === symbol)) return;

    try {

      console.log(`[trade-engine] Background history status poll for ${symbol} (attempt ${i + 1}/${maxBgAttempts})...`);
      pushHistoryLog(`Background history status poll for ${symbol} (attempt ${i + 1}/${maxBgAttempts})`);

      const res = await fetch(`${API_URL}/symbol-history-status/${encodeURIComponent(symbol)}`);

      const data = await res.json();

      if (data.status === "ready") {

        console.log(`[trade-engine] Symbol ${symbol} history finally READY (${data.candleCount || 0} candles)`);
        pushHistoryLog(`Symbol ${symbol} history finally READY (${data.candleCount || 0} candles)`);

        symbolHistoryStatus[symbol] = { status: "ready", candleCount: data.candleCount || 0 };

        symbolsWithFirstSignal.add(symbol);

        return;

      }

    } catch (e) {
      pushHistoryLog(`Background poll: Feed server unreachable for ${symbol} — ${e instanceof Error ? e.message : String(e)}`);

    }

  }

}

let intervalId: ReturnType<typeof setInterval> | null = null;



// SL/Target monitoring tracking (same as dashboard refs)

const armedPositions = new Set<string>();

const triggeredPositions = new Set<string>();

const trailingArmedPositions = new Set<string>();

// Throttle RE-ENTRY blocked logs to once per candle (not every 1s tick)
const lastReEntryBlockedCandle: Record<string, string> = {};

const lastCandleCloseMap: Record<string, number> = {};

const lastCandleHigh: Record<string, number> = {};

const lastCandleLow: Record<string, number> = {};

const lastUpwards: Record<string, boolean> = {};

// Grace period after BUY: use only real-time LTP (not stale candle low/high) for SL/Target checks
const lastBuyTimestamp: Record<string, number> = {};
const BUY_GRACE_PERIOD_MS = 5000;

// Track the candle time at which the last BUY happened — prevents strategy exit signals
// (SELL/STOPLOSS/TARGET/REEXIT) from firing on the same candle as entry
const lastBuyCandleTime: Record<string, string> = {};

// Grace period after minimum-target arming: ignore stale candle data for trigger check
const trailingArmTimestamp: Record<string, number> = {};
const TRAILING_ARM_GRACE_MS = 5000;



// â”€â”€â”€ JSON file persistence â”€â”€â”€



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

      if (typeof data.totalTargetEnabled === "boolean") totalTargetEnabled = data.totalTargetEnabled;
      if (typeof data.totalTargetValue === "number") totalTargetValue = data.totalTargetValue;
      if (typeof data.totalLossEnabled === "boolean") totalLossEnabled = data.totalLossEnabled;
      if (typeof data.totalLossValue === "number") totalLossValue = data.totalLossValue;

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

      totalTargetEnabled,
      totalTargetValue,
      totalLossEnabled,
      totalLossValue,

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



// â”€â”€â”€ State Cleanup â”€â”€â”€

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

// AI Guard state
const aiSuggestions: AiSuggestion[] = [];
const lastAiCandleTime: Record<string, string> = {};
const lastAiResult: Record<string, AiAnalysisResult> = {};
const pendingSidewaysExits: Record<string, { retryCount: number; lastRetryTime: number }> = {};
export function clearAiResults() {
  for (const k of Object.keys(lastAiResult)) delete lastAiResult[k];
  for (const k of Object.keys(pendingSidewaysExits)) delete pendingSidewaysExits[k];
  aiSuggestions.length = 0;
}

// Per-symbol AI Guard toggle â€” AI only analyzes symbols explicitly enabled (default OFF)
const aiSymbolEnabled: Record<string, boolean> = {};

export function setAiSymbolEnabled(symbol: string, enabled: boolean) {
  if (enabled) {
    aiSymbolEnabled[symbol] = true;
  } else {
    delete aiSymbolEnabled[symbol];
    // Clear all AI state for this symbol
    delete lastAiResult[symbol];
    delete lastAiCandleTime[symbol];
    delete pendingBuyBuffer[symbol];
    for (let i = aiSuggestions.length - 1; i >= 0; i--) {
      if (aiSuggestions[i].symbol === symbol) aiSuggestions.splice(i, 1);
    }
  }
}

// AI Guard BUY buffer â€” holds BUY/REENTER signals waiting for AI trending confirmation
// Keyed by symbol. Each entry: { signalType, bufferedCandleTime, candlesElapsed, originalSignal }
interface PendingBuyBuffer {
  signalType: "BUY" | "REENTER";
  bufferedCandleTime: string;
  candlesElapsed: number;
  originalSignal: unknown;
}
const pendingBuyBuffer: Record<string, PendingBuyBuffer> = {};
const AI_BUFFER_MAX_CANDLES = 1;

// â”€â”€â”€ Helpers â”€â”€â”€



function fmtTime(candleTime?: string): string {
  if (candleTime) {
    // If candle time already has seconds (HH:MM:SS from live), use as-is
    const full = String(candleTime).match(/(\d{1,2}:\d{2}:\d{2})/);
    if (full) return full[1];
    // If only HH:MM (CSV backtest), return HH:MM
    const hhmm = String(candleTime).match(/(\d{1,2}:\d{2})/);
    if (hhmm) return hhmm[1];
  }
  // Fallback (Force Buy, manual exit, etc.) â€” use system time
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



// â”€â”€â”€ Trade lifecycle (mirrors TradeStore functions) â”€â”€â”€



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
      ...(trade.reEntryAfterTargetEnabled ? [`Auto Re-entry enabled: will re-enter if price exceeds exit within ${trade.reEntryCandles} candles after profitable exit`] : []),
      ...(trade.signalReEntryEnabled ? [`Signal Re-entry enabled: will re-enter on REENTER signal after any exit`] : []),
    ],

    lotSize: trade.lotSize,

    lotValue: trade.lotValue,

    numberOfTrades: trade.numberOfTrades,

    stopLossNumberEnabled: trade.stopLossNumberEnabled,

    stopLossNumber: trade.stopLossNumber,

    targetPointsEnabled: trade.targetPointsEnabled,

    targetPoints: trade.targetPoints,

    targetMode: trade.targetMode,

    minToHoldEnabled: trade.minToHoldEnabled,

    minToHold: trade.minToHold,

    minToHoldTrigger: trade.minToHoldTrigger,

    minToHoldTrailing: trade.minToHoldTrailing,

    trailingAfterTargetEnabled: trade.trailingAfterTargetEnabled,

    trailingAfterTarget: trade.trailingAfterTarget,

    trailingMode: trade.trailingMode,

    trailingTrailActive: false,

    trailingHighWatermark: undefined,

    minTargetHighWatermark: undefined,

    minTargetLockedPrice: undefined,

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
    reEntryPoints: trade.reEntryPoints,

    reEntryStopLossEnabled: trade.reEntryStopLossEnabled,
    reEntryStopLoss: trade.reEntryStopLoss,
    reEntryAsTrailingEnabled: trade.reEntryAsTrailingEnabled,
    reEntryTrailingPoints: trade.reEntryTrailingPoints,

    reEntryMinTargetEnabled: trade.reEntryMinTargetEnabled,
    reEntryMinTargetPoints: trade.reEntryMinTargetPoints,
    reEntryMinTargetTrigger: trade.reEntryMinTargetTrigger,
    reEntryMinTargetTrailing: trade.reEntryMinTargetTrailing,
    isReEntryCycle: false,

    pendingSkippedBuy: false,

    signalReEntryEnabled: trade.signalReEntryEnabled,

    signalReEntryArmed: false,
    triggerTimerEnabled: trade.triggerTimerEnabled,
    triggerTimeEnabled: trade.triggerTimeEnabled,
    triggerPriceEnabled: trade.triggerPriceEnabled,
    triggerHours: trade.triggerHours,
    triggerMinutes: trade.triggerMinutes,
    triggerSeconds: trade.triggerSeconds,
    triggerMinPrice: trade.triggerMinPrice,
    triggerMaxPrice: trade.triggerMaxPrice,
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

  // Mark buy timestamp â€” during grace period, LTP monitoring ignores stale candle low/high
  lastBuyTimestamp[symbol] = Date.now();

  // Track the candle time of this BUY so strategy exit signals on the same candle are blocked
  lastBuyCandleTime[symbol] = lastStrategyCandleTime;

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



    // Check max loss/profit immediately after cycle â€” don't wait for next tick
    if (trade.maxProfitLossEnabled) {
      if (trade.maxLoss > 0 && totalPnl <= -trade.maxLoss) {
        queueSound("exit");
        const finalLogs = [
          ...trade.logs, logLine,
          `Trade P/L: ${cyclePnl.toFixed(2)}`,
          `Cycle ${newCompletedCycles}/${trade.numberOfTrades} completed`,
          `MAX LOSS â‚¹${trade.maxLoss} reached (P/L: â‚¹${totalPnl.toFixed(2)}) - Auto-exiting`,
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
          `MAX PROFIT â‚¹${trade.maxProfit} reached (P/L: â‚¹${totalPnl.toFixed(2)}) - Auto-exiting`,
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
    const sellLog = trade.inPosition ? `SELL triggered for â‚¹${exitPrice} at ${currentTime}` : "";

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
    const sellLog = `SELL triggered for â‚¹${exitPrice} at ${currentTime}`;

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



    // Check max loss/profit immediately after cycle â€” don't wait for next tick
    if (trade.maxProfitLossEnabled) {
      if (trade.maxLoss > 0 && totalPnl <= -trade.maxLoss) {
        queueSound("exit");
        const finalLogs = [
          ...trade.logs, sellLog, logLine,
          `Trade P/L: ${cyclePnl.toFixed(2)}`,
          `Cycle ${newCompletedCycles}/${trade.numberOfTrades} completed`,
          `MAX LOSS â‚¹${trade.maxLoss} reached (P/L: â‚¹${totalPnl.toFixed(2)}) - Auto-exiting`,
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
          `MAX PROFIT â‚¹${trade.maxProfit} reached (P/L: â‚¹${totalPnl.toFixed(2)}) - Auto-exiting`,
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
    const signalReEntryArmed = trade.signalReEntryEnabled;
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
      reEntryMsg = `Auto Re-entry armed: watching for price > â‚¹${exitPrice} within ${trade.reEntryCandles} candles`;
    } else if (trade.reEntryAfterTargetEnabled && !isProfitableExit) {
      reEntryMsg += ` [Auto Re-entry skipped: not a profitable exit]`;
    } else if (!trade.reEntryAfterTargetEnabled) {
      reEntryMsg += ` [Auto Re-entry disabled]`;
    }
    if (trade.signalReEntryEnabled) {
      reEntryMsg += ` [Signal Re-entry armed: waiting for REENTER signal]`;
    }

    return {

      ...trade, pnl: totalPnl, inPosition: false, completedCycles: newCompletedCycles,

      logs: [...trade.logs, sellLog, logLine, `Trade P/L: ${cyclePnl.toFixed(2)}`, reEntryMsg],

      trailingTrailActive: false, trailingHighWatermark: undefined,

      lastSellCandleTime: lastStrategyCandleTime || trade.lastSellCandleTime,

      signalReEntryArmed,

      ...reEntryInfo,

    };

  });

}



function updateActiveTradeBuy(symbol: string, entryPrice: string, logLine: string) {

  queueSound("enter");

  const matchedTrade = activeTrades.find((t) => t.symbol === symbol && t.status === "ACTIVE");

  activeTrades = activeTrades.map((trade) => {

    if (trade.symbol !== symbol || trade.status !== "ACTIVE") return trade;

    const isReEntry = logLine.includes("RE-ENTRY") || logLine.includes("REENTER");
    const armTrailing = isReEntry && trade.reEntryAsTrailingEnabled && trade.trailingAfterTargetEnabled;
    const reEntryLogs = [...trade.logs, logLine];
    if (armTrailing) {
      reEntryLogs.push(`Trailing SL armed at re-entry â‚¹${entryPrice} (trail: ${trade.reEntryTrailingPoints} pts)`);
    }

    return {

      ...trade, entryPrice, inPosition: true,

      entryTime: logLine.includes("at ") ? logLine.split("at ")[1] : undefined,

      logs: reEntryLogs,

      trailingTrailActive: armTrailing, trailingHighWatermark: armTrailing ? Number(entryPrice) : undefined,
      trailingAfterTarget: armTrailing ? trade.reEntryTrailingPoints : trade.trailingAfterTarget,

      minTargetHighWatermark: undefined,
      minTargetLockedPrice: undefined,

      reEntryExitPrice: undefined, reEntrySellTime: undefined, reEntryReason: undefined,
      pendingSkippedBuy: false, signalReEntryArmed: false,
      isReEntryCycle: isReEntry,

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

  // Mark buy timestamp â€” during grace period, LTP monitoring ignores stale candle low/high
  lastBuyTimestamp[symbol] = Date.now();

  // Track the candle time of this BUY so strategy exit signals on the same candle are blocked
  lastBuyCandleTime[symbol] = lastStrategyCandleTime;

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

function setPendingSkippedBuy(symbol: string, value: boolean) {
  waitingTrades = waitingTrades.map((t) =>
    t.symbol === symbol ? { ...t, pendingSkippedBuy: value } : t
  );
  activeTrades = activeTrades.map((t) =>
    t.symbol === symbol && t.status === "ACTIVE" ? { ...t, pendingSkippedBuy: value } : t
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

      logs: [...t.logs, `Trailing target armed at â‚¹${price.toFixed(2)} on ${timeLabel}`],

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



function updateMinTargetHighWatermark(symbol: string, price: number) {

  activeTrades = activeTrades.map((t) => {

    if (t.symbol !== symbol || t.status !== "ACTIVE") return t;

    if (t.minTargetLockedPrice !== undefined) return t;

    if (t.minTargetHighWatermark && price <= t.minTargetHighWatermark) return t;

    return { ...t, minTargetHighWatermark: price };

  });

}



function lockMinTargetPrice(symbol: string, price: number) {

  activeTrades = activeTrades.map((t) => {

    if (t.symbol !== symbol || t.status !== "ACTIVE") return t;

    return { ...t, minTargetLockedPrice: price };

  });

}



// â”€â”€â”€ Strategy signal handling (from StrategyTimerProvider) â”€â”€â”€



// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handleStrategySignal(signal: any) {

  if (!signal) return;

  // Auto-detect history readiness from candles in the signal payload
  const candlesInSignal = Array.isArray(signal.candles) ? signal.candles : [];
  if (signal.symbol && candlesInSignal.length >= 10) {
    if (symbolHistoryStatus[signal.symbol]?.status !== "ready") {
      console.log(`[trade-engine] Symbol ${signal.symbol} history detected in signal (${candlesInSignal.length} candles). Marking as ready.`);
      symbolHistoryStatus[signal.symbol] = { status: "ready", candleCount: candlesInSignal.length };
      symbolsWithFirstSignal.add(signal.symbol);
    }
  }

  // Mark symbol as initialized only when:
  // 1. Its candle time is current (within 5 min of lastStrategyCandleTime)
  // 2. History fetch status is "ready" (not "loading" or "failed")
  if (signal.symbol && signal.signal) {
    const sigMin = toMinutes(signal.lastCandleTime);
    const refMin = toMinutes(lastStrategyCandleTime);
    const isCurrent = refMin < 0 || sigMin < 0 || (refMin - sigMin) <= 5;
    const histStatus = symbolHistoryStatus[signal.symbol];
    const historyOk = histStatus?.status === "ready";
    if (isCurrent && historyOk) {
      symbolsWithFirstSignal.add(signal.symbol);
    }
  }

  const latestClose = signal.close ?? signal.candles?.[signal.candles.length - 1]?.close;

  const signalSymbol = signal.symbol;

  const lastCandle = signal.candles?.[signal.candles.length - 1];

  if (signalSymbol) {
    if (Number.isFinite(Number(latestClose))) lastCandleCloseMap[signalSymbol] = Number(latestClose);
    const h = Number(signal.high ?? lastCandle?.high);
    const l = Number(signal.low ?? lastCandle?.low);
    if (Number.isFinite(h)) lastCandleHigh[signalSymbol] = h;
    if (Number.isFinite(l)) lastCandleLow[signalSymbol] = l;
    if (typeof signal.trending === "boolean") lastUpwards[signalSymbol] = signal.trending;
  }

  const activeForSymbol = activeTrades.find((t) => t.symbol === signalSymbol && t.status === "ACTIVE");

  const hasWaitingTrade = waitingTrades.some((t) => t.symbol === signalSymbol);

  const waitingForBuy = (!activeForSymbol || !activeForSymbol.inPosition) && (hasWaitingTrade || Boolean(activeForSymbol));

  const waitingForSell = Boolean(activeForSymbol && activeForSymbol.inPosition);



  const candleTime = signal.lastCandleTime || signal.candles?.[signal.candles.length - 1]?.time;

  if (candleTime) {

    lastStrategyCandleTime = candleTime;

  }



  // AI Guard â€” combined analysis once per new candle per symbol (only for symbols with AI toggle ON)
  if (isAiGuardActive() && signalSymbol && aiSymbolEnabled[signalSymbol] === true && candleTime && candleTime !== lastAiCandleTime[signalSymbol]) {
    lastAiCandleTime[signalSymbol] = candleTime;
    const settings = getAiGuardSettings();
    const activeTrade = activeTrades.find((t) => t.symbol === signalSymbol && t.status === "ACTIVE");
    const tradeContext: { entryPrice?: string; ltp?: number; pnl?: number; signal?: string } = {};
    if (activeTrade) {
      tradeContext.entryPrice = activeTrade.entryPrice;
      tradeContext.pnl = activeTrade.pnl;
    }
    tradeContext.signal = signal.signal;
    fetch(`${STRATEGY_URL}/chart-history`)
      .then((r) => r.json())
      .then((historyData) => {
        const candles = Array.isArray(historyData?.[signalSymbol]) ? historyData[signalSymbol] : [];
        if (candles.length === 0) {
          addAiLog(`[ai-guard] No chart-history for ${signalSymbol}, skipping`);
          return null;
        }
        // Auto-detect history readiness from chart-history response
        if (symbolHistoryStatus[signalSymbol]?.status !== "ready") {
          console.log(`[trade-engine] Symbol ${signalSymbol} history detected in chart-history (${candles.length} candles). Marking as ready.`);
          symbolHistoryStatus[signalSymbol] = { status: "ready", candleCount: candles.length };
          symbolsWithFirstSignal.add(signalSymbol);
        }
        addAiLog(`[ai-guard] ${signalSymbol}: ${candles.length} candles from chart-history, using last ${Math.min(candles.length, settings.candlesCount)}`);
        return analyzeMarketRegime(signalSymbol, candles, tradeContext);
      })
      .catch((e) => {
        addAiErrorLog(`[ai-guard] chart-history fetch failed for ${signalSymbol}: ${String(e)}`);
        return null;
      })
      .then((result) => {
        if (!result) return;
        lastAiResult[signalSymbol] = result;
        const now = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });

        // Always update AI suggestions list for both waiting and active trades
        // This ensures the UI message bubble is always current and visible for all regimes
        const matchingWaiting = waitingTrades.find((t) => t.symbol === signalSymbol);
        const matchingActive = activeTrades.find((t) => t.symbol === signalSymbol && t.status === "ACTIVE");

        if (matchingWaiting) {
          for (let i = aiSuggestions.length - 1; i >= 0; i--) {
            if (aiSuggestions[i].symbol === signalSymbol && aiSuggestions[i].type === "ENTRY_BLOCKED") {
              aiSuggestions.splice(i, 1);
            }
          }
          aiSuggestions.push({
            symbol: signalSymbol,
            type: "ENTRY_BLOCKED",
            marketRegime: result.marketRegime,
            confidence: result.confidence,
            reason: result.reason,
            timestamp: now,
            dismissed: false,
          });
        }

        if (matchingActive) {
          for (let i = aiSuggestions.length - 1; i >= 0; i--) {
            if (aiSuggestions[i].symbol === signalSymbol && aiSuggestions[i].type === "EXIT_SUGGESTED") {
              aiSuggestions.splice(i, 1);
            }
          }
          aiSuggestions.push({
            symbol: signalSymbol,
            type: "EXIT_SUGGESTED",
            marketRegime: result.marketRegime,
            confidence: result.confidence,
            reason: result.reason,
            timestamp: now,
            dismissed: false,
          });
        }

        // EntryGuard â€” block BUY if sideways/reversing
        if (settings.entryGuardEnabled && result.blockEntry) {
          // If there's a buffered BUY, increment its candle count
          const buffered = pendingBuyBuffer[signalSymbol];
          if (buffered) {
            buffered.candlesElapsed++;
            if (buffered.candlesElapsed >= AI_BUFFER_MAX_CANDLES) {
              // Buffer expired â€” AI never confirmed upwards within 5 candles
              delete pendingBuyBuffer[signalSymbol];
              const expireLog = `BUY buffer expired after ${AI_BUFFER_MAX_CANDLES} candles â€” AI never confirmed upwards at ${now}`;
              if (waitingTrades.find((t) => t.symbol === signalSymbol)) { addLogToWaiting(signalSymbol, expireLog); }
              else if (activeTrades.find((t) => t.symbol === signalSymbol)) { addLogToActive(signalSymbol, expireLog); }
              addAiLog(`[ai-guard] BUY buffer expired for ${signalSymbol} after ${AI_BUFFER_MAX_CANDLES} candles`);
            } else {
              const waitLog = `BUY buffer waiting â€” AI still sideways (${result.reason}, ${result.confidence}%) â€” candle ${buffered.candlesElapsed}/${AI_BUFFER_MAX_CANDLES} at ${now}`;
              if (waitingTrades.find((t) => t.symbol === signalSymbol)) { addLogToWaiting(signalSymbol, waitLog); }
              else if (activeTrades.find((t) => t.symbol === signalSymbol)) { addLogToActive(signalSymbol, waitLog); }
              addAiLog(`[ai-guard] BUY buffer waiting for ${signalSymbol}: candle ${buffered.candlesElapsed}/${AI_BUFFER_MAX_CANDLES}`);
            }
          }

          addAiLog(`[ai-guard] Entry blocked for ${signalSymbol}: ${result.reason} (${result.confidence}%)`);
        } else if (settings.entryGuardEnabled && !result.blockEntry) {
          // AI says upwards â€” if there's a buffered BUY, fire it now
          const buffered = pendingBuyBuffer[signalSymbol];
          if (buffered) {
            const currentClose = lastCandleCloseMap[signalSymbol];
            const entryPrice = String(currentClose ?? latestClose ?? "");
            const fireLog = `BUY fired from buffer â€” AI confirmed upwards (${result.marketRegime}, ${result.confidence}%) after ${buffered.candlesElapsed} candle(s) at ${now}`;
            const matchingTrade = waitingTrades.find((t) => t.symbol === signalSymbol);
            const activeTrade2 = activeTrades.find((t) => t.symbol === signalSymbol && t.status === "ACTIVE");
            if (matchingTrade) {
              activateWaitingTrade(signalSymbol, entryPrice, fireLog);
            } else if (activeTrade2 && !activeTrade2.inPosition) {
              updateActiveTradeBuy(signalSymbol, entryPrice, fireLog);
            }
            delete pendingBuyBuffer[signalSymbol];
            setPendingSkippedBuy(signalSymbol, false);
            addAiLog(`[ai-guard] Buffered BUY fired for ${signalSymbol}: upwards confirmed after ${buffered.candlesElapsed} candle(s)`);
          }
        }

        // Clear sideways retry if AI now says upwards
        if (!result.suggestExit || result.marketRegime === "UPWARDS") {
          if (pendingSidewaysExits[signalSymbol]) {
            addLogToActive(signalSymbol, `AI now confirms UPWARDS â€” sideways exit cancelled at ${now}`);
            addAiLog(`[ai-guard] ${signalSymbol} returned to UPWARDS, clearing sideways retry`);
            delete pendingSidewaysExits[signalSymbol];
          }
        }

        // Exit Guard â€” suggest or auto-execute exit
        if (result.suggestExit && activeTrade && activeTrade.inPosition) {
          if (settings.autoExitEnabled) {
            // If sideways, start or continue the 30s retry window
            if (result.marketRegime === "SIDEWAYS") {
              if (!pendingSidewaysExits[signalSymbol]) {
                pendingSidewaysExits[signalSymbol] = { retryCount: 0, lastRetryTime: Date.now() };
                const sideLog = `AI detected SIDEWAYS â€” waiting 30s with 10s retries before auto-exit at ${now}`;
                addLogToActive(signalSymbol, sideLog);
                addAiLog(`[ai-guard] Sideways detected for ${signalSymbol}, starting 30s retry window`);
                return; // Don't exit yet
              } else {
                // Already in retry window, wait for tick to handle it
                return;
              }
            }

            // Auto-execute exit (for REVERSING or immediate exit if not sideways)
            completeCycleWithoutExit(
              activeTrade.symbol,
              String(latestClose ?? ""),
              `AI Guard auto-exit: ${result.reason} (${result.confidence}%) at ${now}`
            );
            updateLastSellCandleTime(activeTrade.symbol, signal.lastCandleTime ?? "");
            addAiLog(`[ai-guard] Auto-exit executed for ${signalSymbol}: ${result.reason} (${result.confidence}%)`);
            delete pendingSidewaysExits[signalSymbol];
          } else {
            addAiLog(`[ai-guard] Exit suggested for ${signalSymbol}: ${result.reason} (${result.confidence}%)`);
          }
        }
      }).catch((e) => {
        addAiErrorLog("[ai-guard] Analysis error: " + String(e));
      });
  }



  // Auto-sell cutoff at 3:25 PM — use server system time, not stale candle time
  const AUTO_SELL_CUTOFF_MINUTES = 15 * 60 + 25;
  const sysNow = new Date();
  const sysMinutes = sysNow.getHours() * 60 + sysNow.getMinutes();
  const sysTimeStr = `${String(sysNow.getHours()).padStart(2, "0")}:${String(sysNow.getMinutes()).padStart(2, "0")}`;

  if (sysMinutes >= AUTO_SELL_CUTOFF_MINUTES && activeForSymbol && activeForSymbol.inPosition) {

    completeActiveTrade(

      activeForSymbol.symbol,

      String(latestClose ?? ""),

      `AUTO SELL triggered post 03:25 pm cut-off at â‚¹${String(latestClose ?? "")} (sys ${sysTimeStr})`

    );

    updateLastSellCandleTime(activeForSymbol.symbol, signal.lastCandleTime ?? "15:25");

    return;

  }



  // STOPLOSS signal

  if (signal.signal === "STOPLOSS") {

    const signalKey = signal.signal + "-" + signal.lastCandleTime;

    if (signalKey === lastHandledSignalKey[signalSymbol]) return;

    if (!activeForSymbol || !activeForSymbol.inPosition) return;

    // Block strategy exit signals on the same candle as entry or within 5s grace period
    if (lastBuyCandleTime[signalSymbol] && signal.lastCandleTime === lastBuyCandleTime[signalSymbol]) return;
    if (lastBuyTimestamp[signalSymbol] && (Date.now() - lastBuyTimestamp[signalSymbol]) < BUY_GRACE_PERIOD_MS) return;

    completeCycleWithoutExit(activeForSymbol.symbol, String(latestClose ?? ""), "STOPLOSS hit for â‚¹" + String(latestClose ?? "") + " at " + fmtTime(signal.lastCandleTime));

    lastHandledSignalKey[signalSymbol] = signalKey;

    return;

  }



  // TARGET signal

  if (signal.signal === "TARGET") {

    const signalKey = signal.signal + "-" + signal.lastCandleTime;

    if (signalKey === lastHandledSignalKey[signalSymbol]) return;

    if (!activeForSymbol || !activeForSymbol.inPosition) return;

    // Block strategy exit signals on the same candle as entry or within 5s grace period
    if (lastBuyCandleTime[signalSymbol] && signal.lastCandleTime === lastBuyCandleTime[signalSymbol]) return;
    if (lastBuyTimestamp[signalSymbol] && (Date.now() - lastBuyTimestamp[signalSymbol]) < BUY_GRACE_PERIOD_MS) return;

    if (activeForSymbol.trailingAfterTargetEnabled && activeForSymbol.trailingAfterTarget > 0) {

      lastHandledSignalKey[signalSymbol] = signalKey;

      return;

    }

    completeCycleWithoutExit(activeForSymbol.symbol, String(latestClose ?? ""), "TARGET hit for â‚¹" + String(latestClose ?? "") + " at " + fmtTime(signal.lastCandleTime));

    lastHandledSignalKey[signalSymbol] = signalKey;

    return;

  }



  // SELL signal

  if (signal.signal === "SELL") {

    const signalKey = signal.signal + "-" + signal.lastCandleTime;

    if (signalKey === lastHandledSignalKey[signalSymbol]) return;

    if (waitingForBuy) return;

    if (!activeForSymbol || !activeForSymbol.inPosition) return;

    // Block strategy exit signals on the same candle as entry or within 5s grace period
    if (lastBuyCandleTime[signalSymbol] && signal.lastCandleTime === lastBuyCandleTime[signalSymbol]) return;
    if (lastBuyTimestamp[signalSymbol] && (Date.now() - lastBuyTimestamp[signalSymbol]) < BUY_GRACE_PERIOD_MS) return;

    completeCycleWithoutExit(activeForSymbol.symbol, String(latestClose ?? ""), "SELL triggered for â‚¹" + String(latestClose ?? "") + " at " + fmtTime(signal.lastCandleTime));

    updateLastSellCandleTime(activeForSymbol.symbol, signal.lastCandleTime);

    lastHandledSignalKey[signalSymbol] = signalKey;

    return;

  }



  // REEXIT signal — respects signal re-exit for trades entered via REENTER

  if (signal.signal === "REEXIT") {

    const signalKey = signal.signal + "-" + signal.lastCandleTime;

    if (signalKey === lastHandledSignalKey[signalSymbol]) return;

    if (waitingForBuy) return;

    if (!activeForSymbol || !activeForSymbol.inPosition) return;

    if (!activeForSymbol.isReEntryCycle) return;

    // Block strategy exit signals on the same candle as entry or within 5s grace period
    if (lastBuyCandleTime[signalSymbol] && signal.lastCandleTime === lastBuyCandleTime[signalSymbol]) return;
    if (lastBuyTimestamp[signalSymbol] && (Date.now() - lastBuyTimestamp[signalSymbol]) < BUY_GRACE_PERIOD_MS) return;

    setPendingSkippedBuy(signalSymbol, false);

    completeActiveTrade(activeForSymbol.symbol, String(latestClose ?? ""), "REEXIT triggered for ₹" + String(latestClose ?? "") + " at " + fmtTime(signal.lastCandleTime));

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

        const skippedLog = `BUY skipped â€“ outside time range (${tradeForRange.timeFrom} ${tradeForRange.timeFromAmpm} â€“ ${tradeForRange.timeTo} ${tradeForRange.timeToAmpm}) for â‚¹${latestClose ?? ""} at ${fmtTime(signal.lastCandleTime)}`;

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

          const waitLog = `BUY skipped â€“ waiting ${tradeForWaitCheck.waitAfterSellCandles} candles after SELL (${candlesPassed} passed) at ${fmtTime(signal.lastCandleTime)}`;

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

      const ignoredLog = `BUY ignored â€“ candle size ${candleSize.toFixed(2)} >= buyOverride ${overrideValue} at ${fmtTime(signal.lastCandleTime)} (waiting for REENTER signal)`;

      if (matchingTrade) { addLogToWaiting(matchingTrade.symbol, ignoredLog); }

      else if (activeForSymbol && !activeForSymbol.inPosition) { addLogToActive(activeForSymbol.symbol, ignoredLog); }

      setPendingSkippedBuy(signalSymbol, true);

      lastHandledSignalKey[signalSymbol] = signalKey;

      return;

    }



    // AI Guard EntryGuard â€” check if AI blocked entry for this symbol
    const aiResult = lastAiResult[signalSymbol];
    const aiSettings = getAiGuardSettings();
    if (aiSettings.entryGuardEnabled && aiResult && aiResult.blockEntry) {
      // Buffer the BUY instead of permanently blocking â€” wait up to 5 candles for upwards
      pendingBuyBuffer[signalSymbol] = {
        signalType: "BUY",
        bufferedCandleTime: candleTime ?? "",
        candlesElapsed: 0,
        originalSignal: signal,
      };
      const blockedLog = `BUY buffered by AI Guard â€” ${aiResult.reason} (${aiResult.confidence}%) at ${fmtTime(signal.lastCandleTime)} (waiting for upwards, up to ${AI_BUFFER_MAX_CANDLES} candles)`;
      if (matchingTrade) { addLogToWaiting(matchingTrade.symbol, blockedLog); }
      else if (activeForSymbol && !activeForSymbol.inPosition) { addLogToActive(activeForSymbol.symbol, blockedLog); }
      addAiLog(`[ai-guard] BUY buffered for ${signalSymbol}: ${aiResult.reason} (${aiResult.confidence}%)`);
      lastHandledSignalKey[signalSymbol] = signalKey;
      return;
    }

    if (matchingTrade) {

      activateWaitingTrade(matchingTrade.symbol, String(latestClose ?? ""), "BUY triggered for â‚¹ " + String(latestClose ?? "") + " at " + fmtTime(signal.lastCandleTime));

    } else if (activeForSymbol && !activeForSymbol.inPosition) {

      updateActiveTradeBuy(activeForSymbol.symbol, String(latestClose ?? ""), "BUY triggered for â‚¹ " + String(latestClose ?? "") + " at " + fmtTime(signal.lastCandleTime));

    }

    // Clear buffer and pending skipped buy on successful entry
    delete pendingBuyBuffer[signalSymbol];
    setPendingSkippedBuy(signalSymbol, false);

    lastHandledSignalKey[signalSymbol] = signalKey;

  }



  // REENTER signal

  if (signal.signal === "REENTER") {

    const signalKey = signal.signal + "-" + signal.lastCandleTime;

    if (signalKey === lastHandledSignalKey[signalSymbol]) return;

    if (waitingForSell) return;

    const reenterTrade = waitingTrades.find((t) => t.symbol === signalSymbol)
      ?? (activeForSymbol && !activeForSymbol.inPosition ? activeForSymbol : null);

    if (!reenterTrade) return;

    const hasPendingSkip = reenterTrade.pendingSkippedBuy === true;
    const hasSignalReEntry = ("signalReEntryArmed" in reenterTrade) && (reenterTrade as ActiveTrade).signalReEntryArmed === true && (reenterTrade as ActiveTrade).signalReEntryEnabled;

    if (!hasPendingSkip && !hasSignalReEntry) {
      const ignoreLog = `REENTER ignored â€“ no pending skipped BUY or signal re-entry at ${fmtTime(signal.lastCandleTime)}`;
      if (waitingTrades.find((t) => t.symbol === signalSymbol)) {
        addLogToWaiting(signalSymbol, ignoreLog);
      } else {
        addLogToActive(signalSymbol, ignoreLog);
      }
      lastHandledSignalKey[signalSymbol] = signalKey;
      return;
    }

    // Apply guards if they are enabled on the trade
    const reCandles = signal.candles;
    const rePrevCandle = Array.isArray(reCandles) && reCandles.length > 0 ? reCandles[reCandles.length - 1] : null;
    const reCandleSize = rePrevCandle ? Math.abs(Number(rePrevCandle.close) - Number(rePrevCandle.open)) : 0;

    // Time range guard
    if (reenterTrade.rangeEnabled) {
      const rangeStart = toMinutes12h(reenterTrade.timeFrom, reenterTrade.timeFromAmpm);
      const rangeEnd = toMinutes12h(reenterTrade.timeTo, reenterTrade.timeToAmpm);
      const cMin = toMinutes(signal.lastCandleTime);
      if (cMin >= 0 && (cMin < rangeStart || cMin > rangeEnd)) {
        const skipLog = `REENTER skipped â€“ outside time range at ${fmtTime(signal.lastCandleTime)}`;
        if (waitingTrades.find((t) => t.symbol === signalSymbol)) { addLogToWaiting(signalSymbol, skipLog); } else { addLogToActive(signalSymbol, skipLog); }
        lastHandledSignalKey[signalSymbol] = signalKey;
        return;
      }
    }

    // Wait-after-sell guard
    if (reenterTrade.waitAfterSellEnabled && activeForSymbol?.lastSellCandleTime) {
      const lastSellMin = toMinutes(activeForSymbol.lastSellCandleTime);
      const currentMin = toMinutes(signal.lastCandleTime);
      if (lastSellMin >= 0 && currentMin >= 0 && (currentMin - lastSellMin) < reenterTrade.waitAfterSellCandles) {
        const waitLog = `REENTER skipped â€“ waiting ${reenterTrade.waitAfterSellCandles} candles after SELL at ${fmtTime(signal.lastCandleTime)}`;
        if (waitingTrades.find((t) => t.symbol === signalSymbol)) { addLogToWaiting(signalSymbol, waitLog); } else { addLogToActive(signalSymbol, waitLog); }
        lastHandledSignalKey[signalSymbol] = signalKey;
        return;
      }
    }

    // Candle size guard
    const reOverrideValue = reenterTrade.buyOverride;
    if (reOverrideValue != null && reOverrideValue > 0 && reCandleSize >= reOverrideValue) {
      const sizeLog = `REENTER skipped â€“ candle size ${reCandleSize.toFixed(2)} >= ${reOverrideValue} at ${fmtTime(signal.lastCandleTime)}`;
      if (waitingTrades.find((t) => t.symbol === signalSymbol)) { addLogToWaiting(signalSymbol, sizeLog); } else { addLogToActive(signalSymbol, sizeLog); }
      lastHandledSignalKey[signalSymbol] = signalKey;
      return;
    }

    // AI Guard EntryGuard for REENTER â€” same buffering logic as BUY
    const reAiResult = lastAiResult[signalSymbol];
    const reAiSettings = getAiGuardSettings();
    if (reAiSettings.entryGuardEnabled && reAiResult && reAiResult.blockEntry) {
      pendingBuyBuffer[signalSymbol] = {
        signalType: "REENTER",
        bufferedCandleTime: candleTime ?? "",
        candlesElapsed: 0,
        originalSignal: signal,
      };
      const blockedLog = `REENTER buffered by AI Guard â€” ${reAiResult.reason} (${reAiResult.confidence}%) at ${fmtTime(signal.lastCandleTime)} (waiting for upwards, up to ${AI_BUFFER_MAX_CANDLES} candles)`;
      if (waitingTrades.find((t) => t.symbol === signalSymbol)) { addLogToWaiting(signalSymbol, blockedLog); }
      else { addLogToActive(signalSymbol, blockedLog); }
      addAiLog(`[ai-guard] REENTER buffered for ${signalSymbol}: ${reAiResult.reason} (${reAiResult.confidence}%)`);
      lastHandledSignalKey[signalSymbol] = signalKey;
      return;
    }

    // Price guard â€” only re-enter if current price is higher than last exit price
    const lastExitPrice = ("exitPrice" in reenterTrade && reenterTrade.exitPrice) ? Number(reenterTrade.exitPrice) : NaN;
    if (Number.isFinite(lastExitPrice) && Number.isFinite(latestClose) && latestClose <= lastExitPrice) {
      const priceLog = `REENTER skipped â€“ current price â‚¹${latestClose} <= last exit price â‚¹${lastExitPrice} at ${fmtTime(signal.lastCandleTime)}`;
      if (waitingTrades.find((t) => t.symbol === signalSymbol)) { addLogToWaiting(signalSymbol, priceLog); } else { addLogToActive(signalSymbol, priceLog); }
      lastHandledSignalKey[signalSymbol] = signalKey;
      return;
    }

    // All guards passed â€” enter
    const reenterLabel = hasPendingSkip ? "REENTER (skipped candle re-entry)" : "SIGNAL RE-ENTRY";
    const reenterLog = `${reenterLabel} triggered for â‚¹${latestClose ?? ""} at ${fmtTime(signal.lastCandleTime)}`;
    if (waitingTrades.find((t) => t.symbol === signalSymbol)) {
      activateWaitingTrade(signalSymbol, String(latestClose ?? ""), reenterLog);
    } else if (activeForSymbol && !activeForSymbol.inPosition) {
      updateActiveTradeBuy(signalSymbol, String(latestClose ?? ""), reenterLog);
    }
    delete pendingBuyBuffer[signalSymbol];
    setPendingSkippedBuy(signalSymbol, false);
    lastHandledSignalKey[signalSymbol] = signalKey;
    return;

  }

}



// â”€â”€â”€ LTP-based SL/Target/Trailing monitoring (from dashboard/page.tsx) â”€â”€â”€



function handleLtpMonitoring(ltpMap: Record<string, number>, marketTime?: string) {

  for (const trade of activeTrades) {

    if (trade.status !== "ACTIVE") continue;

    const ltp = ltpMap[trade.symbol];
    if (!Number.isFinite(ltp)) continue;

    const targetPrice = trade.targetMode === "candleClose" && Number.isFinite(lastCandleCloseMap[trade.symbol]) ? lastCandleCloseMap[trade.symbol] : ltp;
    const trailingPrice = trade.trailingMode === "candleClose" && Number.isFinite(lastCandleCloseMap[trade.symbol]) ? lastCandleCloseMap[trade.symbol] : ltp;

    // Use real-time LTP for SL/Minimum Target. Target/Trailing may use LTP or last candle close based on mode.

    const currentTime = marketTime || fmtTime();

    // â”€â”€ Max Profit / Max Loss check (runs even when NOT in position) â”€â”€
    // This is the overall trade-level guard â€” takes priority over per-cycle SL/target.
    if (trade.maxProfitLossEnabled) {
      const qty = trade.lotSize * trade.lotValue;
      const entry = Number(trade.entryPrice);
      const bestPnl = (trade.inPosition && Number.isFinite(entry)) ? (ltp - entry) * qty : 0;
      const worstPnl = (trade.inPosition && Number.isFinite(entry)) ? (ltp - entry) * qty : 0;

      const ltpPnl = (trade.inPosition && Number.isFinite(entry)) ? (ltp - entry) * qty : 0;

      if (trade.maxProfit > 0 && (trade.pnl + bestPnl) >= trade.maxProfit) {
        const exitPrice = (trade.pnl + ltpPnl) >= trade.maxProfit ? ltp : entry + (trade.maxProfit - trade.pnl) / qty;
        forceExitTrade(trade.symbol, String(exitPrice), trade.pnl + bestPnl, `MAX PROFIT â‚¹${trade.maxProfit} reached (P/L: â‚¹${(trade.pnl + bestPnl).toFixed(2)}) at ${currentTime}`);
        continue;
      }

      if (trade.maxLoss > 0 && (trade.pnl + worstPnl) <= -trade.maxLoss) {
        const exitPrice = (trade.pnl + ltpPnl) <= -trade.maxLoss ? ltp : entry + (-trade.maxLoss - trade.pnl) / qty;
        forceExitTrade(trade.symbol, String(exitPrice), trade.pnl + worstPnl, `MAX LOSS â‚¹${trade.maxLoss} reached (P/L: â‚¹${(trade.pnl + worstPnl).toFixed(2)}) at ${currentTime}`);
        continue;
      }
    }

    // --- Global Total Exit check ---
    let totalAccountPnl = 0;
    for (const t of activeTrades) {
      totalAccountPnl += t.pnl;
      if (t.inPosition && t.symbol === trade.symbol) {
        const qty = t.lotSize * t.lotValue;
        const entry = Number(t.entryPrice);
        if (Number.isFinite(entry)) {
          totalAccountPnl += (ltp - entry) * qty;
        }
      } else if (t.inPosition && ltpMap[t.symbol]) {
        const otherLtp = ltpMap[t.symbol];
        const qty = t.lotSize * t.lotValue;
        const entry = Number(t.entryPrice);
        if (Number.isFinite(entry)) {
          totalAccountPnl += (otherLtp - entry) * qty;
        }
      }
    }

    if (totalTargetEnabled && totalAccountPnl >= totalTargetValue) {
      executeTotalExit(`TOTAL TARGET ₹${totalTargetValue} reached (Total P/L: ₹${totalAccountPnl.toFixed(2)}) at ${currentTime}`, ltpMap);
      return;
    }

    if (totalLossEnabled && totalAccountPnl <= totalLossValue) {
      executeTotalExit(`TOTAL LOSS ₹${totalLossValue} reached (Total P/L: ₹${totalAccountPnl.toFixed(2)}) at ${currentTime}`, ltpMap);
      return;
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
          const reEntryThreshold = trade.reEntryExitPrice + (trade.reEntryPoints || 5);
          if (candlesSinceSell <= trade.reEntryCandles) {
            if (ltp > reEntryThreshold) {
              // UPWARDS gate â€” block re-entry if upwards is false or unavailable
              if (!lastUpwards[trade.symbol]) {
                if (lastReEntryBlockedCandle[trade.symbol] !== lastStrategyCandleTime) {
                  lastReEntryBlockedCandle[trade.symbol] = lastStrategyCandleTime;
                  const upwardsReason = trade.symbol in lastUpwards
                    ? "UPWARDS is false"
                    : "UPWARDS is unavailable";
                  addLogToActive(trade.symbol, `RE-ENTRY blocked â€” ${upwardsReason} at ${currentTime}`);
                }
                continue;
              }
              // NIFTY 50 directional guard — CE requires green, PE requires red
              const { open: niftyOpen, ltp: niftyLtp } = getNiftyLive();
              if (niftyOpen > 0 && niftyLtp > 0) {
                const isCE = trade.symbol.endsWith("CE");
                const isPE = trade.symbol.endsWith("PE");
                const niftyGreen = niftyLtp > niftyOpen;
                const niftyRed = niftyLtp < niftyOpen;
                if ((isCE && !niftyGreen) || (isPE && !niftyRed)) {
                  if (lastReEntryBlockedCandle[trade.symbol] !== lastStrategyCandleTime) {
                    lastReEntryBlockedCandle[trade.symbol] = lastStrategyCandleTime;
                    const niftyDir = niftyGreen ? "GREEN" : niftyRed ? "RED" : "FLAT";
                    addLogToActive(trade.symbol, `RE-ENTRY blocked — NIFTY 50 is ${niftyDir} at ${currentTime} (need ${isCE ? "GREEN" : "RED"} for ${isCE ? "CE" : "PE"})`);
                  }
                  continue;
                }
              }
              // AI Guard check â€” block re-entry if AI says sideways/reversing
              const aiSettings = getAiGuardSettings();
              if (aiSettings.entryGuardEnabled && isAiGuardActive() && aiSymbolEnabled[trade.symbol] === true) {
                const aiResult = lastAiResult[trade.symbol];
                if (aiResult && aiResult.blockEntry) {
                  if (lastReEntryBlockedCandle[trade.symbol] !== lastStrategyCandleTime) {
                    lastReEntryBlockedCandle[trade.symbol] = lastStrategyCandleTime;
                    addLogToActive(trade.symbol, `RE-ENTRY blocked by AI Guard â€” ${aiResult.marketRegime} (${aiResult.confidence}%) at ${currentTime}`);
                    addAiLog(`[ai-guard] Auto re-entry blocked for ${trade.symbol}: ${aiResult.reason} (${aiResult.confidence}%)`);
                  }
                  continue;
                }
              }
              const reEntryLog = `RE-ENTRY triggered at â‚¹${ltp.toFixed(2)} (price exceeded exit+${trade.reEntryPoints || 5} â‚¹${reEntryThreshold.toFixed(2)} within ${candlesSinceSell}/${trade.reEntryCandles} candles) at ${currentTime}`;
              updateActiveTradeBuy(trade.symbol, String(ltp), reEntryLog);
              continue;
            }
          } else {
            // Window expired â€” clear re-entry state
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

    const useReEntryMinTarget = trade.isReEntryCycle && trade.reEntryMinTargetEnabled;
    const effectiveMinEnabled = useReEntryMinTarget ? true : trade.minToHoldEnabled;
    const effectiveMinPoints = useReEntryMinTarget ? trade.reEntryMinTargetPoints : trade.minToHold;
    const effectiveMinTrigger = useReEntryMinTarget ? trade.reEntryMinTargetTrigger : (trade.minToHoldTrigger || 2);
    const effectiveMinTrailing = useReEntryMinTarget ? trade.reEntryMinTargetTrailing : trade.minToHoldTrailing;

    if (effectiveMinEnabled && effectiveMinPoints > 0) {

      const trailLevel = entry + effectiveMinPoints;

      const activationLevel = trailLevel + effectiveMinTrigger;

      if (!trailingArmedPositions.has(positionKey)) {

        if (ltp >= activationLevel) {
          trailingArmedPositions.add(positionKey);
          addLogToActive(trade.symbol, `${useReEntryMinTarget ? "ReEntry " : ""}Minimum target armed at ₹${ltp.toFixed(2)} (activation: ₹${activationLevel.toFixed(2)}) at ${currentTime}`);
          persistState();
        }

      } else {

        if (effectiveMinTrailing) {

          // Trailing min target mode
          if (trade.minTargetLockedPrice !== undefined) {

            // Already locked at target â€” exit if price drops to locked price
            if (ltp <= trade.minTargetLockedPrice) {
              triggeredPositions.add(positionKey);
              trailingArmedPositions.delete(positionKey);
              completeCycleWithoutExit(trade.symbol, String(trade.minTargetLockedPrice), `${useReEntryMinTarget ? "ReEntry " : ""}TRAILING MIN TARGET hit for â‚¹${trade.minTargetLockedPrice.toFixed(2)} at ${currentTime}`);
              continue;
            }

          } else {

            // Trail behind high watermark by trigger amount
            updateMinTargetHighWatermark(trade.symbol, ltp);
            const minTargetHigh = trade.minTargetHighWatermark ?? ltp;
            const floor = minTargetHigh - effectiveMinTrigger;

            if (ltp <= floor) {
              triggeredPositions.add(positionKey);
              trailingArmedPositions.delete(positionKey);
              completeCycleWithoutExit(trade.symbol, String(floor), `${useReEntryMinTarget ? "ReEntry " : ""}TRAILING MIN TARGET hit for â‚¹${floor.toFixed(2)} at ${currentTime}`);
              continue;
            }

          }

        } else {

          // Normal (non-trailing) min target mode
          if (ltp <= trailLevel) {

            triggeredPositions.add(positionKey);

            trailingArmedPositions.delete(positionKey);

            completeCycleWithoutExit(trade.symbol, String(ltp), `${useReEntryMinTarget ? "ReEntry " : ""}MINIMUM TARGET hit for â‚¹${ltp} at ${currentTime}`);

            continue;

          }

        }

      }

    } else {

      trailingArmedPositions.delete(positionKey);

    }



    // Trailing after target

    if (trailingEnabled && trade.trailingTrailActive) {

      const peakPrice = trailingPrice;

      if (typeof trade.trailingHighWatermark !== "number" || peakPrice > trade.trailingHighWatermark) {

        updateHighWatermark(trade.symbol, peakPrice);

      }

      const highMark = trade.trailingHighWatermark ?? peakPrice;

      const currentTrailingPrice = trailingPrice;

      const drop = highMark - currentTrailingPrice;

      if (drop >= trade.trailingAfterTarget) {

        // If min target is locked, use it as a floor for exit price
        const exitPrice = (trade.minTargetLockedPrice !== undefined)
          ? Math.max(trailingPrice, trade.minTargetLockedPrice)
          : trailingPrice;

        triggeredPositions.add(positionKey);

        completeCycleWithoutExit(trade.symbol, String(exitPrice), `Trailing target hit for â‚¹${exitPrice} at ${currentTime}`);

        continue;

      }

    }



    // Target hit

    if (trade.targetPointsEnabled && trade.targetPoints > 0 && (targetPrice - entry) >= trade.targetPoints) {

      const targetLevel = entry + trade.targetPoints;
      const targetPriceDiff = targetPrice - entry;
      const tgtExit = targetPriceDiff >= trade.targetPoints ? targetPrice : targetLevel;

      if (trailingEnabled) {

        if (!trade.trailingTrailActive) {

          activateTrailing(trade.symbol, tgtExit, currentTime);

          // Lock min target at target - trigger if trailing min target is active
          if (effectiveMinEnabled && effectiveMinTrailing && trailingArmedPositions.has(positionKey)) {
            const lockedPrice = targetLevel - effectiveMinTrigger;
            lockMinTargetPrice(trade.symbol, lockedPrice);
            addLogToActive(trade.symbol, `${useReEntryMinTarget ? "ReEntry " : ""}Trailing min target locked at â‚¹${lockedPrice.toFixed(2)} at ${currentTime}`);
          }

        }

        continue;

      }

      triggeredPositions.add(positionKey);

      completeCycleWithoutExit(trade.symbol, String(tgtExit), `TARGET hit for â‚¹${tgtExit} at ${currentTime}`);

      continue;

    }



    // Stop loss hit

    // Use re-entry SL if trade is a re-entry cycle and reEntryStopLossEnabled
    const effectiveSLEnabled = (trade.isReEntryCycle && trade.reEntryStopLossEnabled) ? true : trade.stopLossNumberEnabled;
    const effectiveSL = (trade.isReEntryCycle && trade.reEntryStopLossEnabled) ? trade.reEntryStopLoss : trade.stopLossNumber;

    if (effectiveSLEnabled && effectiveSL > 0 && (ltp - entry) <= -effectiveSL) {

      const slLevel = entry - effectiveSL;
      const slExit = priceDiff <= -effectiveSL ? ltp : slLevel;

      triggeredPositions.add(positionKey);

      completeCycleWithoutExit(trade.symbol, String(slExit), `STOPLOSS hit for â‚¹${slExit} at ${currentTime}`);

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
          completeCycleWithoutExit(trade.symbol, String(ltp), `SELL (in loss for ${candlesSinceEntry} candles) at â‚¹${ltp} at ${currentTime}`);
          continue;
        }
      }
    }


  }

}



// â”€â”€â”€ Main tick: called every 1 second by the server-side setInterval â”€â”€â”€



let tickInProgress = false;

async function tick() {

  if (!engineRunning) {
    console.log("[trade-engine] Tick called but engine not running, skipping");
    return;
  }

  if (tickInProgress) return;
  tickInProgress = true;
  
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

    // 3. Handle pending sideways exits (10s retries)
    if (isAiGuardActive()) {
      const now = Date.now();
      for (const symbol of Object.keys(pendingSidewaysExits)) {
        const retry = pendingSidewaysExits[symbol];
        if (now - retry.lastRetryTime >= 10000) {
          retry.lastRetryTime = now;
          retry.retryCount++;

          const activeTrade = activeTrades.find((t) => t.symbol === symbol && t.status === "ACTIVE");
          if (!activeTrade || !activeTrade.inPosition) {
            delete pendingSidewaysExits[symbol];
            continue;
          }

          const settings = getAiGuardSettings();
          const tradeContext = {
            entryPrice: activeTrade.entryPrice,
            pnl: activeTrade.pnl,
            signal: activeTrade.lotSize > 0 ? "BUY" : "SELL"
          };

          addAiLog(`[ai-guard] ${symbol}: Sideways retry #${retry.retryCount}/3...`);
          
          fetch(`${STRATEGY_URL}/chart-history`)
            .then(r => r.json())
            .then(historyData => {
              const candles = Array.isArray(historyData?.[symbol]) ? historyData[symbol] : [];
              if (candles.length === 0) return null;
              return analyzeMarketRegime(symbol, candles, tradeContext);
            })
            .then(result => {
              if (!result) return;
              lastAiResult[symbol] = result;
              const timeStr = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });

              // Update AI suggestions list during retry
              for (let i = aiSuggestions.length - 1; i >= 0; i--) {
                if (aiSuggestions[i].symbol === symbol && aiSuggestions[i].type === "EXIT_SUGGESTED") {
                  aiSuggestions.splice(i, 1);
                }
              }
              aiSuggestions.push({
                symbol,
                type: "EXIT_SUGGESTED",
                marketRegime: result.marketRegime,
                confidence: result.confidence,
                reason: result.reason,
                timestamp: timeStr,
                dismissed: false,
              });

              if (!result.suggestExit || result.marketRegime === "UPWARDS") {
                addLogToActive(symbol, `AI now confirms UPWARDS â€” sideways exit cancelled at ${timeStr}`);
                addAiLog(`[ai-guard] ${symbol} returned to UPWARDS during retry, clearing sideways retry`);
                delete pendingSidewaysExits[symbol];
              } else if (retry.retryCount >= 3) {
                if (settings.autoExitEnabled) {
                  completeCycleWithoutExit(
                    symbol,
                    String(lastCandleCloseMap[symbol] ?? ""),
                    `AI Guard auto-exit: Sideways persisted for 30s (${result.reason}, ${result.confidence}%) at ${timeStr}`
                  );
                  updateLastSellCandleTime(symbol, lastAiCandleTime[symbol] || "");
                  addAiLog(`[ai-guard] Auto-exit executed for ${symbol} after 30s sideways persistence`);
                }
                delete pendingSidewaysExits[symbol];
              } else {
                addLogToActive(symbol, `AI still sideways (${result.reason}, ${result.confidence}%) â€” retry ${retry.retryCount}/3 at ${timeStr}`);
                addAiLog(`[ai-guard] ${symbol} still sideways at retry #${retry.retryCount}`);
              }
            })
            .catch(e => {
              addAiErrorLog(`[ai-guard] Sideways retry error for ${symbol}: ${String(e)}`);
            });
        }
      }
    }

    // 4. Auto Trigger check — auto-activate waiting trades based on time and/or price
    // Uses server system time (IST) and live LTP from API
    // Batch-fetches all LTPs upfront to avoid per-trade sequential fetches causing tick overlap
    const sysNowTrigger = new Date();
    const sysH = sysNowTrigger.getHours();
    const sysM = sysNowTrigger.getMinutes();
    const sysS = sysNowTrigger.getSeconds();
    const sysTotalSecs = sysH * 3600 + sysM * 60 + sysS;
    const sysTimeStr = `${String(sysH).padStart(2, "0")}:${String(sysM).padStart(2, "0")}:${String(sysS).padStart(2, "0")}`;

    // Collect trigger-eligible trades (snapshot to avoid mutation issues)
    const triggerCandidates = [...waitingTrades].filter(trade => {
      if (!trade.triggerTimerEnabled) return false;
      if (triggerTimerFired.has(trade.symbol)) return false;
      const timeEnabled = trade.triggerTimeEnabled !== false;
      const priceEnabled = trade.triggerPriceEnabled !== false;
      if (!timeEnabled && !priceEnabled) return false;
      return true;
    });

    // Batch-fetch LTP for all trigger candidates in a single API call
    const triggerLtpMap: Record<string, number> = {};
    if (triggerCandidates.length > 0) {
      try {
        const triggerSymbols = triggerCandidates.map(t => t.symbol).join(",");
        const res = await fetch(`${API_URL}/prices?symbols=${triggerSymbols}`);
        const prices = await res.json();
        if (Array.isArray(prices)) {
          for (const p of prices) {
            if (p?.symbol && p?.ltp != null) triggerLtpMap[p.symbol] = Number(p.ltp);
          }
        }
      } catch {
        console.log(`[auto-trigger] Batch LTP fetch failed, skipping trigger check this tick`);
      }
    }

    for (const trade of triggerCandidates) {
      if (triggerTimerFired.has(trade.symbol)) continue; // Re-check after batch processing

      const timeEnabled = trade.triggerTimeEnabled !== false;
      const priceEnabled = trade.triggerPriceEnabled !== false;

      // 1. Time Check
      let timeMatched = true;
      if (timeEnabled) {
        const targetH = trade.triggerHours ?? 0;
        const targetM = trade.triggerMinutes ?? 0;
        const targetS = trade.triggerSeconds ?? 0;
        const targetTotalSecs = targetH * 3600 + targetM * 60 + targetS;
        
        // Match if current time is within [target, target + 60] seconds
        timeMatched = (sysTotalSecs >= targetTotalSecs && sysTotalSecs <= targetTotalSecs + 60);
      }

      if (!timeMatched) continue;

      // 2. Price Check — use pre-fetched LTP
      let priceMatched = true;
      const currentLtp = triggerLtpMap[trade.symbol] ?? NaN;

      if (priceEnabled) {
        const minP = trade.triggerMinPrice ?? 0;
        const maxP = trade.triggerMaxPrice ?? Infinity;

        if (!Number.isFinite(currentLtp)) {
          console.log(`[auto-trigger] ${trade.symbol}: no valid LTP, skipping`);
          continue;
        }

        priceMatched = (currentLtp >= minP && currentLtp <= maxP);
      }

      // If price is enabled but not matched, we just skip this tick (wait for price to enter range)
      // EXCEPT if Time is also enabled and matched - if time matched but price didn't, we mark as fired (missed window)
      if (priceEnabled && !priceMatched) {
        if (timeEnabled) {
          // Time matched but price didn't - window will eventually pass
          // If we're at the very end of the 60s window, we can mark as fired to stop trying
          if (sysTotalSecs > (trade.triggerHours ?? 0) * 3600 + (trade.triggerMinutes ?? 0) * 60 + (trade.triggerSeconds ?? 0) + 55) {
             console.log(`[auto-trigger] ${trade.symbol}: Time window closing, price never hit range. Marking as fired.`);
             addLogToWaiting(trade.symbol, `Auto Trigger: Time window passed, price ${currentLtp} never entered range.`);
             triggerTimerFired.add(trade.symbol);
          }
        }
        continue;
      }

      // Both conditions (that are enabled) are met!
      const ltpStr = Number.isFinite(currentLtp) ? String(currentLtp) : "0";
      const reasonParts = [];
      if (timeEnabled) reasonParts.push(`Time ${sysTimeStr}`);
      if (priceEnabled) reasonParts.push(`Price ₹${currentLtp}`);
      const reason = reasonParts.join(" & ");

      console.log(`[auto-trigger] ${trade.symbol}: ${reason} met, activating!`);
      addLogToWaiting(trade.symbol, `Auto Trigger fired (${reason})`);
      activateWaitingTrade(trade.symbol, ltpStr, `Auto Trigger BUY at ₹${ltpStr} (${reason})`);
      triggerTimerFired.add(trade.symbol);
    }

  } catch (e) {

    console.error("[trade-engine] tick error:", e);

  } finally {
    tickInProgress = false;
  }

  persistState();

}



// â”€â”€â”€ Public API â”€â”€â”€



export function getEngineState() {

  return {

    waitingTrades,

    activeTrades,

    tradeHistory,

    lastStrategyCandleTime,

    engineRunning,

    symbolsWithFirstSignal: [...symbolsWithFirstSignal],

    symbolHistoryStatus,

    historyFetchLogs: [...historyFetchLogs],

    aiSuggestions: [...aiSuggestions],

    aiGuardActive: isAiGuardActive(),

    aiSymbolEnabled: { ...aiSymbolEnabled },

    aiRegime: Object.fromEntries(
      Object.entries(lastAiResult).map(([k, v]) => [k, { regime: v.marketRegime, confidence: v.confidence }])
    ),

    pendingBuyBuffer: Object.fromEntries(
      Object.entries(pendingBuyBuffer).map(([k, v]) => [k, {
        signalType: v.signalType,
        candlesElapsed: v.candlesElapsed,
        maxCandles: AI_BUFFER_MAX_CANDLES,
      }])
    ),

  };

}



// Force a symbol into the initialized set â€” user accepts running without full history
export function forceInitSymbol(symbol: string) {
  symbolsWithFirstSignal.add(symbol);
}

// Retry history fetch for a symbol that was force-initialized without history
export function retryHistoryFetch(symbol: string) {
  if (!waitingTrades.some((t) => t.symbol === symbol)) {
    pushHistoryLog(`Retry ignored for ${symbol} — not in waiting trades`);
    return;
  }
  pushHistoryLog(`Retry triggered for ${symbol} — setting status to loading, starting poll...`);
  symbolHistoryStatus[symbol] = { status: "loading", candleCount: 0 };
  checkSymbolHistoryStatus(symbol);
}

// Dismiss AI suggestion for a symbol (user clicks Dismiss)
export function dismissAiSuggestion(symbol: string) {
  for (let i = aiSuggestions.length - 1; i >= 0; i--) {
    if (aiSuggestions[i].symbol === symbol && !aiSuggestions[i].dismissed) {
      aiSuggestions[i].dismissed = true;
    }
  }
}

export function addWaitingTrade(trade: WaitingTrade) {

  // Don't add duplicate

  if (waitingTrades.some((t) => t.symbol === trade.symbol)) return;

  // Clear stale signal state from any previous trade cycle for this symbol
  delete lastHandledSignalKey[trade.symbol];
  delete lastBuyCandleTime[trade.symbol];
  triggerTimerFired.delete(trade.symbol);

  // Reset first-signal tracking so the loader shows correctly for this (re-)add
  symbolsWithFirstSignal.delete(trade.symbol);

  // Reset history status and kick off one-time check (non-blocking)
  delete symbolHistoryStatus[trade.symbol];
  checkSymbolHistoryStatus(trade.symbol);

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

// Override config of a running (active) trade — only merges safe fields, preserves all runtime state
export function updateActiveTradeConfig(symbol: string, config: Record<string, unknown>) {
  const idx = activeTrades.findIndex((t) => t.symbol === symbol && t.status === "ACTIVE");
  if (idx === -1) return false;

  const SAFE_FIELDS = [
    "stopLossNumberEnabled", "stopLossNumber",
    "targetPointsEnabled", "targetPoints", "targetMode",
    "trailingAfterTarget", "trailingMode",
    "minToHoldEnabled", "minToHold", "minToHoldTrigger", "minToHoldTrailing",
    "maxProfitLossEnabled", "maxProfit", "maxLoss",
    "sellWhenLossCandlesEnabled", "sellWhenLossCandles",
    "reEntryAfterTargetEnabled", "reEntryCandles", "reEntryPoints",
    "reEntryStopLossEnabled", "reEntryStopLoss",
    "reEntryAsTrailingEnabled", "reEntryTrailingPoints",
    "reEntryMinTargetEnabled", "reEntryMinTargetPoints", "reEntryMinTargetTrigger", "reEntryMinTargetTrailing",
    "signalReEntryEnabled",
    "rangeEnabled", "timeFrom", "timeFromAmpm", "timeTo", "timeToAmpm",
    "buyOverride", "waitAfterSellEnabled", "waitAfterSellCandles",
    "triggerTimerEnabled", "triggerTimeEnabled", "triggerPriceEnabled",
    "triggerHours", "triggerMinutes", "triggerSeconds", "triggerMinPrice", "triggerMaxPrice",
  ];

  const safeUpdate: Record<string, unknown> = {};
  for (const key of SAFE_FIELDS) {
    if (key in config) {
      safeUpdate[key] = config[key];
    }
  }

  activeTrades = activeTrades.map((t, i) =>
    i === idx ? { ...t, ...safeUpdate } as ActiveTrade : t
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
        addLogToWaiting(symbol, `BUY skipped â€“ outside time range (${trade.timeFrom} ${trade.timeFromAmpm} â€“ ${trade.timeTo} ${trade.timeToAmpm}) for â‚¹${entryPrice} at ${timeMatch[1]}`);
        persistState();
        return;
      }
    }
  }

  // buyOverride guard
  if (trade.buyOverride != null && trade.buyOverride > 0 && typeof candleSize === "number" && candleSize >= trade.buyOverride) {
    const timeMatch = logLine.match(/at (.+)$/);
    const atTime = timeMatch ? timeMatch[1] : "";
    addLogToWaiting(symbol, `BUY ignored â€“ candle size ${candleSize.toFixed(2)} >= buyOverride ${trade.buyOverride} at ${atTime}`);
    persistState();
    return;
  }

  activateWaitingTrade(symbol, entryPrice, logLine);
  delete pendingBuyBuffer[symbol];
  setPendingSkippedBuy(symbol, false);
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
  const logLine = `FORCE BUY triggered for â‚¹${entryPrice} at ${timeStr}`;

  activateWaitingTrade(symbol, entryPrice, logLine);
  delete pendingBuyBuffer[symbol];
  setPendingSkippedBuy(symbol, false);
  persistState();
}

export async function forceBuyActiveTrade(symbol: string) {
  const trade = activeTrades.find((t) => t.symbol === symbol && t.status === "ACTIVE" && !t.inPosition);
  if (!trade) return;

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

  updateActiveTradeBuy(symbol, entryPrice, logLine);
  delete pendingBuyBuffer[symbol];
  setPendingSkippedBuy(symbol, false);
  persistState();
}

export async function manualEndCycle(symbol: string) {
  const trade = activeTrades.find((t) => t.symbol === symbol && t.status === "ACTIVE" && t.inPosition);
  if (!trade) return;

  let exitPrice = "0";
  try {
    const res = await fetch(`${API_URL}/prices?symbols=${encodeURIComponent(symbol)}`);
    const prices = await res.json();
    if (Array.isArray(prices) && prices.length > 0 && prices[0]?.ltp) {
      exitPrice = String(prices[0].ltp);
    }
  } catch { /* fallback to 0 */ }

  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const timeStr = `${hh}:${mm}:${ss}`;
  const logLine = `MANUAL END CYCLE — SELL for ₹${exitPrice} at ${timeStr}`;

  completeCycleWithoutExit(symbol, exitPrice, logLine);
  persistState();
}

export function cancelWaitingTrade(symbol: string) {

  waitingTrades = waitingTrades.filter((t) => t.symbol !== symbol);

  delete pendingBuyBuffer[symbol];
  delete lastHandledSignalKey[symbol];
  delete lastBuyCandleTime[symbol];

  setAiSymbolEnabled(symbol, false);

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

      ? `SELL manually for â‚¹${exitPrice} at ${lastCandleTime}`

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

  // Clear stale signal state so re-adding the symbol starts fresh
  delete lastHandledSignalKey[symbol];
  delete lastBuyCandleTime[symbol];

  persistState();

  tryRemoveActiveStrategySymbol(symbol);

}



export function removeCompletedTrade(symbol: string) {

  activeTrades = activeTrades.filter((t) => t.symbol !== symbol);

  delete pendingBuyBuffer[symbol];
  delete lastHandledSignalKey[symbol];
  delete lastBuyCandleTime[symbol];

  setAiSymbolEnabled(symbol, false);

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



// â”€â”€â”€ Watchlist (server-persisted) â”€â”€â”€

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
// Skip during `next build` to prevent the build worker from crashing
if (process.env.NEXT_PHASE !== 'phase-production-build') {
  loadState();
  loadAiSettingsFromDisk();
  ensureEngineRunning();
  // On startup, detect which broker is logged in and sync strategy symbols
  detectActiveBroker();
  syncActiveStrategySymbols();
}

