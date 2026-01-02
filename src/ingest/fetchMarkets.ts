import path from "node:path";
import { writeJsonFile } from "../lib/fs.js";
import { PolymarketGammaClient, extractMarketsArray, parseMarketsLoosely, type GammaMarketLoose } from "../clients/polymarket.js";

export type FetchMarketsResult = {
  raw: unknown[]; // verbatim market objects from API (concatenated across pages)
  marketsLoose: GammaMarketLoose[]; // optional parsed subset
  fetchedAtIso: string;
  pagesFetched: number;
  limitPerPage: number;
  maxPages: number;
};

export async function fetchMarkets(client: PolymarketGammaClient): Promise<FetchMarketsResult> {
  const fetchedAtIso = new Date().toISOString();

  // Single public discovery source: Gamma /markets
  // Note: Gamma uses pagination via limit/offset; we make multiple requests to the SAME endpoint.
  // Deployment note: large values can OOM-kill small servers. These are configurable via env vars.
  const limitPerPage = envInt("SCAN_LIMIT_PER_PAGE", 200, { min: 1, max: 500 });
  const maxPages = envInt("SCAN_MAX_PAGES", 10, { min: 1, max: 500 });
  const rawMarkets: unknown[] = [];
  let pagesFetched = 0;

  for (let page = 0; page < maxPages; page++) {
    const offset = page * limitPerPage;
    const pageRaw = await client.fetchMarketsRaw({ active: true, closed: false, limit: limitPerPage, offset });
    const arr = extractMarketsArray(pageRaw);
    pagesFetched += 1;
    rawMarkets.push(...arr);
    if (arr.length < limitPerPage) break;
  }

  // Store verbatim
  await writeJsonFile(path.resolve(process.cwd(), "data/raw/markets_raw.json"), rawMarkets);

  // Optional parsing for downstream normalization
  const marketsLoose = parseMarketsLoosely(rawMarkets);

  return { raw: rawMarkets, marketsLoose, fetchedAtIso, pagesFetched, limitPerPage, maxPages };
}

function envInt(name: string, fallback: number, bounds?: { min?: number; max?: number }): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  if (bounds?.min !== undefined && i < bounds.min) return bounds.min;
  if (bounds?.max !== undefined && i > bounds.max) return bounds.max;
  return i;
}


