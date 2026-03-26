const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL!;
const STRATEGY_URL = process.env.NEXT_PUBLIC_STRATEGY_API_URL!;

export async function getWatchlist() {
  try {
    const res = await fetch(`${BASE_URL}/watchlist`);
    return res.json();
  } catch {
    return [];
  }
}

export async function getAccountDetails() {
  try {
    const res = await fetch(`${BASE_URL}/account-details`);
    return res.json();
  } catch {
    return null;
  }
}

export async function getCurrentCandle() {
  try {
    const res = await fetch(`${BASE_URL}/current-candle`);
    return res.json();
  } catch {
    return null;
  }
}

export async function searchSymbols(query: string) {
  try {
    const res = await fetch(`${BASE_URL}/watchlist?q=${encodeURIComponent(query)}`);
    return res.json();
  } catch {
    return [];
  }
}

// fetch latest strategy evaluation (BUY / SELL / WAIT) from strategy engine
export async function getStrategySignal() {
  try {
    const res = await fetch(`${STRATEGY_URL}/evaluate`);

    const data = await res.json();

    return data;
  } catch {
    return null;
  }
}

export async function getStrategyEvaluation(symbol: string) {
  const response = await fetch(
    `http://localhost:4000/evaluate?symbol=${encodeURIComponent(symbol)}`
  );

  if (!response.ok) {
    throw new Error("Failed to fetch strategy evaluation");
  }

  return response.json();
}

// Fetch market time from angel feed
export async function getMarketTime() {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/market-time`);

  if (!res.ok) {
    throw new Error("Failed to fetch market time");
  }

  return res.json();
}

// Tell angel-feed backend which symbol is currently active
export async function setActiveSymbol(symbol: string) {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/active-symbol`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ symbol }),
  });

  if (!res.ok) {
    throw new Error("Failed to set active symbol");
  }

  return res.json();
}

// Tell angel-feed backend the full current watchlist symbols
// Backend will use this list for multi-symbol LTP subscription
export async function setWatchlistSymbols(symbols: string[]) {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_BASE_URL}/watchlist-symbols`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ symbols }),
    }
  );

  if (!res.ok) {
    throw new Error("Failed to update watchlist symbols");
  }

  return res.json();
}