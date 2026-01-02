import { parseRangeWithConfidence, removeFirstRangeForGrouping, type ParsedRange } from "./parseRanges.js";
import type { NormalizedMarket } from "./normalizeMarkets.js";

export type FamilyType = "bucket" | "multi" | "single";

export type BucketOutcome = {
  marketId: string;
  label: string;
  range: ParsedRange;
  yes_price: number | null;
  liquidity?: number;
  volume?: number;
  rangeParseConfidence: number;
};

export type MultiOutcome = {
  name: string;
  price: number | null;
};

export type MarketFamily = {
  family_id: string;
  family_type: FamilyType;
  title: string;
  num_outcomes: number;
  eventId?: string;

  // Exactly one of these is populated depending on family_type.
  buckets?: BucketOutcome[];
  multi?: MultiOutcome[];
  single?: {
    marketId: string;
    yes_price: number | null;
    liquidity?: number;
    volume?: number;
  };
};

export function buildFamilies(markets: NormalizedMarket[]): MarketFamily[] {
  // 1) Bucket families: group binary markets that have parseable ranges in the title.
  const bucketGroups = new Map<
    string,
    { family_id: string; title: string; eventId?: string; members: BucketOutcome[] }
  >();

  for (const m of markets) {
    const { base } = removeFirstRangeForGrouping(m.title);
    const pr = parseRangeWithConfidence(m.title);
    if (!pr) continue;

    // Buckets are modeled as binary markets ("Yes"/"No") for each range.
    // We require a stable marketId and use the derived yes_price.
    const key = bucketKey(m.eventId, base);

    const entry =
      bucketGroups.get(key) ??
      ({
        family_id: key,
        title: base,
        ...(m.eventId ? { eventId: m.eventId } : {}),
        members: [] as BucketOutcome[]
      } satisfies { family_id: string; title: string; eventId?: string; members: BucketOutcome[] });

    const member: BucketOutcome = {
      marketId: m.marketId,
      label: pr.range.normalizedLabel,
      range: pr.range,
      yes_price: m.yes_price,
      ...(m.liquidity !== undefined ? { liquidity: m.liquidity } : {}),
      ...(m.volume !== undefined ? { volume: m.volume } : {}),
      rangeParseConfidence: pr.confidence
    };

    entry.members.push(member);
    bucketGroups.set(key, entry);
  }

  const families: MarketFamily[] = [];

  for (const g of bucketGroups.values()) {
    // Family-level adjustment: +1 confidence if unit is consistent across included outcomes.
    // Then drop low-confidence outcomes before deciding if this is a bucket family.
    const unitCounts = new Map<string, number>();
    for (const m of g.members) {
      const u = m.range.unit ?? "";
      unitCounts.set(u, (unitCounts.get(u) ?? 0) + 1);
    }
    let dominantUnit = "";
    let dominantCount = 0;
    for (const [u, c] of unitCounts.entries()) {
      if (c > dominantCount) {
        dominantCount = c;
        dominantUnit = u;
      }
    }

    const buckets = g.members
      .map((m) => {
        const bonus = (m.range.unit ?? "") === dominantUnit && dominantCount >= 2 ? 1 : 0;
        return { ...m, rangeParseConfidence: m.rangeParseConfidence + bonus };
      })
      .filter((m) => m.rangeParseConfidence >= 2)
      .sort((a, b) => a.range.low - b.range.low);

    if (buckets.length < 2) continue; // requirement: >=2 outcomes after filtering
    families.push({
      family_id: g.family_id,
      family_type: "bucket",
      title: g.title,
      ...(g.eventId ? { eventId: g.eventId } : {}),
      num_outcomes: buckets.length,
      buckets
    });
  }

  // 2) Multi families: markets with 3+ outcomes and prices embedded.
  // 3) Single families: binary yes/no (or anything else we keep minimally).
  for (const m of markets) {
    // If this market is part of a bucket family, don't also emit it as a single.
    // Note: bucket candidates that didn't reach size>=2 are allowed to fall through as singles.
    const isInEmittedBucket = families.some(
      (f) => f.family_type === "bucket" && f.buckets?.some((b) => b.marketId === m.marketId)
    );
    if (isInEmittedBucket) continue;

    if (m.outcomes.length >= 3) {
      const multi: MultiOutcome[] = m.outcomes.map((name) => ({ name, price: m.prices[name] ?? null }));
      families.push({
        family_id: `market:${m.marketId}`,
        family_type: "multi",
        title: m.title,
        ...(m.eventId ? { eventId: m.eventId } : {}),
        num_outcomes: multi.length,
        multi
      });
      continue;
    }

    // Default: keep as single (includes binary yes/no).
    families.push({
      family_id: `market:${m.marketId}`,
      family_type: "single",
      title: m.title,
      ...(m.eventId ? { eventId: m.eventId } : {}),
      num_outcomes: m.outcomes.length,
      single: {
        marketId: m.marketId,
        yes_price: m.yes_price,
        ...(m.liquidity !== undefined ? { liquidity: m.liquidity } : {}),
        ...(m.volume !== undefined ? { volume: m.volume } : {})
      }
    });
  }

  // Deterministic, readable ordering: buckets first by size, then multi by size, then singles.
  return families.sort((a, b) => {
    const prio = (t: FamilyType) => (t === "bucket" ? 0 : t === "multi" ? 1 : 2);
    const dp = prio(a.family_type) - prio(b.family_type);
    if (dp !== 0) return dp;
    return b.num_outcomes - a.num_outcomes;
  });
}

function bucketKey(eventId: string | undefined, base: string): string {
  const prefix = eventId ? `event:${eventId}:` : "";
  return `${prefix}bucket:${slugify(base)}`;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2012\u2013\u2014\u2212]/g, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
}


