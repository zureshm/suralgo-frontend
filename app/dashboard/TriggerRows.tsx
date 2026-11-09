"use client";

import { useState } from "react";
import styles from "./ActiveTrade.module.scss";
import { useWatchlist } from "../store/WatchlistContext";

export function AutoTriggerRow({
  symbol,
  activeLtps,
  inPosition,
  autoTriggerBuyPrice,
  autoTriggerBuyMode,
  labelOnTop,
}: {
  symbol: string;
  activeLtps?: Record<string, number>;
  inPosition?: boolean;
  autoTriggerBuyPrice?: number;
  autoTriggerBuyMode?: "on" | "below";
  labelOnTop?: boolean;
}) {
  const { watchlist } = useWatchlist();
  const watchLtp = watchlist.find((item) => item.symbol === symbol)?.ltp;
  const liveLtp = activeLtps?.[symbol] ?? watchLtp ?? null;

  const serverSet = autoTriggerBuyPrice != null && Number.isFinite(autoTriggerBuyPrice);
  const [isVirgin, setIsVirgin] = useState(!serverSet);
  const [value, setValue] = useState(() => {
    if (serverSet) return String(autoTriggerBuyPrice);
    if (liveLtp != null && Number.isFinite(liveLtp)) return String(liveLtp);
    return "120";
  });
  const [isSet, setIsSet] = useState(serverSet);
  const [mode, setMode] = useState<"on" | "below">(autoTriggerBuyMode === "below" ? "below" : "on");

  // Sync if server state changes (e.g. set/reset on another device, or cleared after trigger firing)
  const [prevServer, setPrevServer] = useState({ price: autoTriggerBuyPrice, mode: autoTriggerBuyMode });
  if (autoTriggerBuyPrice !== prevServer.price || autoTriggerBuyMode !== prevServer.mode) {
    setPrevServer({ price: autoTriggerBuyPrice, mode: autoTriggerBuyMode });
    if (autoTriggerBuyPrice != null && Number.isFinite(autoTriggerBuyPrice)) {
      setValue(String(autoTriggerBuyPrice));
      setIsSet(true);
      setIsVirgin(false);
      setMode(autoTriggerBuyMode === "below" ? "below" : "on");
    } else if (autoTriggerBuyPrice === undefined) {
      setIsSet(false);
    }
  }

  // While virgin, automatically follow the live price from watchlist/activeLtps
  const [prevLiveLtp, setPrevLiveLtp] = useState(liveLtp);
  if (liveLtp !== prevLiveLtp) {
    setPrevLiveLtp(liveLtp);
    if (isVirgin && liveLtp != null && Number.isFinite(liveLtp)) {
      setValue(String(liveLtp));
    }
  }

  const disabled = inPosition === true;

  const handleSelectAll = (e: React.SyntheticEvent<HTMLInputElement>) => {
    if (disabled) return;
    setIsVirgin(false);
    (e.target as HTMLInputElement).select();
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: labelOnTop ? 4 : 10, minHeight: 30, flexDirection: labelOnTop ? "column" : "row" }}>
      <span className="text-xs" style={{ color: "var(--theme-text-gray-500)", whiteSpace: "nowrap", fontWeight: 500, opacity: disabled ? 0.5 : 1 }}>Set Auto Trigger Buy</span>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ display: "inline-flex", borderRadius: 6, overflow: "hidden", border: "2px solid #6366f1", opacity: disabled ? 0.45 : 1, flexShrink: 0 }}>
        {(["on", "below"] as const).map((m) => (
          <button
            key={m}
            type="button"
            disabled={disabled}
            title={m === "on" ? "Buy when price rises to the set price" : "Buy when price drops to the set price"}
            style={{
              height: 28,
              padding: "0 9px",
              fontSize: 11,
              fontWeight: 700,
              border: "none",
              cursor: disabled ? "not-allowed" : "pointer",
              background: mode === m ? "#6366f1" : "var(--theme-card-white)",
              color: mode === m ? "#ffffff" : "inherit",
              transition: "all 0.15s ease",
            }}
            onClick={() => {
              if (disabled) return;
              setMode(m);
              setIsVirgin(false);
              setIsSet(false);
            }}
          >
            {m === "on" ? "On" : "Below"}
          </button>
        ))}
      </div>
      <input
        type="text"
        inputMode="decimal"
        pattern="[0-9.]*"
        disabled={disabled}
        value={value}
        onFocus={handleSelectAll}
        onClick={handleSelectAll}
        onChange={(e) => {
          if (disabled) return;
          let cleaned = e.target.value.replace(/[^\d.]/g, "");
          cleaned = cleaned.replace(/(\..*)\./g, "$1");
          setValue(cleaned);
          setIsVirgin(false);
          setIsSet(false);
        }}
        onBlur={() => {
          if (!value) {
            setValue(liveLtp != null && Number.isFinite(liveLtp) ? String(liveLtp) : "120");
          }
        }}
        style={{
          width: 74,
          height: 32,
          padding: "0 6px",
          textAlign: "center",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 14,
          fontWeight: 700,
          letterSpacing: "0.5px",
          borderRadius: 6,
          border: "2px solid #6366f1",
          background: "var(--theme-card-white)",
          color: "inherit",
          outline: "none",
          opacity: disabled ? 0.45 : 1,
          cursor: disabled ? "not-allowed" : "text",
        }}
      />
      <button
        type="button"
        disabled={disabled}
        style={{
          minWidth: labelOnTop ? 38 : 78,
          height: 32,
          padding: labelOnTop ? "0" : "0 8px 0 10px",
          fontSize: 12,
          fontWeight: 700,
          borderRadius: 6,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: labelOnTop ? "center" : "space-between",
          gap: 6,
          cursor: disabled ? "not-allowed" : "pointer",
          pointerEvents: disabled ? "none" : "auto",
          opacity: disabled ? 0.45 : 1,
          background: isSet ? "#e2e8f0" : "var(--theme-btn-dark, #1e293b)",
          color: isSet ? "#0f172a" : "#ffffff",
          border: isSet ? "1px solid #cbd5e1" : "1px solid rgba(99, 102, 241, 0.45)",
          boxShadow: isSet ? "0 1px 3px rgba(0, 0, 0, 0.12)" : "0 1px 3px rgba(0, 0, 0, 0.25)",
          transition: "all 0.2s ease",
        }}
        onClick={() => {
          if (disabled) return;
          setIsVirgin(false);
          setIsSet(true);
          fetch(`/next-api/trades/${encodeURIComponent(symbol)}/auto-trigger-buy`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ triggerPrice: Number(value || "0"), mode }),
          }).catch(() => {});
        }}
      >
        {!labelOnTop && <span style={{ color: isSet ? "#0f172a" : "#ffffff", fontWeight: 700 }}>SET</span>}
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, transition: "all 0.2s ease" }}>
          <circle cx="8" cy="8" r="7" fill={isSet ? "#16a34a" : "rgba(255, 255, 255, 0.2)"} />
          <path d="M4.8 8.2L6.8 10.2L11.2 5.8" stroke={isSet ? "#ffffff" : "rgba(255, 255, 255, 0.75)"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        className={`${styles.waitingBtn} ${styles.danger}`}
        type="button"
        disabled={disabled}
        style={{
          minWidth: labelOnTop ? 38 : 78,
          height: 32,
          padding: labelOnTop ? "0" : "0 10px",
          fontSize: 12,
          fontWeight: 600,
          justifyContent: "center",
          gap: 6,
          cursor: disabled ? "not-allowed" : "pointer",
          pointerEvents: disabled ? "none" : "auto",
          opacity: disabled ? 0.45 : 1,
        }}
        onClick={() => {
          if (disabled) return;
          setIsSet(false);
          setIsVirgin(true);
          if (liveLtp != null && Number.isFinite(liveLtp)) {
            setValue(String(liveLtp));
          } else {
            setValue("120");
          }
          fetch(`/next-api/trades/${encodeURIComponent(symbol)}/auto-trigger-buy/reset`, { method: "POST" }).catch(() => {});
        }}
      >
        {!labelOnTop && <span>Reset</span>}
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
          <polyline points="15.3 2.7 15.3 6.7 11.3 6.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M13.66 10a6 6 0 1 1-1.41-6.24L15.3 6.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      </div>
    </div>
  );
}

