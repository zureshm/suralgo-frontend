"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

type WatchlistItem = {
  symbol: string;
  ltp: number | null;
};

const WatchlistContext = createContext<{
  watchlist: WatchlistItem[];
  addToWatchlist: (item: WatchlistItem) => void;
  removeFromWatchlist: (symbol: string) => void;
  updateWatchlistPrices: (prices: WatchlistItem[]) => void;
} | undefined>(undefined);

export const WatchlistProvider = ({ children }: { children: ReactNode }): ReactNode => {
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);

  // Load watchlist from server on mount
  useEffect(() => {
    fetch("/api/watchlist")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data.symbols)) {
          setWatchlist(data.symbols.map((s: string) => ({ symbol: s, ltp: null })));
        }
      })
      .catch(() => {});
  }, []);

  const addToWatchlist = (item: WatchlistItem) => {
    const alreadyExists = watchlist.some((row) => row.symbol === item.symbol);

    if (alreadyExists) return;

    const newWatchlist = [...watchlist, item];
    setWatchlist(newWatchlist);
    fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: item.symbol }),
    }).catch(() => {});
  };

  const removeFromWatchlist = (symbol: string) => {
    const newWatchlist = watchlist.filter((row) => row.symbol !== symbol);
    setWatchlist(newWatchlist);
    fetch("/api/watchlist", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol }),
    }).catch(() => {});
  };

  const updateWatchlistPrices = (prices: WatchlistItem[]) => {
    setWatchlist((prev) =>
      prev.map((item) => {
        const match = prices.find((row) => row.symbol === item.symbol);

        if (match) {
          return {
            ...item,
            ltp: match.ltp,
          };
        }

        return item;
      })
    );
  };

  return (
    <WatchlistContext.Provider  value={{ watchlist, addToWatchlist, removeFromWatchlist, updateWatchlistPrices }}
>
      {children}
    </WatchlistContext.Provider>
  );
};

export const useWatchlist = () => {
  const context = useContext(WatchlistContext);
  if (!context) throw new Error('useWatchlist must be used within WatchlistProvider');
  return context;
};

export type { WatchlistItem };
