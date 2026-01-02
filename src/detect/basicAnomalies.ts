import type { MarketFamily } from "../normalize/buildFamilies.js";

export type BucketFeatures = {
  validPrices: number;
  missingPrices: number;
  gapCount: number;
  overlapCount: number;
  liquidityMax: number | null;
  volumeMax: number | null;
  overround: number | null;
  maxSpike: number | null;
  bestCluster: { labels: string[]; cost: number; ratio: number; z: number } | null;
  bestClusterRatio: number | null;
  bestClusterZ: number | null;
};

export type FamilyScored = MarketFamily & {
  features?: BucketFeatures;
  opportunity_score: number;
  reasons: string[];
};

/**
 * Compute real bucket-family signals + a first opportunity score.
 *
 * Important assumptions (explicit):
 * - We use `yes_price` for each bucket market as the implied probability for that bucket.
 * - We treat NaN/null/<=0/>=1 as invalid and exclude from feature math.
 * - Score is heuristic (structural-only) and will evolve as more data sources are added.
 */
export function scoreFamilies(families: MarketFamily[]): FamilyScored[] {
  return families.map((f) => {
    if (f.family_type !== "bucket" || !f.buckets?.length) {
      if (f.family_type === "multi" && f.multi?.length) {
        const ps = f.multi.map((o) => o.price);
        const valid = ps.filter((p) => typeof p === "number" && Number.isFinite(p) && p > 0.001 && p < 0.999) as number[];
        const missing = ps.length - valid.length;
        const sumP = valid.length >= 3 ? sum(valid) : null;
        const edge = sumP !== null ? Math.abs(1 - sumP) : 0;
        const opportunity_score = clamp01(edge);
        const reasons: string[] = [];
        if (sumP === null) reasons.push("insufficient prices for multi overround");
        else reasons.push(`multi overround=${sumP.toFixed(3)}`);
        if (missing > 0) reasons.push(`missingPrices ${missing}`);
        return { ...f, opportunity_score, reasons };
      }

      // Singles are kept but deprioritized unless we add specific structural signals later.
      return { ...f, opportunity_score: 0, reasons: ["single/binary (deprioritized in MVP)"] };
    }

    const { gapCount, overlapCount } = rangeAdjacencyStats(f.buckets);

    const ps = f.buckets.map((b) => b.yes_price);
    const valid = ps.filter((p) => typeof p === "number" && Number.isFinite(p) && p > 0.001 && p < 0.999) as number[];
    const missingPrices = ps.length - valid.length;

    const overround = valid.length >= 2 ? sum(valid) : null;

    const maxSpike = computeMaxSpike(f.buckets);
    const bestCluster = findBestClusterByLocalMassZ(f.buckets);

    const liquidityMax = maxOrNull(f.buckets.map((b) => b.liquidity));
    const volumeMax = maxOrNull(f.buckets.map((b) => b.volume));

    const reasons: string[] = [];
    if (overround !== null) {
      if (overround < 0.95) reasons.push(`underround ${overround.toFixed(3)}`);
      if (overround > 1.05) reasons.push(`overround ${overround.toFixed(3)}`);
    } else {
      reasons.push("insufficient prices for overround");
    }
    if (maxSpike !== null && maxSpike >= 0.08) reasons.push(`spike ${maxSpike.toFixed(3)}`);
    if (bestCluster) reasons.push(`bestCluster cost ${bestCluster.cost.toFixed(3)}`);
    if (gapCount > 0) reasons.push(`gaps ${gapCount}`);
    if (overlapCount > 0) reasons.push(`overlaps ${overlapCount}`);

    // Opportunity score (simple, read-only): spikes + underround + (cluster cheapness vs local mass) + liquidity, with penalties.
    // Only treat underround/overround as meaningful if the buckets look like a contiguous partition.
    const looksPartitioned = gapCount === 0 && overlapCount === 0 && f.buckets.length >= 6;
    const underroundEdge = looksPartitioned && overround !== null ? Math.max(0, 1 - overround) : 0;
    const spikeScore = maxSpike ?? 0;
    const clusterZ = bestCluster?.z ?? null;
    const clusterCheapnessScore = clusterZ !== null ? clamp01((-clusterZ) / 2) : 0; // z=-2 => 1.0
    const liquidityScore = liquidityMax !== null ? clamp01(Math.log10(1 + liquidityMax) / 5) : 0;

    const penalty =
      (missingPrices > 0 ? 0.10 : 0) +
      (gapCount > 0 ? 0.15 : 0) +
      (overlapCount > 0 ? 0.25 : 0);

    const rawScore = 0.30 * spikeScore + 0.30 * underroundEdge + 0.30 * clusterCheapnessScore + 0.10 * liquidityScore;
    const opportunity_score = clamp01(rawScore - penalty);

    const features: BucketFeatures = {
      validPrices: valid.length,
      missingPrices,
      gapCount,
      overlapCount,
      liquidityMax,
      volumeMax,
      overround,
      maxSpike,
      bestCluster
      ,
      bestClusterRatio: bestCluster?.ratio ?? null,
      bestClusterZ: bestCluster?.z ?? null
    };

    return { ...f, features, opportunity_score, reasons };
  });
}

