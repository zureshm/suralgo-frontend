"use client";

import { createContext, useContext, useState, ReactNode } from 'react';

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

  const addToWatchlist = (item: WatchlistItem) => {
    const alreadyExists = watchlist.some((row) => row.symbol === item.symbol);

    if (alreadyExists) return;

    setWatchlist((prev) => [...prev, item]);
  };

  const removeFromWatchlist = (symbol: string) => {
    setWatchlist((prev) => prev.filter((row) => row.symbol !== symbol));
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
