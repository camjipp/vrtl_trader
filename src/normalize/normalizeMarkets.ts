import type { GammaMarketLoose } from "../clients/polymarket.js";

export type NormalizedMarket = {
  marketId: string;
  title: string;
  eventId?: string;
  conditionId?: string;

  // Fully coerced; never a JSON string.
  outcomes: string[];
  // Price per outcome (if available); missing => null
  prices: Record<string, number | null>;
  tokenIds: Record<string, string | null>;

  // Convenience for binary markets (bucket + yes/no singles)
  yes_price: number | null;
  yesTokenId?: string;
  noTokenId?: string;
  tickSize?: number;
  negRisk?: boolean;

  liquidity?: number;
  volume?: number;
};

export type NormalizeMarketsStats = {
  inputMarkets: number;
  keptMarkets: number;
  marketsWithOutcomes: number;
  marketsWithPrices: number;
  binaryMarkets: number;
  multiOutcomeMarkets: number;
};

/**
 * Normalize Gamma markets into a stable internal shape.
 *
 * Explicit assumptions:
 * - Gamma commonly returns `outcomes` and `outcomePrices` as JSON-encoded strings.
 * - For binary markets, the "Yes" price is used as the implied probability.
 * - If we can't identify a "Yes" outcome name, we fall back to the first outcome's price.
 */
export function normalizeGammaMarkets(markets: GammaMarketLoose[]): { markets: NormalizedMarket[]; stats: NormalizeMarketsStats } {
  const out: NormalizedMarket[] = [];

  let marketsWithOutcomes = 0;
  let marketsWithPrices = 0;
  let binaryMarkets = 0;
  let multiOutcomeMarkets = 0;

  for (const m of markets) {
    const marketId = stringifyId(m.id ?? m.market_id ?? m.conditionId ?? m.condition_id);
    if (!marketId) continue;

    const title = (m.question ?? m.title ?? m.name ?? m.slug ?? marketId).trim();
    const conditionId = stringifyId(m.conditionId ?? m.condition_id);
    const eventId = stringifyId(m.event_id ?? m.eventId ?? m.events?.[0]?.id);

    const outcomes = coerceStringArray(m.outcomes) ?? [];
    if (outcomes.length) marketsWithOutcomes += 1;

    const priceArr = coerceNumberArray(m.outcomePrices ?? m.outcome_prices);
    const tokenArr = coerceStringArray(m.clobTokenIds ?? m.clob_token_ids);
    const prices: Record<string, number | null> = {};
    const tokenIds: Record<string, string | null> = {};
    if (outcomes.length && priceArr?.length) {
      marketsWithPrices += 1;
      for (let i = 0; i < outcomes.length; i++) {
        const name = outcomes[i]!;
        const p = priceArr[i];
        prices[name] = typeof p === "number" && Number.isFinite(p) ? p : null;
        tokenIds[name] = tokenArr?.[i] ?? null;
      }
    } else {
      for (let i = 0; i < outcomes.length; i++) {
        const name = outcomes[i]!;
        prices[name] = null;
        tokenIds[name] = tokenArr?.[i] ?? null;
      }
    }

    const yes_price = deriveYesPrice(outcomes, prices);
    const yesTokenId = deriveTokenId(outcomes, tokenIds, "yes");
    const noTokenId = deriveTokenId(outcomes, tokenIds, "no");

    if (outcomes.length === 2) binaryMarkets += 1;
    if (outcomes.length >= 3) multiOutcomeMarkets += 1;

    const liquidity = coerceNumber(m.liquidityNum ?? (m as any).liquidity ?? (m as any).liquidityClob);
    const volume = coerceNumber(m.volumeNum ?? (m as any).volume ?? (m as any).volumeClob);
    const tickSize = coerceNumber(m.orderPriceMinTickSize);

    out.push({
      marketId,
      title,
      ...(conditionId ? { conditionId } : {}),
      ...(eventId ? { eventId } : {}),
      outcomes,
      prices,
      tokenIds,
      yes_price,
      ...(yesTokenId ? { yesTokenId } : {}),
      ...(noTokenId ? { noTokenId } : {}),
      ...(tickSize !== null ? { tickSize } : {}),
      ...(typeof m.negRisk === "boolean" ? { negRisk: m.negRisk } : {}),
      ...(liquidity !== null ? { liquidity } : {}),
      ...(volume !== null ? { volume } : {})
    });
  }

  return {
    markets: out,
    stats: {
      inputMarkets: markets.length,
      keptMarkets: out.length,
      marketsWithOutcomes,
      marketsWithPrices,
      binaryMarkets,
      multiOutcomeMarkets
    }
  };
}

function deriveYesPrice(outcomes: string[], prices: Record<string, number | null>): number | null {
  if (outcomes.length === 0) return null;

  // Common "yes" labels on Polymarket.
  const yesNames = new Set(["yes", "y", "true"]);
  for (const name of outcomes) {
    if (yesNames.has(name.trim().toLowerCase())) return prices[name] ?? null;
  }

  // If this is a binary market but uses different labels, fall back to the first outcome.
  return prices[outcomes[0]!] ?? null;
}

function deriveTokenId(outcomes: string[], tokenIds: Record<string, string | null>, target: "yes" | "no"): string | undefined {
  if (outcomes.length === 0) return undefined;

  const aliases = target === "yes" ? new Set(["yes", "y", "true"]) : new Set(["no", "n", "false"]);
  for (const name of outcomes) {
    if (aliases.has(name.trim().toLowerCase())) {
      const tokenId = tokenIds[name];
      return tokenId && tokenId.trim() ? tokenId : undefined;
    }
  }

  if (outcomes.length === 2) {
    const fallback = target === "yes" ? outcomes[0]! : outcomes[1]!;
    const tokenId = tokenIds[fallback];
    return tokenId && tokenId.trim() ? tokenId : undefined;
  }

  return undefined;
}

function stringifyId(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

function coerceStringArray(v: unknown): string[] | undefined {
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v as string[];
  if (typeof v === "string") {
    const parsed = safeJsonParse(v);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) return parsed as string[];
  }
  return undefined;
}

function coerceNumberArray(v: unknown): number[] | undefined {
  if (Array.isArray(v)) {
    const nums = v.map(coerceNumber);
    if (!nums.some((n) => n !== null)) return undefined;
    // Preserve array indexing; missing/unparseable values become NaN (treated as invalid later).
    return nums.map((n) => (n === null ? Number.NaN : n));
  }
  if (typeof v === "string") {
    const parsed = safeJsonParse(v);
    if (Array.isArray(parsed)) return coerceNumberArray(parsed);
  }
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

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

