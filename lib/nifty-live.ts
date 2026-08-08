import http from "http";
import crypto from "crypto";
import type { Socket } from "net";

let niftyOpen = 0;
let niftyLtp = 0;

export function getNiftyLive() {
  return { open: niftyOpen, ltp: niftyLtp };
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
        if ((msg.type === "snapshot" || msg.type === "update") && msg.currentCandle) {
          const { open, close } = msg.currentCandle;
          if (typeof open === "number" && typeof close === "number") {
            niftyOpen = open;
            niftyLtp = close;
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
