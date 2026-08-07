"use client";

import { useEffect, useState } from "react";
import { searchSymbols, getMarketTime, setWatchlistSymbols } from "@/lib/api";
import { useRouter } from "next/navigation";
import { useTradeStore } from "../store/TradeStore";
import { useWatchlist, WatchlistItem } from "../store/WatchlistContext";
import { getPrices } from "@/lib/getPrices";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ListPlus, Trash2, Lock } from "lucide-react";
import styles from "./Watchlist.module.scss";

export default function Watchlist() {
  const [searchText, setSearchText] = useState("");
  const [suggestions, setSuggestions] = useState<WatchlistItem[]>([]);
  // Store live market time from backend
  const [marketTime, setMarketTime] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  const router = useRouter();

  const {
    setSelection,
    waitingTrades,
    activeTrades,
    getLastStrategyCandleTime,
  } = useTradeStore();

  const {
    watchlist,
    addToWatchlist,
    removeFromWatchlist,
    updateWatchlistPrices,
  } = useWatchlist();

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  // Poll live market time from backend
  useEffect(() => {
    const fetchMarketTime = async () => {
      try {
        const data = await getMarketTime();
        setMarketTime(data.marketTime || null);
      } catch {
        setMarketTime(null);
      }
    };

    fetchMarketTime();

    const interval = setInterval(fetchMarketTime, 1000);

    return () => clearInterval(interval);
  }, []);

  // Sync full watchlist symbols to backend whenever watchlist changes
  // Backend uses this list for multi-symbol LTP subscription
  // Only fire when symbol list actually changes (not on LTP updates)
  const watchlistSymbolsKey = watchlist.map((item) => item.symbol).join(",");
  useEffect(() => {
    const syncWatchlistSymbols = async () => {
      try {
        const symbols = watchlist.map((item) => item.symbol);
        await setWatchlistSymbols(symbols);
      } catch (error) {
        console.error("Failed to sync watchlist symbols");
      }
    };

    syncWatchlistSymbols();
  }, [watchlistSymbolsKey]);

  const activeSlots = waitingTrades.length + activeTrades.filter((t) => t.status === "ACTIVE").length;
  const atMaxCapacity = activeSlots >= 6;

  const watchlistItems = watchlist.map((row) => {
    const isWaiting = waitingTrades.some((t) => t.symbol === row.symbol);
    const isRunning = activeTrades.some((t) => t.symbol === row.symbol);
    const isInTrade = isWaiting || isRunning;
    const isDisabled = !isInTrade && atMaxCapacity;

    const buttonClass = isDisabled && !isInTrade
      ? "cursor-not-allowed"
      : isWaiting
      ? "hover:text-red-700 text-white"
      : isRunning
      ? "hover:text-red-600 text-white"
      : "hover:text-blue-600 text-white";
    const buttonStyle = isDisabled && !isInTrade
      ? { backgroundColor: "#d1d5db", color: "#9ca3af", pointerEvents: "none" as const }
      : isWaiting
      ? { backgroundColor: "var(--theme-tailwind-yellow-500)", color: "var(--theme-tailwind-yellow-text)" }
      : isRunning
      ? { backgroundColor: "var(--theme-tailwind-red-500)", color: "var(--theme-tailwind-red-text)" }
      : { backgroundColor: "var(--theme-tailwind-blue-500)", color: "var(--theme-tailwind-blue-text)" };

    return (
      <div key={row.symbol} className="flex items-center justify-between py-2 border-b last:border-b-0">
        <div className="w-[200px] flex-shrink-0">
          <button
            className={`w-full px-3 py-1 rounded text-sm font-medium truncate text-left flex items-center ${buttonClass}`}
            style={isDisabled ? { ...buttonStyle, pointerEvents: "none", position: "relative" as const } : { ...buttonStyle, position: "relative" as const }}
            type="button"
            onClick={isDisabled ? undefined : () => {
              setSelection({
                symbol: row.symbol,
                price: String(row.ltp ?? ""),
              });
              router.push("/trade");
            }}
          >
            {row.symbol}
            {row.symbol.endsWith("CE") && (
              <span style={{ position: "absolute", right: 2, top: "50%", transform: "translateY(-50%)", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, borderRadius: 3, background: "rgba(0,0,0,0)" }}>
                <svg width="12" height="12" viewBox="0 0 12 12"><polygon points="6,1 11,11 1,11" fill="#fff" /></svg>
              </span>
            )}
            {row.symbol.endsWith("PE") && (
              <span style={{ position: "absolute", right: 2, top: "50%", transform: "translateY(-50%)", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, borderRadius: 3, background: "rgba(0,0,0,0)" }}>
                <svg width="12" height="12" viewBox="0 0 12 12"><polygon points="6,11 11,1 1,1" fill="#fff" /></svg>
              </span>
            )}
          </button>
        </div>

        <div className="font-mono text-sm flex-1 text-right pr-6">{row.ltp != null ? Number(row.ltp).toFixed(2) : "-"}</div>

        <div className="w-8 flex-shrink-0 flex justify-end">
          <button
            className="text-sm"
            style={isInTrade ? { color: "#d1d5db", cursor: "not-allowed" } : { color: "var(--theme-tailwind-red-500)" }}
            type="button"
            disabled={isInTrade}
            onClick={isInTrade ? undefined : () => removeFromWatchlist(row.symbol)}
          >
            {isInTrade ? <Lock className="w-4 h-4" /> : <Trash2 className="w-4 h-4" />}
          </button>
        </div>
      </div>
    );
  });

  useEffect(() => {
    if (watchlist.length === 0) return;

    const fetchPrices = async () => {
      const symbols = watchlist.map((item) => item.symbol);
      const latestPrices = await getPrices(symbols);
      updateWatchlistPrices(latestPrices);
    };

    fetchPrices();
    const interval = setInterval(fetchPrices, 1000);

    return () => clearInterval(interval);
  }, [watchlist.length, updateWatchlistPrices]);

  useEffect(() => {
    const text = searchText.trim();

    if (!text) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        // Use backend symbols directly (no filtering)
        // IMPORTANT: backend already gives correct format for trading
        const data: WatchlistItem[] = await searchSymbols(text);
        setSuggestions(data.slice(0, 8));
      } catch {
        setSuggestions([]);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchText]);

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between mb-4">
          <CardTitle className="flex items-center gap-2 text-lg font-semibold">
            <ListPlus className="w-5 h-5" />
            WATCHLIST
          </CardTitle>

          <div className="flex items-center gap-2 text-[10px] font-medium text-muted-foreground uppercase">
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "var(--theme-tailwind-blue-500)" }}></span> Ready
            </div>
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "var(--theme-tailwind-yellow-500)" }}></span> Waiting
            </div>
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "var(--theme-tailwind-red-500)" }}></span> Running
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <Input
            placeholder="Search symbol"
            value={searchText}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchText(e.target.value)}
            className={`flex-1 ${styles.searchInput}`}
            autoComplete="new-password"
          />

          <button
            type="button"
            className={styles.addBtn}
            onClick={() => {
              if (suggestions.length > 0) {
                // Add the exact backend symbol object to watchlist
                // IMPORTANT: do not rebuild symbol string manually
                addToWatchlist(suggestions[0]);
                console.log("Added to watchlist:", suggestions[0]);
                setSearchText("");
                setSuggestions([]);
              }
            }}
            disabled={suggestions.length === 0}
          >
            ADD
          </button>
        </div>

        {suggestions.length > 0 && (
          <div className="border rounded-md p-2 space-y-1 max-h-32 overflow-y-auto">
            {suggestions.map((item) => (
              <button
                key={item.symbol}
                type="button"
                className="w-full text-left px-2 py-1 text-sm hover:bg-muted rounded"
                onClick={() => {
                  // Add exact backend symbol from suggestion click
                  addToWatchlist(item);
                  console.log("Added to watchlist from suggestion:", item);
                  setSearchText("");
                  setSuggestions([]);
                }}
              >
                {item.symbol}
              </button>
            ))}
          </div>
        )}
      </CardHeader>

      <CardContent>
        <div className="space-y-1">
          <div className="flex items-center justify-between pb-2 border-b">
            <div className="text-sm font-medium w-[200px] flex-shrink-0">SYMBOL</div>
            <div className="text-sm font-medium flex-1 text-center flex items-center justify-center gap-2">
              LTP&nbsp;at
              {marketTime && (
                <span className={styles.timeBadge}>
                  {marketTime ? marketTime.split(" ")[1] : "--:--"}
                </span>
              )}
            </div>
            <div className="w-8 flex-shrink-0" />
          </div>

          <div className="max-h-64 overflow-y-auto">
            {!isHydrated ? (
              <div className="text-center py-4 text-muted-foreground">Loading watchlist...</div>
            ) : !watchlist.length ? (
              <div className="text-center py-4 text-muted-foreground">No symbols in watchlist</div>
            ) : (
              watchlistItems
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}