import path from "node:path";
import { PolymarketClobClient, type ClobOrderBook } from "../clients/clob.js";
import { writeJsonFile } from "../lib/fs.js";
import type { NormalizedMarket } from "../normalize/normalizeMarkets.js";

export type MarketOrderBookPair = {
  marketId: string;
  conditionId?: string;
  title: string;
  yesTokenId: string;
  noTokenId: string;
  tickSize?: number;
  negRisk?: boolean;
  yes: ClobOrderBook | null;
  no: ClobOrderBook | null;
};

export type OrderBooksSnapshot = {
  fetchedAtIso: string;
  source: "clob_books";
  requestedTokens: number;
  receivedBooks: number;
  markets: MarketOrderBookPair[];
  warnings: string[];
};

export async function fetchOrderBooksForMarkets(
  markets: NormalizedMarket[],
  opts: { client?: PolymarketClobClient; maxMarkets?: number; batchSize?: number } = {}
): Promise<OrderBooksSnapshot> {
  const fetchedAtIso = new Date().toISOString();
  const eligible = markets
    .filter((m) => m.outcomes.length === 2 && m.yesTokenId && m.noTokenId)
    .slice(0, opts.maxMarkets ?? envIntOr("ORDERBOOK_MAX_MARKETS", 500, { min: 1, max: 10_000 }));

  const tokenIds = eligible.flatMap((m) => [m.yesTokenId!, m.noTokenId!]);
  const client = opts.client ?? new PolymarketClobClient();
  const batchSize = opts.batchSize ?? envIntOr("ORDERBOOK_BATCH_SIZE", 250, { min: 1, max: 500 });

  const booksByToken = new Map<string, ClobOrderBook>();
  const warnings: string[] = [];
  for (let i = 0; i < tokenIds.length; i += batchSize) {
    const batch = tokenIds.slice(i, i + batchSize);
    try {
      const books = await client.fetchOrderBooks(batch);
      for (const b of books) booksByToken.set(b.tokenId, b);
    } catch (e: any) {
      warnings.push(`orderbook batch ${Math.floor(i / batchSize) + 1} failed: ${e?.message ?? String(e)}`);
    }
  }

  const pairs: MarketOrderBookPair[] = eligible.map((m) => ({
    marketId: m.marketId,
    ...(m.conditionId ? { conditionId: m.conditionId } : {}),
    title: m.title,
    yesTokenId: m.yesTokenId!,
    noTokenId: m.noTokenId!,
    ...(m.tickSize !== undefined ? { tickSize: m.tickSize } : {}),
    ...(m.negRisk !== undefined ? { negRisk: m.negRisk } : {}),
    yes: booksByToken.get(m.yesTokenId!) ?? null,
    no: booksByToken.get(m.noTokenId!) ?? null
  }));

  const snapshot: OrderBooksSnapshot = {
    fetchedAtIso,
    source: "clob_books",
    requestedTokens: tokenIds.length,
    receivedBooks: booksByToken.size,
    markets: pairs,
    warnings
  };

  await writeJsonFile(path.resolve(process.cwd(), "data/raw/orderbooks_raw.json"), snapshot);
  return snapshot;
}

function envIntOr(name: string, fallback: number, bounds?: { min?: number; max?: number }): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  if (bounds?.min !== undefined && i < bounds.min) return bounds.min;
  if (bounds?.max !== undefined && i > bounds.max) return bounds.max;
  return i;
}
