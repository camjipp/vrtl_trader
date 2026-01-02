import path from "node:path";
import { writeJsonFile } from "../lib/fs.js";
import type { NormalizedMarket } from "../normalize/normalizeMarkets.js";

export type PricesRaw = {
  derivedFrom: "markets_raw.json";
  extractedAtIso: string;
  notes: string[];
  prices: Array<{
    marketId?: string;
    question?: string;
    outcomes?: string[];
    outcomePrices?: Array<number | null>;
  }>;
};

/**
 * Prices ingestion (MVP):
 * - Constraint: do NOT call additional endpoints.
 * - We derive a "prices_raw.json" snapshot from fields embedded in Gamma /markets (if present).
 */
export async function fetchPrices(markets: NormalizedMarket[]): Promise<PricesRaw> {
  const extractedAtIso = new Date().toISOString();

  const prices: PricesRaw["prices"] = markets
    .map((m) => {
      const marketId = m.marketId;
      const question = m.title;
      const outcomes = m.outcomes;
      const outcomePrices = outcomes.map((o) => m.prices[o] ?? null);
      if (!outcomes.length) return null;
      return { marketId, question, outcomes, outcomePrices };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const payload: PricesRaw = {
    derivedFrom: "markets_raw.json",
    extractedAtIso,
    notes: [
      "This file is derived from embedded fields in Gamma /markets (single-source constraint).",
      "If outcomePrices are missing, downstream detectors should treat prices as unavailable."
    ],
    prices
  };

  await writeJsonFile(path.resolve(process.cwd(), "data/raw/prices_raw.json"), payload);
  return payload;
}


