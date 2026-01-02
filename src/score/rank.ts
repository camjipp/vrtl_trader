import type { FamilyScored } from "../detect/basicAnomalies.js";

export function rankFamilies(families: FamilyScored[]): FamilyScored[] {
  // Filter out obvious junk: too few valid prices for bucket families.
  const filtered = families.filter((f) => {
    if (f.family_type !== "bucket") return true;
    const vp = f.features?.validPrices ?? 0;
    const mp = f.features?.missingPrices ?? 999;
    const gaps = f.features?.gapCount ?? 999;
    const overlaps = f.features?.overlapCount ?? 999;
    const liq = f.features?.liquidityMax;
    // Heuristic threshold: requires at least 6 usable bucket prices.
    if (vp < 6) return false;
    // Require most buckets to have usable prices.
    if (mp > 2) return false;
    // If gaps/overlaps are huge, smoothness and cluster tests aren't meaningful.
    if (gaps > 2 || overlaps > 0) return false;
    // Liquidity-ish: if present, require a floor (keeps top 20 actionable).
    if (liq !== null && liq !== undefined && liq < 500) return false;
    return true;
  });

  return filtered.slice().sort((a, b) => {
    if (b.opportunity_score !== a.opportunity_score) return b.opportunity_score - a.opportunity_score;
    return b.num_outcomes - a.num_outcomes;
  });
}