function computeMaxSpike(buckets: NonNullable<MarketFamily["buckets"]>): number | null {
  let max = 0;
  let found = false;
  for (let i = 1; i < buckets.length - 1; i++) {
    const pPrev = buckets[i - 1]!.yes_price;
    const p = buckets[i]!.yes_price;
    const pNext = buckets[i + 1]!.yes_price;
    if (!isValidProb(pPrev) || !isValidProb(p) || !isValidProb(pNext)) continue;
    const spike = Math.abs(p - 0.5 * (pPrev + pNext));
    if (spike > max) max = spike;
    found = true;
  }
  return found ? max : null;
}

function findBestClusterByLocalMassZ(
  buckets: NonNullable<MarketFamily["buckets"]>
): { labels: string[]; cost: number; ratio: number; z: number } | null {
  type Cand = { labels: string[]; cost: number; ratio: number };
  const cands: Cand[] = [];
  const eps = 1e-9;

  for (const k of [2, 3, 4]) {
    for (let i = 0; i + k <= buckets.length; i++) {
      const cluster = buckets.slice(i, i + k);
      const ps = cluster.map((b) => b.yes_price);
      if (ps.some((p) => !isValidProb(p))) continue;
      const cost = sum(ps as number[]);

      const wStart = Math.max(0, i - 2);
      const wEnd = Math.min(buckets.length - 1, i + k + 1);
      const window = buckets.slice(wStart, wEnd + 1);
      const wp = window.map((b) => b.yes_price);
      if (wp.some((p) => !isValidProb(p))) continue;
      const windowSum = sum(wp as number[]);

      const ratio = cost / Math.max(windowSum, eps);
      cands.push({ labels: cluster.map((b) => b.label), cost, ratio });
    }
  }

  if (cands.length === 0) return null;
  const mean = sum(cands.map((c) => c.ratio)) / cands.length;
  const variance = sum(cands.map((c) => (c.ratio - mean) ** 2)) / cands.length;
  const std = Math.sqrt(variance);
  const z = (x: number) => (std > 1e-9 ? (x - mean) / std : 0);

  let best: { labels: string[]; cost: number; ratio: number; z: number } | null = null;
  for (const c of cands) {
    const cz = z(c.ratio);
    if (!best || cz < best.z) best = { ...c, z: cz };
  }
  return best;
}

function isValidProb(p: number | null): p is number {
  return typeof p === "number" && Number.isFinite(p) && p > 0.001 && p < 0.999;
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function rangeAdjacencyStats(buckets: NonNullable<MarketFamily["buckets"]>): { gapCount: number; overlapCount: number } {
  let gapCount = 0;
  let overlapCount = 0;
  for (let i = 1; i < buckets.length; i++) {
    const prev = buckets[i - 1]!.range;
    const cur = buckets[i]!.range;
    if (cur.low > prev.high) gapCount += 1;
    if (cur.low < prev.high) overlapCount += 1;
  }
  return { gapCount, overlapCount };
}

function maxOrNull(xs: Array<number | undefined>): number | null {
  let max: number | null = null;
  for (const x of xs) {
    if (typeof x !== "number" || !Number.isFinite(x)) continue;
    if (max === null || x > max) max = x;
  }
  return max;
}