export function AutoExecuteExitRow({
  symbol,
  activeLtps,
  inPosition,
  autoExecuteExitPrice,
  labelOnTop,
}: {
  symbol: string;
  activeLtps?: Record<string, number>;
  inPosition?: boolean;
  autoExecuteExitPrice?: number;
  labelOnTop?: boolean;
}) {
  const { watchlist } = useWatchlist();
  const watchLtp = watchlist.find((item) => item.symbol === symbol)?.ltp;
  const liveLtp = activeLtps?.[symbol] ?? watchLtp ?? null;

  const serverSet = autoExecuteExitPrice != null && Number.isFinite(autoExecuteExitPrice);
  const [isVirgin, setIsVirgin] = useState(!serverSet);
  const [value, setValue] = useState(() => {
    if (serverSet) return String(autoExecuteExitPrice);
    if (liveLtp != null && Number.isFinite(liveLtp)) return String(liveLtp);
    return "120";
  });
  const [isSet, setIsSet] = useState(serverSet);

  // Sync if server state changes (e.g. set/reset on another device, or cleared after trigger firing)
  const [prevExitPrice, setPrevExitPrice] = useState(autoExecuteExitPrice);
  if (autoExecuteExitPrice !== prevExitPrice) {
    setPrevExitPrice(autoExecuteExitPrice);
    if (autoExecuteExitPrice != null && Number.isFinite(autoExecuteExitPrice)) {
      setValue(String(autoExecuteExitPrice));
      setIsSet(true);
      setIsVirgin(false);
    } else if (autoExecuteExitPrice === undefined) {
      setIsSet(false);
    }
  }

  // While virgin, automatically follow the live price from watchlist/activeLtps
  const [prevLiveLtp, setPrevLiveLtp] = useState(liveLtp);
  if (liveLtp !== prevLiveLtp) {
    setPrevLiveLtp(liveLtp);
    if (isVirgin && liveLtp != null && Number.isFinite(liveLtp)) {
      setValue(String(liveLtp));
    }
  }

  // Enabled only while the trade is in position — inverse of Auto Trigger Buy
  const disabled = inPosition !== true;

  const handleSelectAll = (e: React.SyntheticEvent<HTMLInputElement>) => {
    if (disabled) return;
    setIsVirgin(false);
    (e.target as HTMLInputElement).select();
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: labelOnTop ? 4 : 10, minHeight: 30, flexDirection: labelOnTop ? "column" : "row" }}>
      <span className="text-xs" style={{ color: "var(--theme-text-gray-500)", whiteSpace: "nowrap", fontWeight: 500, opacity: disabled ? 0.5 : 1 }}>Auto Execute Exit On</span>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <input
        type="text"
        inputMode="decimal"
        pattern="[0-9.]*"
        disabled={disabled}
        value={value}
        onFocus={handleSelectAll}
        onClick={handleSelectAll}
        onChange={(e) => {
          if (disabled) return;
          let cleaned = e.target.value.replace(/[^\d.]/g, "");
          cleaned = cleaned.replace(/(\..*)\./g, "$1");
          setValue(cleaned);
          setIsVirgin(false);
          setIsSet(false);
        }}
        onBlur={() => {
          if (!value) {
            setValue(liveLtp != null && Number.isFinite(liveLtp) ? String(liveLtp) : "120");
          }
        }}
        style={{
          width: 74,
          height: 32,
          padding: "0 6px",
          textAlign: "center",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 14,
          fontWeight: 700,
          letterSpacing: "0.5px",
          borderRadius: 6,
          border: "2px solid #6366f1",
          background: "var(--theme-card-white)",
          color: "inherit",
          outline: "none",
          opacity: disabled ? 0.45 : 1,
          cursor: disabled ? "not-allowed" : "text",
        }}
      />
      <button
        type="button"
        disabled={disabled}
        style={{
          minWidth: labelOnTop ? 38 : 78,
          height: 32,
          padding: labelOnTop ? "0" : "0 8px 0 10px",
          fontSize: 12,
          fontWeight: 700,
          borderRadius: 6,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: labelOnTop ? "center" : "space-between",
          gap: 6,
          cursor: disabled ? "not-allowed" : "pointer",
          pointerEvents: disabled ? "none" : "auto",
          opacity: disabled ? 0.45 : 1,
          background: isSet ? "#e2e8f0" : "var(--theme-btn-dark, #1e293b)",
          color: isSet ? "#0f172a" : "#ffffff",
          border: isSet ? "1px solid #cbd5e1" : "1px solid rgba(99, 102, 241, 0.45)",
          boxShadow: isSet ? "0 1px 3px rgba(0, 0, 0, 0.12)" : "0 1px 3px rgba(0, 0, 0, 0.25)",
          transition: "all 0.2s ease",
        }}
        onClick={() => {
          if (disabled) return;
          setIsVirgin(false);
          setIsSet(true);
          fetch(`/next-api/trades/${encodeURIComponent(symbol)}/auto-execute-exit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ triggerPrice: Number(value || "0") }),
          }).catch(() => {});
        }}
      >
        {!labelOnTop && <span style={{ color: isSet ? "#0f172a" : "#ffffff", fontWeight: 700 }}>SET</span>}
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, transition: "all 0.2s ease" }}>
          <circle cx="8" cy="8" r="7" fill={isSet ? "#16a34a" : "rgba(255, 255, 255, 0.2)"} />
          <path d="M4.8 8.2L6.8 10.2L11.2 5.8" stroke={isSet ? "#ffffff" : "rgba(255, 255, 255, 0.75)"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        className={`${styles.waitingBtn} ${styles.danger}`}
        type="button"
        disabled={disabled}
        style={{
          minWidth: labelOnTop ? 38 : 78,
          height: 32,
          padding: labelOnTop ? "0" : "0 10px",
          fontSize: 12,
          fontWeight: 600,
          justifyContent: "center",
          gap: 6,
          cursor: disabled ? "not-allowed" : "pointer",
          pointerEvents: disabled ? "none" : "auto",
          opacity: disabled ? 0.45 : 1,
        }}
        onClick={() => {
          if (disabled) return;
          setIsSet(false);
          setIsVirgin(true);
          if (liveLtp != null && Number.isFinite(liveLtp)) {
            setValue(String(liveLtp));
          } else {
            setValue("120");
          }
          fetch(`/next-api/trades/${encodeURIComponent(symbol)}/auto-execute-exit/reset`, { method: "POST" }).catch(() => {});
        }}
      >
        {!labelOnTop && <span>Reset</span>}
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
          <polyline points="15.3 2.7 15.3 6.7 11.3 6.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M13.66 10a6 6 0 1 1-1.41-6.24L15.3 6.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      </div>
    </div>
  );
}
