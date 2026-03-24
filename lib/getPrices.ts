const API_URL = process.env.NEXT_PUBLIC_API_BASE_URL!;

export async function getPrices(symbols: string[]) {
  if (symbols.length === 0) {
    return [];
  }

  try {
    const list = symbols.join(",");
    const res = await fetch(`${API_URL}/prices?symbols=${list}`);
    return res.json();
  } catch {
    return [];
  }
}