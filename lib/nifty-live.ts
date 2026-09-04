import http from "http";
import crypto from "crypto";
import type { Socket } from "net";

export interface NiftyCandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

let niftyOpen = 0;
let niftyLtp = 0;
let completedCandles: NiftyCandle[] = [];
let currentCandle: NiftyCandle | null = null;

export function getNiftyLive() {
  return { open: niftyOpen, ltp: niftyLtp };
}

function calculateEMA(prices: number[], period: number): number[] {
  if (prices.length < period) return [];
  const ema: number[] = [];
  const multiplier = 2 / (period + 1);

  // First EMA is SMA of first 'period' prices
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += prices[i];
  }
  ema.push(sum / period);

  // Calculate subsequent EMAs
  for (let i = period; i < prices.length; i++) {
    const currentEMA = (prices[i] - ema[ema.length - 1]) * multiplier + ema[ema.length - 1];
    ema.push(currentEMA);
  }

  return ema;
}

export function checkNiftyReEntryFilter(symbol: string): { allowed: boolean; reason?: string } {
  const isCE = symbol.endsWith("CE");
  const isPE = symbol.endsWith("PE");
  if (!isCE && !isPE) return { allowed: true };

  // Combine completed candles + current live candle
  const allCandles: NiftyCandle[] = [...completedCandles];
  if (currentCandle && typeof currentCandle.close === "number" && typeof currentCandle.open === "number") {
    allCandles.push(currentCandle);
  }

  if (allCandles.length === 0) {
    if (niftyOpen > 0 && niftyLtp > 0) {
      if (isCE && niftyLtp <= niftyOpen) return { allowed: false, reason: "NIFTY 50 is RED/FLAT (need GREEN for CE)" };
      if (isPE && niftyLtp >= niftyOpen) return { allowed: false, reason: "NIFTY 50 is GREEN/FLAT (need RED for PE)" };
      return { allowed: true };
    }
    return { allowed: true };
  }

  const liveCandle = allCandles[allCandles.length - 1];

  // Criteria 2: Current candle color
  if (isCE) {
    if (liveCandle.close <= liveCandle.open) {
      return { allowed: false, reason: `NIFTY 50 current candle is RED/FLAT (${liveCandle.close} <= ${liveCandle.open}) — need GREEN for CE` };
    }
  } else if (isPE) {
    if (liveCandle.close >= liveCandle.open) {
      return { allowed: false, reason: `NIFTY 50 current candle is GREEN/FLAT (${liveCandle.close} >= ${liveCandle.open}) — need RED for PE` };
    }
  }

  // If insufficient candle history (< 20 candles) for EMA, allow if color matched
  if (allCandles.length < 20) {
    return { allowed: true };
  }

  const closePrices = allCandles.map((c) => c.close);
  const ema10Values = calculateEMA(closePrices, 10);
  const ema20Values = calculateEMA(closePrices, 20);

  if (ema10Values.length === 0 || ema20Values.length === 0) {
    return { allowed: true };
  }

  // EMA10 and EMA20 at the latest candle
  const latestEMA10 = ema10Values[ema10Values.length - 1];
  const latestEMA20 = ema20Values[ema20Values.length - 1];

  // Criteria 1: EMA trend
  if (isCE) {
    if (latestEMA10 <= latestEMA20) {
      return {
        allowed: false,
        reason: `NIFTY 50 EMA10 (${latestEMA10.toFixed(2)}) <= EMA20 (${latestEMA20.toFixed(2)}) — need EMA10 > EMA20 for CE uptrend`,
      };
    }
  } else if (isPE) {
    if (latestEMA10 >= latestEMA20) {
      return {
        allowed: false,
        reason: `NIFTY 50 EMA10 (${latestEMA10.toFixed(2)}) >= EMA20 (${latestEMA20.toFixed(2)}) — need EMA10 < EMA20 for PE downtrend`,
      };
    }
  }

  // Criteria 3: Check last 6 candles (current candle + 5 previous candles) for EMA20 touch
  // ema20Values has length = allCandles.length - 20 + 1 (starts at index 19 of allCandles)
  // For any candle index i (from allCandles.length - 6 to allCandles.length - 1),
  // its corresponding EMA20 index is i - (20 - 1) = i - 19.
  const requiredCandles = Math.min(6, allCandles.length);
  const startIndex = allCandles.length - requiredCandles;

  for (let i = startIndex; i < allCandles.length; i++) {
    const ema20Idx = i - 19;
    if (ema20Idx < 0 || ema20Idx >= ema20Values.length) continue;
    const ema20Val = ema20Values[ema20Idx];
    const candle = allCandles[i];
    const candleLabel = i === allCandles.length - 1 ? "current candle" : `candle -${allCandles.length - 1 - i}`;

    if (isCE) {
      // For CE uptrend, low must be strictly above EMA20 (no wick or body touching)
      if (candle.low <= ema20Val) {
        return {
          allowed: false,
          reason: `NIFTY 50 ${candleLabel} low (${candle.low.toFixed(2)}) touches/below EMA20 (${ema20Val.toFixed(2)})`,
        };
      }
    } else if (isPE) {
      // For PE downtrend, high must be strictly below EMA20 (no wick or body touching)
      if (candle.high >= ema20Val) {
        return {
          allowed: false,
          reason: `NIFTY 50 ${candleLabel} high (${candle.high.toFixed(2)}) touches/above EMA20 (${ema20Val.toFixed(2)})`,
        };
      }
    }
  }

  return { allowed: true };
}

