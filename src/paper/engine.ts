import path from "node:path";
import { readFile } from "node:fs/promises";
import crypto from "node:crypto";
import type { PaperConfig, PaperPosition, PaperState, PaperTradeEvent } from "./types.js";
import { appendPaperEvents, loadPaperState, savePaperState } from "./storage.js";
import { getOutcomePrice, loadPricesSnapshot } from "./pricing.js";

type RunPaperTradeArgs = {
  familiesPath?: string;
  pricesPath?: string;
};

export type PaperRunSummary = {
  ts: string;
  openPositions: number;
  exposureUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  bankrollCashUsd: number;
  entered: number;
  exited: number;
  marked: number;
};

export async function runPaperTrade(args: RunPaperTradeArgs = {}): Promise<PaperRunSummary> {
  const cfg = defaultConfig();
  const ts = new Date().toISOString();

  const familiesPath = args.familiesPath ?? path.resolve(process.cwd(), "data/out/families.json");
  const pricesPath = args.pricesPath ?? path.resolve(process.cwd(), "data/raw/prices_raw.json");

  const families = await safeReadJsonArray<any>(familiesPath);
  const pricesSnap = await loadPricesSnapshot(pricesPath);

  const existing = (await loadPaperState()) ?? defaultState(cfg, ts);
  let state: PaperState = { ...existing, updatedAt: ts };

  const events: PaperTradeEvent[] = [];

  // Mark existing positions
  let marked = 0;
  let unrealizedPnlUsd = 0;
  for (const pos of state.positions) {
    const px = getOutcomePrice(pricesSnap, pos.marketId, pos.outcome);
    if (px === null) continue; // never throw on missing prices
    const u = (px - pos.entryPrice) * pos.shares;
    unrealizedPnlUsd += u;
    marked += 1;
    events.push({
      ts,
      type: "MARK",
      positionId: pos.id,
      marketId: pos.marketId,
      outcome: pos.outcome,
      price: px,
      unrealizedPnlUsd: u
    });
    pos.lastMarkTs = ts;
    pos.lastMarkPrice = px;
  }

  // Exit rules
  const remaining: PaperPosition[] = [];
  let exited = 0;
  let realizedPnlUsd = 0;
  for (const pos of state.positions) {
    const px = getOutcomePrice(pricesSnap, pos.marketId, pos.outcome);
    if (px === null) {
      remaining.push(pos);
      continue;
    }

    const move = px - pos.entryPrice;
    const holdHours = (Date.parse(ts) - Date.parse(pos.entryTs)) / 36e5;
    const shouldExit =
      move >= cfg.takeProfitMove || move <= cfg.stopLossMove || holdHours >= cfg.maxHoldHours;
    if (!shouldExit) {
      remaining.push(pos);
      continue;
    }

    const exitUsd = pos.shares * px;
    const pnl = exitUsd - pos.entryUsd;
    realizedPnlUsd += pnl;
    state.bankrollCashUsd += exitUsd;
    exited += 1;
    events.push({
      ts,
      type: "EXIT",
      positionId: pos.id,
      family_id: pos.family_id,
      marketId: pos.marketId,
      outcome: pos.outcome,
      price: px,
      shares: pos.shares,
      usd: exitUsd,
      realizedPnlUsd: pnl,
      reason:
        move >= cfg.takeProfitMove
          ? "TP"
          : move <= cfg.stopLossMove
            ? "SL"
            : "MAX_HOLD",
      holdHours
    });
  }
  state.positions = remaining;

  // Entry selection (BUY YES only)
  const enteredEvents: PaperTradeEvent[] = [];
  let entered = 0;
  const exposureUsdBefore = exposureUsd(state.positions);
  const nav = state.bankrollCashUsd + exposureUsdBefore;
  const maxExposureUsd = nav * cfg.maxExposurePct;

  // Candidates = top-ranked, positive-score families (prefer bucket).
  const candidates = families
    .filter((f) => typeof f?.opportunity_score === "number" && f.opportunity_score > 0)
    .sort((a, b) => b.opportunity_score - a.opportunity_score);

  for (const f of candidates) {
    if (entered >= cfg.maxNewTradesPerScan) break;
    const family_id: string | undefined = f?.family_id;
    const family_type: "bucket" | "multi" | "single" | undefined = f?.family_type;
    const title: string | undefined = f?.title;
    if (!family_id || !family_type) continue;

    // Cooldown
    const last = state.lastEntryByFamilyId[family_id];
    if (last) {
      const hours = (Date.parse(ts) - Date.parse(last)) / 36e5;
      if (hours < cfg.cooldownHours) continue;
    }

    // Identify a marketId for the trade.
    const pick = pickTradeTarget(f);
    if (!pick) continue;

    const px = getOutcomePrice(pricesSnap, pick.marketId, pick.outcome);
    if (px === null) continue;
    if (!(px > 0.001 && px < 0.999)) continue; // skip extremes

    // Risk constraints
    const curExposure = exposureUsd(state.positions);
    if (curExposure >= maxExposureUsd) continue;

    const tradeUsd = Math.min(cfg.maxTradeUsd, state.bankrollCashUsd);
    if (tradeUsd <= 0) break;

    // Shares = USD / price
    const shares = tradeUsd / px;
    if (!Number.isFinite(shares) || shares <= 0) continue;

    // Enter position
    const posId = crypto.randomUUID();
    const pos: PaperPosition = {
      id: posId,
      family_id,
      family_type,
      marketId: pick.marketId,
      outcome: pick.outcome,
      entryTs: ts,
      entryPrice: px,
      shares,
      entryUsd: tradeUsd
    };
    state.positions.push(pos);
    state.bankrollCashUsd -= tradeUsd;
    state.lastEntryByFamilyId[family_id] = ts;
    entered += 1;

    enteredEvents.push({
      ts,
      type: "ENTRY",
      positionId: posId,
      family_id,
      marketId: pick.marketId,
      outcome: pick.outcome,
      price: px,
      shares,
      usd: tradeUsd,
      reason: `topFamily score=${Number(f.opportunity_score).toFixed(3)}${title ? ` title=${title}` : ""}`
    });
  }

  events.push(...enteredEvents);

  // Persist
  await savePaperState(state);
  await appendPaperEvents(events);

  const exposureUsdAfter = exposureUsd(state.positions);
  const unrealizedAfter = computeUnrealized(state.positions, pricesSnap);

  return {
    ts,
    openPositions: state.positions.length,
    exposureUsd: exposureUsdAfter,
    realizedPnlUsd,
    unrealizedPnlUsd: unrealizedAfter,
    bankrollCashUsd: state.bankrollCashUsd,
    entered,
    exited,
    marked
  };
}

