import path from "node:path";
import { writeJsonFile } from "../lib/fs.js";

export type Dashboard = {
  timestamp: string;
  scan: {
    fetched: number;
    parsed: number;
    normalized: number;
    families: number;
    bucketFamilies: number;
    bucketFamiliesWith6ValidPrices: number;
    familyTypeCounts: {
      bucket: number;
      multi: number;
      single: number;
    };
    stopReason: string;
    pagesFetched: number;
    limits: {
      GAMMA_LIMIT: number;
      GAMMA_PAGE_LIMIT: number | null;
      MAX_MARKETS: number | null;
    };
  };
  warnings: string[];
  topFamilies: Array<{
    family_id: string;
    family_type: "bucket" | "multi" | "single";
    title: string;
    opportunity_score: number;
    reasons: string[];
    features?: {
      overround: number | null;
      maxSpike: number | null;
      bestClusterZ: number | null;
      liquidityMax: number | null;
      validPrices: number | null;
      missingPrices: number | null;
    };
  }>;
  paper?: {
    bankrollCashUsd: number;
    realizedPnlUsd: number;
    unrealizedPnlUsd: number;
    openPositionsCount: number;
    exposureUsd: number;
    newTradesSummary: Array<{
      positionId: string;
      family_id: string;
      marketId: string;
      outcome: string;
      usd: number;
      price: number;
      reason: string;
    }>;
    openPositionsSummary: Array<{
      positionId: string;
      family_id: string;
      marketId: string;
      outcome: string;
      entryTs: string;
      entryPrice: number;
      entryUsd: number;
      lastMarkPrice: number | null;
    }>;
  };
};

export function defaultDashboardPath(): string {
  return path.resolve(process.cwd(), "data/out/dashboard.json");
}

export async function writeDashboard(dashboard: Dashboard, filePath = defaultDashboardPath()): Promise<void> {
  await writeJsonFile(filePath, dashboard);
}


