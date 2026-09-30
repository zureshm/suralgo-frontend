"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Plus, Check, RefreshCw, Loader2, Grid2X2 } from "lucide-react";
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

function isLastThursdayOfMonth(dateStr: string): boolean {
  const parts = dateStr.split("-");
  if (parts.length !== 3) return false;
  const day = parseInt(parts[0], 10);
  const monthStr = parts[1].toUpperCase();
  const year = parseInt(parts[2], 10);
  const MONTH_IDX: Record<string, number> = {
    JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
    JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
  };
  const monthNum = MONTH_IDX[monthStr];
  if (monthNum === undefined) return false;
  const date = new Date(year, monthNum, day);
  if (date.getDay() !== 4) return false;
  const lastDayOfMonth = new Date(year, monthNum + 1, 0).getDate();
  return day + 7 > lastDayOfMonth;
}

function formatExpiryToSymbol(expiryDate: string, strike: number, type: "CE" | "PE", indexType: "NIFTY50" | "SENSEX"): string {
  const parts = expiryDate.split("-");
  if (parts.length !== 3) return "";
  const day = parts[0];
  const month = parts[1].toUpperCase();
  const year = parts[2].slice(-2);
  const prefix = indexType === "SENSEX" ? "SENSEX" : "NIFTY";

  if (indexType === "SENSEX") {
    const MONTH_MAP: Record<string, number> = {
      JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
      JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
    };
    const WEEKLY_CODES: Record<number, string> = {
      1: "1", 2: "2", 3: "3", 4: "4", 5: "5", 6: "6",
      7: "7", 8: "8", 9: "9", 10: "O", 11: "N", 12: "D",
    };
    const monthIdx = MONTH_MAP[month] || 0;
    if (isLastThursdayOfMonth(expiryDate)) {
      return `${prefix}${year}${month}${strike}${type}`;
    }
    const monthCode = WEEKLY_CODES[monthIdx] || "";
    return `${prefix}${year}${monthCode}${day}${strike}${type}`;
  }

  return `${prefix}${day}${month}${year}${strike}${type}`;
}

function formatExpiryLabel(expiryDate: string): string {
  return expiryDate;
}

