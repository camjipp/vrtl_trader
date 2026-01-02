export type PaperConfig = {
  bankrollStartUsd: number;
  maxNewTradesPerScan: number;
  maxTradeUsd: number;
  maxExposurePct: number; // of NAV (cash + exposure)
  cooldownHours: number;
  takeProfitMove: number; // e.g. +0.02
  stopLossMove: number; // e.g. -0.02
  maxHoldHours: number;
};

export type PaperPosition = {
  id: string;
  family_id: string;
  family_type: "bucket" | "multi" | "single";

  marketId: string;
  outcome: string; // we paper-trade an outcome token like "Yes"

  entryTs: string; // ISO
  entryPrice: number;
  shares: number;
  entryUsd: number; // shares * entryPrice

  lastMarkTs?: string;
  lastMarkPrice?: number;
};

export type PaperState = {
  version: 1;
  updatedAt: string;
  bankrollCashUsd: number;
  positions: PaperPosition[];
  lastEntryByFamilyId: Record<string, string>; // ISO timestamp
};

export type PaperTradeEvent =
  | {
      ts: string;
      type: "MARK";
      positionId: string;
      marketId: string;
      outcome: string;
      price: number;
      unrealizedPnlUsd: number;
    }
  | {
      ts: string;
      type: "ENTRY";
      positionId: string;
      family_id: string;
      marketId: string;
      outcome: string;
      price: number;
      shares: number;
      usd: number;
      reason: string;
    }
  | {
      ts: string;
      type: "EXIT";
      positionId: string;
      family_id: string;
      marketId: string;
      outcome: string;
      price: number;
      shares: number;
      usd: number;
      realizedPnlUsd: number;
      reason: string;
      holdHours: number;
    };