function defaultConfig(): PaperConfig {
  return {
    bankrollStartUsd: 500,
    maxNewTradesPerScan: 2,
    maxTradeUsd: 25,
    maxExposurePct: 0.3,
    cooldownHours: 6,
    takeProfitMove: 0.02,
    stopLossMove: -0.02,
    maxHoldHours: 24
  };
}

function defaultState(cfg: PaperConfig, ts: string): PaperState {
  return {
    version: 1,
    updatedAt: ts,
    bankrollCashUsd: cfg.bankrollStartUsd,
    positions: [],
    lastEntryByFamilyId: {}
  };
}

function exposureUsd(positions: PaperPosition[]): number {
  return positions.reduce((acc, p) => acc + p.entryUsd, 0);
}

function computeUnrealized(positions: PaperPosition[], snap: Awaited<ReturnType<typeof loadPricesSnapshot>>): number {
  let u = 0;
  for (const p of positions) {
    const px = getOutcomePrice(snap, p.marketId, p.outcome);
    if (px === null) continue;
    u += (px - p.entryPrice) * p.shares;
  }
  return u;
}

function pickTradeTarget(f: any): { marketId: string; outcome: string } | null {
  // Prefer bucket: choose first label of the bestCluster (if present) and map back to bucket marketId.
  if (f?.family_type === "bucket" && Array.isArray(f?.buckets)) {
    const clusterLabels: string[] | undefined = Array.isArray(f?.features?.bestCluster?.labels)
      ? f.features.bestCluster.labels
      : undefined;
    const desiredLabel = clusterLabels?.[0];
    const bucket = desiredLabel
      ? f.buckets.find((b: any) => b?.label === desiredLabel)
      : f.buckets[0];
    const marketId = typeof bucket?.marketId === "string" ? bucket.marketId : undefined;
    if (!marketId) return null;
    // Polymarket binary markets use "Yes"/"No"
    return { marketId, outcome: "Yes" };
  }

  // Single: trade that market's "Yes"
  if (f?.family_type === "single" && f?.single?.marketId) {
    return { marketId: String(f.single.marketId), outcome: "Yes" };
  }

  // Multi: not implemented for entries in this MVP (could add "winner" selection later).
  return null;
}

async function safeReadJsonArray<T>(filePath: string): Promise<T[]> {
  try {
    const txt = await readFile(filePath, "utf8");
    const parsed = JSON.parse(txt);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}


