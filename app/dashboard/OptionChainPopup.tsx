"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { X, Grid2X2, Plus, Check } from "lucide-react";
import { useWatchlist } from "../store/WatchlistContext";

const OPTION_CHAIN_URL = process.env.NEXT_PUBLIC_OPTION_CHAIN_URL || "http://localhost:8080/api/option-chain";

type OptionSide = {
  oi: number;
  changeOi: number;
  iv: number;
  ltp: number;
  volume: number;
  change: number;
};

type ChainRow = {
  strikePrice: number;
  moneyness: string;
  CE: OptionSide;
  PE: OptionSide;
};

type ExpiryData = {
  label: string;
  expiryDate: string;
  atmStrike: number;
  rows: ChainRow[];
};

type OptionChainResponse = {
  underlyingValue: number;
  timestamp: string | null;
  expiries: ExpiryData[];
  cacheAgeSeconds: number;
  refreshIntervalSeconds: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
};

function formatExpiryToSymbol(expiryDate: string, strike: number, type: "CE" | "PE", indexType: "NIFTY50" | "SENSEX"): string {
  // expiryDate comes as "23-Jun-2026" → convert to "NIFTY23JUN2624000CE" or "SENSEX23JUN2624000CE"
  const parts = expiryDate.split("-");
  if (parts.length !== 3) return "";
  const day = parts[0];
  const month = parts[1].toUpperCase();
  const year = parts[2].slice(-2);
  const prefix = indexType === "SENSEX" ? "SENSEX" : "NIFTY";
  return `${prefix}${day}${month}${year}${strike}${type}`;
}

function formatExpiryLabel(expiryDate: string): string {
  // "23-Jun-2026" → "23-Jun-2026"
  return expiryDate;
}

