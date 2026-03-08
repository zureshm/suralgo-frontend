const BASE_URL = "http://localhost:2000";

export async function getWatchlist() {
  const res = await fetch(`${BASE_URL}/watchlist`);
  return res.json();
}

export async function getAccountDetails() {
  const res = await fetch(`${BASE_URL}/account-details`);
  return res.json();
}

export async function getCurrentCandle() {
  const res = await fetch(`${BASE_URL}/current-candle`);
  return res.json();
}

/* ADD THIS PART BELOW */

export async function searchSymbols(query: string) {
  const res = await fetch(`${BASE_URL}/watchlist?q=${encodeURIComponent(query)}`);
  return res.json();
}