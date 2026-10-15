// Sorts option symbols into CE/PE pairs per index+expiry group.
// NIFTY groups first, SENSEX groups last, others between. Within a group:
// CEs sorted by strike descending zipped with PEs sorted by strike ascending
// (highest CE pairs with lowest PE). Non-option symbols keep original order at group top.
//
// Formats (see formatExpiryToSymbol in OptionsDesktop.tsx):
//   NIFTY19OCT2622200CE   → index + DDMMMYY + strike
//   SENSEX25OCT78100CE    → index + YYMMM   + strike (monthly)
//   SENSEX25O0778100CE    → index + YY + month-code + DD + strike (weekly)
// SENSEX must be parsed before the generic pattern — "25OCT78100" would
// otherwise misread "78" as the expiry year and leave "100" as the strike.
const SENSEX_RE = /^(SENSEX)(\d{2}[A-Z]{3}|\d{2}[A-Z]\d{2})(\d+)(CE|PE)$/;
const GENERIC_RE = /^([A-Z]+?)(\d{2}[A-Z]{3}\d{2})(\d+)(CE|PE)$/;

type ParsedSymbol<T> = {
  item: T;
  groupKey: string;
  rank: number;
  strike: number;
  kind: "CE" | "PE" | "OTHER";
};

function indexRank(index: string): number {
  if (index.startsWith("NIFTY")) return 0;
  if (index.startsWith("SENSEX")) return 2;
  return 1;
}

export function sortSymbolsByPairs<T>(items: T[], getSymbol: (item: T) => string): T[] {
  const parsed: ParsedSymbol<T>[] = items.map((item) => {
    const symbol = getSymbol(item);
    const m = String(symbol).match(SENSEX_RE) || String(symbol).match(GENERIC_RE);
    if (!m) return { item, groupKey: symbol, rank: indexRank(symbol), strike: NaN, kind: "OTHER" };
    return { item, groupKey: m[1] + "|" + m[2], rank: indexRank(m[1]), strike: Number(m[3]), kind: m[4] as "CE" | "PE" };
  });

  // Group by index+expiry, preserving first-seen order within a rank
  const groups = new Map<string, ParsedSymbol<T>[]>();
  for (const p of parsed) {
    const list = groups.get(p.groupKey);
    if (list) list.push(p);
    else groups.set(p.groupKey, [p]);
  }
  const orderedGroups = [...groups.values()].sort((a, b) => a[0].rank - b[0].rank);

  const out: T[] = [];
  for (const members of orderedGroups) {
    const others = members.filter((m) => m.kind === "OTHER");
    const ces = members.filter((m) => m.kind === "CE").sort((a, b) => b.strike - a.strike);
    const pes = members.filter((m) => m.kind === "PE").sort((a, b) => a.strike - b.strike);
    out.push(...others.map((m) => m.item));
    const n = Math.max(ces.length, pes.length);
    for (let i = 0; i < n; i++) {
      if (ces[i]) out.push(ces[i].item);
      if (pes[i]) out.push(pes[i].item);
    }
  }
  return out;
}
