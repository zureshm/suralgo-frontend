export async function getPrices(symbols: string[]) {
  if (symbols.length === 0) {
    return [];
  }

  const list = symbols.join(",");

  const res = await fetch(`http://localhost:2000/prices?symbols=${list}`);

  return res.json();
}