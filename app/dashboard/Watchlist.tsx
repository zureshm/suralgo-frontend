"use client";

import { useEffect, useState } from "react";
import { searchSymbols } from "@/lib/api";
import { useRouter } from "next/navigation";
import { useTradeStore } from "../store/TradeStore";
import { useWatchlist, WatchlistItem } from "../store/WatchlistContext";
import { getPrices } from "@/lib/getPrices";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ListPlus } from "lucide-react";

export default function Watchlist() {
  const [searchText, setSearchText] = useState("");
  const [suggestions, setSuggestions] = useState<WatchlistItem[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);

  const router = useRouter();

  const {
    setSelection,
    waitingTrades,
    activeTrades,
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

  const watchlistItems = watchlist.map((row) => {
    const isWaiting = waitingTrades.some((t) => t.symbol === row.symbol);
    const isRunning = activeTrades.some((t) => t.symbol === row.symbol);

    const buttonClass = isWaiting
      ? "bg-yellow-500 hover:bg-yellow-600 text-white"
      : isRunning
      ? "bg-red-500 hover:bg-red-600 text-white"
      : "bg-blue-500 hover:bg-blue-600 text-white";

    return (
      <div key={row.symbol} className="flex items-center justify-between py-2 border-b last:border-b-0">
        <button
          className={`px-3 py-1 rounded text-sm font-medium ${buttonClass}`}
          type="button"
          onClick={isRunning ? undefined : () => {
            setSelection({
              symbol: row.symbol,
              price: String(row.ltp ?? ""),
            });
            router.push("/trade");
          }}
          style={isRunning ? { pointerEvents: "none" } : {}}
        >
          {row.symbol}
        </button>

        <div className="font-mono text-sm">{row.ltp ?? "-"}</div>

        <button
          className="text-red-500 hover:text-red-700 text-sm"
          type="button"
          onClick={() => removeFromWatchlist(row.symbol)}
        >
          🗑️
        </button>
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
        const data: WatchlistItem[] = await searchSymbols(text);
        const filtered = data.filter((item) =>
          item.symbol.toLowerCase().includes(text.toLowerCase())
        );
        setSuggestions(filtered.slice(0, 8));
      } catch {
        setSuggestions([]);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchText]);

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg font-semibold">
          <ListPlus className="w-5 h-5" />
          WATCHLIST
        </CardTitle>
        
        <div className="flex gap-2">
          <Input
            placeholder="Search symbol"
            value={searchText}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchText(e.target.value)}
            className="flex-1"
          />
          
          <Button
            type="button"
            onClick={() => {
              if (suggestions.length > 0) {
                addToWatchlist(suggestions[0]);
                setSearchText("");
                setSuggestions([]);
              }
            }}
            disabled={suggestions.length === 0}
          >
            ADD
          </Button>
        </div>

        {suggestions.length > 0 && (
          <div className="border rounded-md p-2 space-y-1 max-h-32 overflow-y-auto">
            {suggestions.map((item) => (
              <button
                key={item.symbol}
                type="button"
                className="w-full text-left px-2 py-1 text-sm hover:bg-muted rounded"
                onClick={() => {
                  addToWatchlist(item);
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
          <div className="grid grid-cols-3 gap-4 pb-2 border-b">
            <div className="text-sm font-medium">SYMBOL</div>
            <div className="text-sm font-medium text-right">LTP</div>
            <div className="w-8"></div>
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