export default function OptionsDesktop() {
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
    setLoading(true);
    fetchData().finally(() => setLoading(false));
  }, [fetchData, indexType]);

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

  const activeExpiry = data?.expiries?.find((e) => e.label === activeTab) || data?.expiries?.[0];

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ padding: 16, color: "var(--theme-popup-text)" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <Grid2X2 size={24} style={{ color: "var(--theme-popup-border)" }} />
            <h2 className="text-xl font-bold">
              Option Chain
            </h2>
          </div>
          {data && (
            <div className="flex items-center gap-4 mt-1">
              <select
                value={indexType}
                onChange={(e) => setIndexType(e.target.value as "NIFTY50" | "SENSEX")}
                className="text-xs px-2 py-1 rounded"
                style={{
                  background: "var(--theme-popup-field-bg)",
                  color: "var(--theme-popup-text)",
                  border: "1px solid var(--theme-popup-field-border)",
                }}
              >
                <option value="NIFTY50">NIFTY50</option>
                <option value="SENSEX">SENSEX</option>
              </select>
              <span className="text-sm font-mono font-bold" style={{ color: "var(--theme-popup-border)" }}>
                SPOT: {data.underlyingValue.toFixed(2)}
              </span>
            </div>
          )}
        </div>
        <button
          onClick={() => fetchData()}
          className="p-1.5 rounded-full transition hover:opacity-80"
          style={{ background: "var(--theme-popup-border)", color: "#fff" }}
          title="Refresh option chain"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {loading && !data ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <Loader2 size={32} className="animate-spin" style={{ color: "var(--theme-popup-border)" }} />
            <span className="text-sm font-medium" style={{ color: "var(--theme-popup-label)" }}>Loading option chain...</span>
          </div>
        </div>
      ) : error && !data ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-sm font-medium" style={{ color: "var(--theme-status-loss)" }}>
            {error}
          </div>
        </div>
      ) : data && activeExpiry ? (
        <>
          {/* Expiry Tabs */}
          <div className="flex gap-2 mb-4">
            {data.expiries.map((exp) => (
              <button
                key={exp.label}
                onClick={() => setActiveTab(exp.label as "current" | "next")}
                className="px-4 py-2 rounded-lg text-xs font-bold transition"
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

          {/* Table Container */}
          <div ref={scrollRef} className="overflow-y-auto flex-1 border rounded-lg min-h-0" style={{ borderColor: "var(--theme-popup-field-border)", background: "var(--theme-popup-field-bg)", scrollbarWidth: "thin" }}>
            <table className="w-full text-sm border-separate" style={{ borderSpacing: 0 }}>
              <thead className="sticky top-0 z-30" style={{ background: "var(--theme-card-white)" }}>
                <tr>
                  <th className="py-3 px-2 text-center font-bold opacity-40 text-[10px]" style={{ background: "inherit", borderBottom: "2px solid var(--theme-popup-field-border)", color: "var(--theme-popup-label)" }}>ADD</th>
                  <th className="py-3 px-2 text-right font-black tracking-tight" style={{ background: "inherit", borderBottom: "2px solid var(--theme-popup-field-border)", color: "#089981" }}>CE LTP</th>
                  <th className="py-3 px-2 text-center font-black tracking-widest text-[10px]" style={{ background: "var(--theme-popup-field-bg)", borderBottom: "2px solid var(--theme-popup-field-border)", color: "var(--theme-popup-border)" }}>STRIKE</th>
                  <th className="py-3 px-2 text-left font-black tracking-tight" style={{ background: "inherit", borderBottom: "2px solid var(--theme-popup-field-border)", color: "#f23645" }}>PE LTP</th>
                  <th className="py-3 px-2 text-center font-bold opacity-40 text-[10px]" style={{ background: "inherit", borderBottom: "2px solid var(--theme-popup-field-border)", color: "var(--theme-popup-label)" }}>ADD</th>
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
                  const itmBg = "rgba(255, 193, 7, 0.12)";

                  return (
                    <tr
                      key={row.strikePrice}
                      ref={isAtm ? atmRef : undefined}
                      className="hover:bg-black/5 transition-colors"
                      style={{
                        background: isAtm
                          ? "rgba(var(--theme-popup-border-rgb, 50,51,53), 0.2)"
                          : "transparent",
                      }}
                    >
                      {/* Add CE button */}
                      <td className="py-2.5 px-2 text-center" style={{ background: isCeItm ? itmBg : undefined, borderBottom: "1px solid var(--theme-popup-field-border)" }}>
                        <button
                          onClick={() => handleAdd(activeExpiry.expiryDate, row.strikePrice, "CE")}
                          disabled={ceInWatchlist}
                          className="p-1.5 rounded transition inline-flex items-center justify-center"
                          style={{
                            background: ceInWatchlist ? "transparent" : "rgba(8,153,129,0.15)",
                            color: ceInWatchlist ? "var(--theme-status-success)" : "#089981",
                            cursor: ceInWatchlist ? "default" : "pointer",
                          }}
                          title={ceInWatchlist ? "Already in watchlist" : `Add ${ceSymbol}`}
                        >
                          {ceInWatchlist ? <Check size={14} /> : <Plus size={14} />}
                        </button>
                      </td>
                      {/* CE LTP */}
                      <td className="py-2.5 px-2 text-right font-normal" style={{ fontFamily: "'Courier New', Courier, monospace", color: "var(--theme-popup-text)", background: isCeItm ? itmBg : undefined, borderBottom: "1px solid var(--theme-popup-field-border)" }}>
                        {row.CE.ltp.toFixed(2)}
                      </td>
                      {/* Strike */}
                      <td
                        className="py-2.5 px-2 text-center font-normal text-base"
                        style={{
                          fontFamily: "'Courier New', Courier, monospace",
                          background: "rgba(0,0,0,0.05)",
                          color: isAtm ? "var(--theme-popup-border)" : "var(--theme-popup-text)",
                          borderLeft: "1px solid var(--theme-popup-field-border)",
                          borderRight: "1px solid var(--theme-popup-field-border)",
                          borderBottom: "1px solid var(--theme-popup-field-border)",
                        }}
                      >
                        {row.strikePrice}
                      </td>
                      {/* PE LTP */}
                      <td className="py-2.5 px-2 text-left font-normal" style={{ fontFamily: "'Courier New', Courier, monospace", color: "var(--theme-popup-text)", background: isPeItm ? itmBg : undefined, borderBottom: "1px solid var(--theme-popup-field-border)" }}>
                        {row.PE.ltp.toFixed(2)}
                      </td>
                      {/* Add PE button */}
                      <td className="py-2.5 px-2 text-center" style={{ background: isPeItm ? itmBg : undefined, borderBottom: "1px solid var(--theme-popup-field-border)" }}>
                        <button
                          onClick={() => handleAdd(activeExpiry.expiryDate, row.strikePrice, "PE")}
                          disabled={peInWatchlist}
                          className="p-1.5 rounded transition inline-flex items-center justify-center"
                          style={{
                            background: peInWatchlist ? "transparent" : "rgba(242,54,69,0.15)",
                            color: peInWatchlist ? "var(--theme-status-success)" : "#f23645",
                            cursor: peInWatchlist ? "default" : "pointer",
                          }}
                          title={peInWatchlist ? "Already in watchlist" : `Add ${peSymbol}`}
                        >
                          {peInWatchlist ? <Check size={14} /> : <Plus size={14} />}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="mt-4 flex items-center justify-between text-[11px] font-medium" style={{ color: "var(--theme-popup-label)" }}>
            <div>
              {data.timestamp && <>{indexType === "SENSEX" ? "Sensibull" : "NSE"}: {data.timestamp}</>}
            </div>
            <div>
              Cache: {data.cacheAgeSeconds}s &middot; Refresh: {data.refreshIntervalSeconds}s &middot; ATM: {activeExpiry.atmStrike}
            </div>
          </div>
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-sm font-medium" style={{ color: "var(--theme-popup-label)" }}>
            No data available
          </div>
        </div>
      )}
    </div>
  );
}
