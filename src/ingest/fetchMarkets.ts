import path from "node:path";
import { writeJsonFile } from "../lib/fs.js";
import { PolymarketGammaClient, extractMarketsArray, parseMarketsLoosely, type GammaMarketLoose } from "../clients/polymarket.js";

export type FetchMarketsResult = {
  raw: unknown[]; // verbatim market objects from API (concatenated across pages)
  marketsLoose: GammaMarketLoose[]; // optional parsed subset
  fetchedAtIso: string;
  pagesFetched: number;
};

export async function fetchMarkets(client: PolymarketGammaClient): Promise<FetchMarketsResult> {
  const fetchedAtIso = new Date().toISOString();

  // Single public discovery source: Gamma /markets
  // Note: Gamma uses pagination via limit/offset; we make multiple requests to the SAME endpoint.
  const limitPerPage = 200;
  const maxPages = 50;
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

  return { raw: rawMarkets, marketsLoose, fetchedAtIso, pagesFetched };
}


