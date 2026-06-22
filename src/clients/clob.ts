import { getJson } from "../lib/http.js";

export type ClobPriceLevel = {
  price: number;
  size: number;
};

export type ClobOrderBook = {
  tokenId: string;
  market?: string;
  timestamp?: string;
  bids: ClobPriceLevel[];
  asks: ClobPriceLevel[];
  minOrderSize?: number;
  tickSize?: number;
  negRisk?: boolean;
  hash?: string;
};

export class PolymarketClobClient {
  private readonly baseUrl: string;

  constructor(baseUrl = "https://clob.polymarket.com") {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async fetchOrderBooks(tokenIds: string[]): Promise<ClobOrderBook[]> {
    const unique = [...new Set(tokenIds.filter((x) => x.trim().length > 0))];
    if (unique.length === 0) return [];

    const payload = unique.map((token_id) => ({ token_id }));
    const raw = await getJson<unknown>(`${this.baseUrl}/books`, {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json" }
    });

    return parseBooksResponse(raw);
  }
}

function parseBooksResponse(raw: unknown): ClobOrderBook[] {
  const arr = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as any).books)
      ? (raw as any).books
      : [];

  const books: ClobOrderBook[] = [];
  for (const row of arr) {
    if (!row || typeof row !== "object") continue;
    const obj = row as Record<string, unknown>;
    const tokenId = stringify(obj.asset_id ?? obj.token_id ?? obj.tokenId);
    if (!tokenId) continue;
    const market = stringify(obj.market);
    const timestamp = stringify(obj.timestamp);
    const minOrderSize = coerceNumber(obj.min_order_size ?? obj.minOrderSize);
    const tickSize = coerceNumber(obj.tick_size ?? obj.tickSize);
    const hash = stringify(obj.hash);

    books.push({
      tokenId,
      ...(market ? { market } : {}),
      ...(timestamp ? { timestamp } : {}),
      bids: parseLevels(obj.bids, "bid"),
      asks: parseLevels(obj.asks, "ask"),
      ...(minOrderSize !== null ? { minOrderSize } : {}),
      ...(tickSize !== null ? { tickSize } : {}),
      ...(typeof obj.neg_risk === "boolean" ? { negRisk: obj.neg_risk } : {}),
      ...(typeof obj.negRisk === "boolean" ? { negRisk: obj.negRisk } : {}),
      ...(hash ? { hash } : {})
    });
  }
  return books;
}

function parseLevels(v: unknown, side: "bid" | "ask"): ClobPriceLevel[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => {
      if (!x || typeof x !== "object") return null;
      const obj = x as Record<string, unknown>;
      const price = coerceNumber(obj.price);
      const size = coerceNumber(obj.size);
      if (price === null || size === null) return null;
      return { price, size };
    })
    .filter((x): x is ClobPriceLevel => x !== null)
    .sort((a, b) => (side === "bid" ? b.price - a.price : a.price - b.price));
}

function stringify(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

function coerceNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