export default function OptionChainPopup({ open, onClose }: Props) {
  const [data, setData] = useState<OptionChainResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"current" | "next">("current");
  const [indexType, setIndexType] = useState<"NIFTY50" | "SENSEX">("NIFTY50");
  const { watchlist, addToWatchlist } = useWatchlist();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const atmRef = useRef<HTMLTableRowElement | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const indexParam = indexType === "SENSEX" ? "SENSEX" : "NIFTY";
      const res = await fetch(`${OPTION_CHAIN_URL}?index=${indexParam}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to fetch";
      setError(msg);
    }
  }, [indexType]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchData().finally(() => setLoading(false));

    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [open, fetchData, indexType]);

  // Scroll to ATM row when data loads or tab changes
  useEffect(() => {
    if (!data) return;
    setTimeout(() => {
      if (atmRef.current) {
        atmRef.current.scrollIntoView({ block: "center" });
      }
    }, 50);
  }, [data, activeTab]);

  const isInWatchlist = (symbol: string) => {
    return watchlist.some((item) => item.symbol === symbol);
  };

  const handleAdd = (expiryDate: string, strike: number, type: "CE" | "PE") => {
    const symbol = formatExpiryToSymbol(expiryDate, strike, type, indexType);
    if (!symbol || isInWatchlist(symbol)) return;
    addToWatchlist({ symbol, ltp: null });
  };

  if (!open) return null;

  const activeExpiry = data?.expiries?.find((e) => e.label === activeTab) || data?.expiries?.[0];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "var(--theme-popup-backdrop)" }}
      onClick={onClose}
    >
      <div
        className="relative w-[420px] rounded-2xl p-5 max-h-[85vh] overflow-hidden flex flex-col"
        style={{
          background: "var(--theme-popup-bg)",
          color: "var(--theme-popup-text)",
          border: "3px solid var(--theme-popup-border)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          maxWidth: "95%",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <Grid2X2 size={20} style={{ color: "var(--theme-popup-border)" }} />
              <h2 className="text-lg font-bold" style={{ color: "var(--theme-popup-text)" }}>
                Option Chain
              </h2>
            </div>
            {data && (
              <div className="flex items-center gap-2 mt-1">
                <select
                  value={indexType}
                  onChange={(e) => setIndexType(e.target.value as "NIFTY50" | "SENSEX")}
                  className="text-xs px-2 py-0.5 rounded"
                  style={{
                    background: "var(--theme-popup-field-bg)",
                    color: "var(--theme-popup-text)",
                    border: "1px solid var(--theme-popup-field-border)",
                  }}
                >
                  <option value="NIFTY50">NIFTY50</option>
                  <option value="SENSEX">SENSEX</option>
                </select>
                <span className="text-xs font-mono" style={{ color: "var(--theme-popup-label)" }}>
                  SPOT: {data.underlyingValue.toFixed(2)}
                </span>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full transition"
            style={{ background: "var(--theme-popup-border)", color: "#fff" }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {loading && !data ? (
          <div className="text-sm py-8 text-center" style={{ color: "var(--theme-popup-label)" }}>
            Loading option chain...
          </div>
        ) : error && !data ? (
          <div className="text-sm py-8 text-center" style={{ color: "var(--theme-status-loss)" }}>
            {error}
          </div>
        ) : data && activeExpiry ? (
          <>
            {/* Expiry Tabs */}
            <div className="flex gap-2 mb-3">
              {data.expiries.map((exp) => (
                <button
                  key={exp.label}
                  onClick={() => setActiveTab(exp.label as "current" | "next")}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold transition"
                  style={{
                    background:
                      activeTab === exp.label
                        ? "var(--theme-popup-border)"
                        : "var(--theme-popup-field-bg)",
                    color: activeTab === exp.label ? "#fff" : "var(--theme-popup-text)",
                    border: `1px solid ${
                      activeTab === exp.label
                        ? "var(--theme-popup-border)"
                        : "var(--theme-popup-field-border)"
                    }`,
                  }}
                >
                  {exp.label === "current" ? "Current Week" : "Next Week"} &middot;{" "}
                  {formatExpiryLabel(exp.expiryDate)}
                </button>
              ))}
            </div>

            {/* Table */}
            <div ref={scrollRef} className="overflow-y-auto flex-1" style={{ maxHeight: "55vh" }}>
              <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr
                    style={{
                      borderBottom: "1px solid var(--theme-popup-field-border)",
                      position: "sticky",
                      top: 0,
                      background: "var(--theme-popup-bg)",
                      zIndex: 1,
                    }}
                  >
                    <th className="py-2 px-1 text-left font-semibold" style={{ color: "var(--theme-popup-label)" }}>
                      +
                    </th>
                    <th className="py-2 px-1 text-right font-semibold" style={{ color: "#0a8a43" }}>
                      CE LTP
                    </th>
                    <th className="py-2 px-1 text-center font-semibold" style={{ color: "var(--theme-popup-border)" }}>
                      STRIKE
                    </th>
                    <th className="py-2 px-1 text-left font-semibold" style={{ color: "#d12b2b" }}>
                      PE LTP
                    </th>
                    <th className="py-2 px-1 text-right font-semibold" style={{ color: "var(--theme-popup-label)" }}>
                      +
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {activeExpiry.rows.map((row) => {
                    const isAtm = row.strikePrice === activeExpiry.atmStrike;
                    const ceSymbol = formatExpiryToSymbol(activeExpiry.expiryDate, row.strikePrice, "CE", indexType);
                    const peSymbol = formatExpiryToSymbol(activeExpiry.expiryDate, row.strikePrice, "PE", indexType);
                    const ceInWatchlist = isInWatchlist(ceSymbol);
                    const peInWatchlist = isInWatchlist(peSymbol);

                    const isCeItm = row.moneyness === "ITM_CE";
                    const isPeItm = row.moneyness === "OTM_CE";
                    const itmBg = "rgba(255, 193, 7, 0.10)";

                    return (
                      <tr
                        key={row.strikePrice}
                        ref={isAtm ? atmRef : undefined}
                        style={{
                          borderBottom: "1px solid var(--theme-popup-field-border)",
                          background: isAtm
                            ? "rgba(var(--theme-popup-border-rgb, 50,51,53), 0.15)"
                            : "transparent",
                        }}
                      >
                        {/* Add CE button */}
                        <td className="py-1.5 px-1 text-center" style={{ background: isCeItm ? itmBg : undefined }}>
                          <button
                            onClick={() => handleAdd(activeExpiry.expiryDate, row.strikePrice, "CE")}
                            disabled={ceInWatchlist}
                            className="p-1 rounded transition"
                            style={{
                              background: ceInWatchlist ? "transparent" : "rgba(10,138,67,0.15)",
                              color: ceInWatchlist ? "var(--theme-popup-label)" : "#0a8a43",
                              cursor: ceInWatchlist ? "default" : "pointer",
                            }}
                            title={ceInWatchlist ? "Already in watchlist" : `Add ${ceSymbol}`}
                          >
                            {ceInWatchlist ? <Check size={12} /> : <Plus size={12} />}
                          </button>
                        </td>
                        {/* CE LTP */}
                        <td className="py-1.5 px-1 text-right font-mono" style={{ color: "var(--theme-popup-text)", background: isCeItm ? itmBg : undefined }}>
                          {row.CE.ltp.toFixed(2)}
                        </td>
                        {/* Strike */}
                        <td
                          className="py-1.5 px-1 text-center font-bold"
                          style={{
                            color: isAtm ? "var(--theme-popup-border)" : "var(--theme-popup-text)",
                          }}
                        >
                          {row.strikePrice}
                        </td>
                        {/* PE LTP */}
                        <td className="py-1.5 px-1 text-left font-mono" style={{ color: "var(--theme-popup-text)", background: isPeItm ? itmBg : undefined }}>
                          {row.PE.ltp.toFixed(2)}
                        </td>
                        {/* Add PE button */}
                        <td className="py-1.5 px-1 text-center" style={{ background: isPeItm ? itmBg : undefined }}>
                          <button
                            onClick={() => handleAdd(activeExpiry.expiryDate, row.strikePrice, "PE")}
                            disabled={peInWatchlist}
                            className="p-1 rounded transition"
                            style={{
                              background: peInWatchlist ? "transparent" : "rgba(209,43,43,0.15)",
                              color: peInWatchlist ? "var(--theme-popup-label)" : "#d12b2b",
                              cursor: peInWatchlist ? "default" : "pointer",
                            }}
                            title={peInWatchlist ? "Already in watchlist" : `Add ${peSymbol}`}
                          >
                            {peInWatchlist ? <Check size={12} /> : <Plus size={12} />}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Footer */}
            <div className="mt-3 text-[10px] text-center" style={{ color: "var(--theme-popup-label)" }}>
              {data.timestamp && <>{indexType === "SENSEX" ? "Sensibull" : "NSE"}: {data.timestamp} &middot; </>}
              Cache age: {data.cacheAgeSeconds}s &middot; Refresh: {data.refreshIntervalSeconds}s
              {activeExpiry && <> &middot; ATM: {activeExpiry.atmStrike}</>}
            </div>
          </>
        ) : (
          <div className="text-sm py-8 text-center" style={{ color: "var(--theme-popup-label)" }}>
            No data available
          </div>
        )}
      </div>
    </div>
  );
}
