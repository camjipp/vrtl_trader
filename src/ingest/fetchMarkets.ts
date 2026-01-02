import path from "node:path";
import { writeJsonFile } from "../lib/fs.js";
import { PolymarketGammaClient, extractMarketsArray, parseMarketsLoosely, type GammaMarketLoose } from "../clients/polymarket.js";

export type FetchMarketsResult = {
  raw: unknown[]; // verbatim market objects from API (concatenated across pages)
  marketsLoose: GammaMarketLoose[]; // optional parsed subset
  fetchedAtIso: string;
  pagesFetched: number;
  gammaLimit: number;
  gammaPageLimit: number | null;
  maxMarkets: number | null;
  stopReason: string;
};

export async function fetchMarkets(client: PolymarketGammaClient): Promise<FetchMarketsResult> {
  const fetchedAtIso = new Date().toISOString();

  // Single public discovery source: Gamma /markets
  // Note: Gamma uses pagination via limit/offset; we make multiple requests to the SAME endpoint.
  //
  // Env vars (deployment):
  // - GAMMA_LIMIT: page size (default keeps current behavior)
  // - GAMMA_PAGE_LIMIT: max pages to fetch (unset = no page cap beyond "short page")
  // - MAX_MARKETS: hard cap on total markets collected (unset = no cap)
  //
  // Important: keep current behavior if env vars are unset.
  const gammaLimit = envIntOr("GAMMA_LIMIT", 200, { min: 1, max: 500 });
  const gammaPageLimit = envIntOpt("GAMMA_PAGE_LIMIT", { min: 1, max: 500 });
  const maxMarkets = envIntOpt("MAX_MARKETS", { min: 1, max: 1_000_000 });
  const rawMarkets: unknown[] = [];
  let pagesFetched = 0;
  let stopReason = "unknown";

  for (let page = 0; ; page++) {
    if (gammaPageLimit !== null && pagesFetched >= gammaPageLimit) {
      stopReason = `pageLimitReached(${gammaPageLimit})`;
      break;
    }
    if (maxMarkets !== null && rawMarkets.length >= maxMarkets) {
      stopReason = `maxMarketsReached(${maxMarkets})`;
      break;
    }

    const offset = page * gammaLimit;
    const pageRaw = await client.fetchMarketsRaw({ active: true, closed: false, limit: gammaLimit, offset });
    const arr = extractMarketsArray(pageRaw);
    pagesFetched += 1;
    rawMarkets.push(...arr);

    if (maxMarkets !== null && rawMarkets.length > maxMarkets) {
      rawMarkets.length = maxMarkets;
      stopReason = `trimmedToMaxMarkets(${maxMarkets})`;
      break;
    }

    if (arr.length < gammaLimit) {
      stopReason = `shortPage(len=${arr.length})`;
      break;
    }
  }

  // Store verbatim
  await writeJsonFile(path.resolve(process.cwd(), "data/raw/markets_raw.json"), rawMarkets);

  // Optional parsing for downstream normalization
  const marketsLoose = parseMarketsLoosely(rawMarkets);

  return {
    raw: rawMarkets,
    marketsLoose,
    fetchedAtIso,
    pagesFetched,
    gammaLimit,
    gammaPageLimit,
    maxMarkets,
    stopReason
  };
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

function envIntOpt(name: string, bounds?: { min?: number; max?: number }): number | null {
  const raw = process.env[name];
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  if (bounds?.min !== undefined && i < bounds.min) return bounds.min;
  if (bounds?.max !== undefined && i > bounds.max) return bounds.max;
  return i;
}