// ─── Server-side WebSocket client to ws://localhost:2000/ws/nifty50 ───
// Uses Node built-in http + crypto only (no ws package).
// Parses RFC 6455 frames to receive Nifty 50 live candle data.

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:2000";
const NIFTY50_WS_URL = new URL(API_BASE_URL.replace(/^http/, "ws") + "/ws/nifty50");

let wsSocket: Socket | null = null;
let wsReq: http.ClientRequest | null = null;
let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let wsBuffer = Buffer.alloc(0);
const wsDisposed = false;

function connectNiftyWs() {
  if (wsDisposed) return;

  const key = crypto.randomBytes(16).toString("base64");

  const options: http.RequestOptions = {
    hostname: NIFTY50_WS_URL.hostname,
    port: NIFTY50_WS_URL.port || "80",
    path: NIFTY50_WS_URL.pathname,
    method: "GET",
    headers: {
      Connection: "Upgrade",
      Upgrade: "websocket",
      "Sec-WebSocket-Key": key,
      "Sec-WebSocket-Version": "13",
    },
  };

  wsReq = http.request(options, (res) => {
    // If we get a normal HTTP response (not upgrade), reconnect
    res.resume();
    scheduleReconnect();
  });

  wsReq.on("upgrade", (res, socket, head) => {
    wsSocket = socket;
    wsBuffer = Buffer.alloc(0);
    if (head && head.length > 0) {
      wsBuffer = Buffer.from(head);
    }

    socket.on("data", (chunk: Buffer) => {
      wsBuffer = Buffer.concat([wsBuffer, chunk]);
      processWsFrames();
    });

    socket.on("close", () => {
      wsSocket = null;
      scheduleReconnect();
    });

    socket.on("error", () => {
      wsSocket = null;
      scheduleReconnect();
    });
  });

  wsReq.on("error", () => {
    scheduleReconnect();
  });

  wsReq.end();
}

function scheduleReconnect() {
  if (wsDisposed) return;
  if (wsReconnectTimer) return;
  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null;
    connectNiftyWs();
  }, 3000);
}

// Parse complete WebSocket frames from the buffer
function processWsFrames() {
  while (wsBuffer.length >= 2) {
    const firstByte = wsBuffer[0];
    const secondByte = wsBuffer[1];

    const fin = (firstByte & 0x80) !== 0;
    const opcode = firstByte & 0x0f;
    const masked = (secondByte & 0x80) !== 0;
    let payloadLen = secondByte & 0x7f;
    let offset = 2;

    if (payloadLen === 126) {
      if (wsBuffer.length < 4) return;
      payloadLen = wsBuffer.readUInt16BE(2);
      offset = 4;
    } else if (payloadLen === 127) {
      if (wsBuffer.length < 10) return;
      // Read as BigInt then convert (safe for our message sizes)
      const high = wsBuffer.readUInt32BE(2);
      const low = wsBuffer.readUInt32BE(6);
      payloadLen = high * 0x100000000 + low;
      offset = 10;
    }

    let maskKey: Buffer | null = null;
    if (masked) {
      if (wsBuffer.length < offset + 4) return;
      maskKey = wsBuffer.subarray(offset, offset + 4);
      offset += 4;
    }

    if (wsBuffer.length < offset + payloadLen) return;

    let payload = wsBuffer.subarray(offset, offset + payloadLen);
    if (masked && maskKey) {
      const unmasked = Buffer.alloc(payloadLen);
      for (let i = 0; i < payloadLen; i++) {
        unmasked[i] = payload[i] ^ maskKey[i % 4];
      }
      payload = unmasked;
    }

    // Consume this frame from the buffer
    wsBuffer = wsBuffer.subarray(offset + payloadLen);

    if (opcode === 0x1 && fin) {
      // Text frame — parse JSON
      try {
        const msg = JSON.parse(payload.toString("utf8"));
        if (msg.type === "snapshot" || msg.type === "update") {
          if (Array.isArray(msg.completedCandles)) {
            completedCandles = msg.completedCandles;
          }
          if (msg.currentCandle) {
            currentCandle = msg.currentCandle;
            const { open, close } = msg.currentCandle;
            if (typeof open === "number" && typeof close === "number") {
              niftyOpen = open;
              niftyLtp = close;
            }
          }
        }
      } catch {}
    } else if (opcode === 0x8) {
      // Close frame — reconnect
      try {
        wsSocket?.destroy();
      } catch {}
      wsSocket = null;
      scheduleReconnect();
      return;
    } else if (opcode === 0x9) {
      // Ping — send Pong with same payload
      if (wsSocket) {
        const pongFrame = Buffer.alloc(2 + (masked ? 4 : 0) + payload.length);
        pongFrame[0] = 0x8a; // FIN + pong
        if (!masked) {
          pongFrame[1] = payload.length;
          payload.copy(pongFrame, 2);
        }
        wsSocket.write(pongFrame);
      }
    }
  }
}

// Auto-start on module import (server-side only)
if (typeof window === "undefined") {
  connectNiftyWs();
}
