import { readFile } from "node:fs/promises";
import path from "node:path";

export type PricesSnapshot = {
  marketToOutcomePrice: Map<string, Map<string, number | null>>;
};

export function defaultPricesPath(): string {
  return path.resolve(process.cwd(), "data/raw/prices_raw.json");
}

/**
 * Loads `data/raw/prices_raw.json` (derived snapshot).
 * This must never throw due to missing/partial data; returns empty snapshot on errors.
 */
export async function loadPricesSnapshot(filePath = defaultPricesPath()): Promise<PricesSnapshot> {
  try {
    const txt = await readFile(filePath, "utf8");
    const raw = JSON.parse(txt) as any;
    const pricesArr: any[] = Array.isArray(raw?.prices) ? raw.prices : [];

    const marketToOutcomePrice = new Map<string, Map<string, number | null>>();
    for (const row of pricesArr) {
      const marketId = typeof row?.marketId === "string" ? row.marketId : undefined;
      const outcomes: unknown = row?.outcomes;
      const outcomePrices: unknown = row?.outcomePrices;
      if (!marketId) continue;
      if (!Array.isArray(outcomes) || !Array.isArray(outcomePrices)) continue;

      const m = new Map<string, number | null>();
      for (let i = 0; i < outcomes.length; i++) {
        const o = outcomes[i];
        const p = outcomePrices[i];
        if (typeof o !== "string") continue;
        const pn = typeof p === "number" && Number.isFinite(p) ? p : null;
        m.set(o, pn);
      }
      marketToOutcomePrice.set(marketId, m);
    }

    return { marketToOutcomePrice };
  } catch {
    return { marketToOutcomePrice: new Map() };
  }
}

/**
 * Return the current price for a given market outcome, or null if missing.
 */
export function getOutcomePrice(snapshot: PricesSnapshot, marketId: string, outcome: string): number | null {
  const m = snapshot.marketToOutcomePrice.get(marketId);
  if (!m) return null;
  const p = m.get(outcome);
  return typeof p === "number" && Number.isFinite(p) ? p : null;
}


