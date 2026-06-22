import path from "node:path";
import crypto from "node:crypto";
import { readFile, writeFile, appendFile } from "node:fs/promises";
import { ensureDir } from "../lib/fs.js";
import type { ClobOrderBook } from "../clients/clob.js";
import type { OrderBooksSnapshot, MarketOrderBookPair } from "../ingest/fetchOrderBooks.js";

export type PaperArbPosition = {
  id: string;
  marketId: string;
  title: string;
  yesTokenId: string;
  noTokenId: string;
  entryTs: string;
  shares: number;
  yesAsk: number;
  noAsk: number;
  feeUsd: number;
  costUsd: number;
  guaranteedPayoutUsd: number;
  lockedProfitUsd: number;
  lastMarkTs?: string;
  lastBidExitUsd?: number;
  lastMarkPnlUsd?: number;
};

export type PaperArbState = {
  version: 1;
  updatedAt: string;
  bankrollCashUsd: number;
  realizedPnlUsd: number;
  positions: PaperArbPosition[];
  lastEntryByMarketId: Record<string, string>;
};

export type PaperArbSummary = {
  ts: string;
  scannedMarkets: number;
  completeBooks: number;
  opportunities: number;
  entered: number;
  exited: number;
  bankrollCashUsd: number;
  realizedPnlUsd: number;
  lockedProfitUsd: number;
  markToBidPnlUsd: number;
  exposureUsd: number;
  openPositionsCount: number;
  newTradesSummary: Array<{
    positionId: string;
    marketId: string;
    title: string;
    shares: number;
    costUsd: number;
    lockedProfitUsd: number;
    edge: number;
  }>;
  openPositionsSummary: Array<{
    positionId: string;
    marketId: string;
    title: string;
    entryTs: string;
    shares: number;
    costUsd: number;
    lockedProfitUsd: number;
    lastMarkPnlUsd: number | null;
  }>;
};

type BundleOpportunity = {
  market: MarketOrderBookPair;
  yesAsk: number;
  noAsk: number;
  yesAskSize: number;
  noAskSize: number;
  shares: number;
  feeUsd: number;
  costUsd: number;
  lockedProfitUsd: number;
  edge: number;
};

type PaperArbEvent =
  | {
      ts: string;
      type: "ENTRY";
      positionId: string;
      marketId: string;
      yesAsk: number;
      noAsk: number;
      shares: number;
      feeUsd: number;
      costUsd: number;
      lockedProfitUsd: number;
      edge: number;
    }
  | {
      ts: string;
      type: "MARK";
      positionId: string;
      marketId: string;
      bidExitUsd: number;
      markPnlUsd: number;
    }
  | {
      ts: string;
      type: "EXIT";
      positionId: string;
      marketId: string;
      exitUsd: number;
      realizedPnlUsd: number;
      reason: string;
    };

export async function runPaperArbitrage(snapshot: OrderBooksSnapshot): Promise<PaperArbSummary> {
  const cfg = paperArbConfig();
  const ts = new Date().toISOString();
  const state = (await loadPaperArbState()) ?? defaultPaperArbState(cfg.bankrollStartUsd, ts);
  state.updatedAt = ts;

  const events: PaperArbEvent[] = [];
  let exited = 0;

  for (const pos of state.positions) {
    const m = snapshot.markets.find((x) => x.marketId === pos.marketId);
    const bidExitUsd = m ? markBidExitUsd(pos, m) : null;
    if (bidExitUsd === null) continue;

    const markPnlUsd = bidExitUsd - pos.costUsd;
    pos.lastMarkTs = ts;
    pos.lastBidExitUsd = bidExitUsd;
    pos.lastMarkPnlUsd = markPnlUsd;
    events.push({ ts, type: "MARK", positionId: pos.id, marketId: pos.marketId, bidExitUsd, markPnlUsd });
  }

  const remaining: PaperArbPosition[] = [];
  for (const pos of state.positions) {
    const ageHours = (Date.parse(ts) - Date.parse(pos.entryTs)) / 36e5;
    const canExitAtProfit = (pos.lastMarkPnlUsd ?? -Infinity) >= cfg.exitProfitUsd;
    if (!canExitAtProfit && ageHours < cfg.maxHoldHours) {
      remaining.push(pos);
      continue;
    }

    const exitUsd = canExitAtProfit ? pos.lastBidExitUsd ?? pos.guaranteedPayoutUsd : pos.guaranteedPayoutUsd;
    const pnl = exitUsd - pos.costUsd;
    state.bankrollCashUsd += exitUsd;
    state.realizedPnlUsd += pnl;
    exited += 1;
    events.push({
      ts,
      type: "EXIT",
      positionId: pos.id,
      marketId: pos.marketId,
      exitUsd,
      realizedPnlUsd: pnl,
      reason: canExitAtProfit ? "BID_EXIT_PROFIT" : "ASSUME_RESOLUTION_PAYOUT"
    });
  }
  state.positions = remaining;

  const opportunities = findBundleLongOpportunities(snapshot, cfg);
  const enteredEvents: Extract<PaperArbEvent, { type: "ENTRY" }>[] = [];

  for (const opp of opportunities) {
    if (enteredEvents.length >= cfg.maxNewTradesPerScan) break;
    if (state.bankrollCashUsd < opp.costUsd) continue;
    if (exposureUsd(state.positions) + opp.costUsd > cfg.maxExposureUsd) continue;

    const last = state.lastEntryByMarketId[opp.market.marketId];
    if (last && (Date.parse(ts) - Date.parse(last)) / 36e5 < cfg.cooldownHours) continue;

    const pos: PaperArbPosition = {
      id: crypto.randomUUID(),
      marketId: opp.market.marketId,
      title: opp.market.title,
      yesTokenId: opp.market.yesTokenId,
      noTokenId: opp.market.noTokenId,
      entryTs: ts,
      shares: opp.shares,
      yesAsk: opp.yesAsk,
      noAsk: opp.noAsk,
      feeUsd: opp.feeUsd,
      costUsd: opp.costUsd,
      guaranteedPayoutUsd: opp.shares,
      lockedProfitUsd: opp.lockedProfitUsd
    };

    state.positions.push(pos);
    state.bankrollCashUsd -= opp.costUsd;
    state.lastEntryByMarketId[opp.market.marketId] = ts;

    enteredEvents.push({
      ts,
      type: "ENTRY",
      positionId: pos.id,
      marketId: pos.marketId,
      yesAsk: opp.yesAsk,
      noAsk: opp.noAsk,
      shares: opp.shares,
      feeUsd: opp.feeUsd,
      costUsd: opp.costUsd,
      lockedProfitUsd: opp.lockedProfitUsd,
      edge: opp.edge
    });
  }
  events.push(...enteredEvents);

  await savePaperArbState(state);
  await appendPaperArbEvents(events);

  const lockedProfitUsd = state.positions.reduce((acc, p) => acc + p.lockedProfitUsd, 0);
  const markToBidPnlUsd = state.positions.reduce((acc, p) => acc + (p.lastMarkPnlUsd ?? 0), 0);

  return {
    ts,
    scannedMarkets: snapshot.markets.length,
    completeBooks: snapshot.markets.filter((m) => m.yes && m.no).length,
    opportunities: opportunities.length,
    entered: enteredEvents.length,
    exited,
    bankrollCashUsd: state.bankrollCashUsd,
    realizedPnlUsd: state.realizedPnlUsd,
    lockedProfitUsd,
    markToBidPnlUsd,
    exposureUsd: exposureUsd(state.positions),
    openPositionsCount: state.positions.length,
    newTradesSummary: enteredEvents.map((e) => {
      const pos = state.positions.find((p) => p.id === e.positionId)!;
      return {
        positionId: e.positionId,
        marketId: e.marketId,
        title: pos.title,
        shares: e.shares,
        costUsd: e.costUsd,
        lockedProfitUsd: e.lockedProfitUsd,
        edge: e.edge
      };
    }),
    openPositionsSummary: state.positions.map((p) => ({
      positionId: p.id,
      marketId: p.marketId,
      title: p.title,
      entryTs: p.entryTs,
      shares: p.shares,
      costUsd: p.costUsd,
      lockedProfitUsd: p.lockedProfitUsd,
      lastMarkPnlUsd: typeof p.lastMarkPnlUsd === "number" ? p.lastMarkPnlUsd : null
    }))
  };
}

function findBundleLongOpportunities(snapshot: OrderBooksSnapshot, cfg: ReturnType<typeof paperArbConfig>): BundleOpportunity[] {
  const out: BundleOpportunity[] = [];
  for (const market of snapshot.markets) {
    if (!market.yes || !market.no) continue;
    const yesAsk = bestAsk(market.yes);
    const noAsk = bestAsk(market.no);
    if (!yesAsk || !noAsk) continue;

    const maxSharesByDepth = Math.min(yesAsk.size, noAsk.size);
    const maxSharesBySpend = cfg.maxTradeUsd / Math.max(yesAsk.price + noAsk.price, 0.001);
    const shares = roundShares(Math.min(maxSharesByDepth, maxSharesBySpend));
    if (shares < cfg.minShares) continue;

    const feeUsd = takerFeeUsd(shares, yesAsk.price, cfg.takerFeeRate) + takerFeeUsd(shares, noAsk.price, cfg.takerFeeRate);
    const costUsd = shares * (yesAsk.price + noAsk.price) + feeUsd;
    const lockedProfitUsd = shares - costUsd;
    const edge = lockedProfitUsd / Math.max(costUsd, 0.001);
    if (lockedProfitUsd < cfg.minProfitUsd || edge < cfg.minEdge) continue;

    out.push({
      market,
      yesAsk: yesAsk.price,
      noAsk: noAsk.price,
      yesAskSize: yesAsk.size,
      noAskSize: noAsk.size,
      shares,
      feeUsd,
      costUsd,
      lockedProfitUsd,
      edge
    });
  }
  return out.sort((a, b) => b.edge - a.edge || b.lockedProfitUsd - a.lockedProfitUsd);
}

function markBidExitUsd(pos: PaperArbPosition, market: MarketOrderBookPair): number | null {
  if (!market.yes || !market.no) return null;
  const yesBid = bestBid(market.yes);
  const noBid = bestBid(market.no);
  if (!yesBid || !noBid) return null;
  const shares = Math.min(pos.shares, yesBid.size, noBid.size);
  return shares * (yesBid.price + noBid.price);
}

function bestAsk(book: ClobOrderBook): { price: number; size: number } | null {
  return book.asks[0] ?? null;
}

function bestBid(book: ClobOrderBook): { price: number; size: number } | null {
  return book.bids[0] ?? null;
}

function takerFeeUsd(shares: number, price: number, feeRate: number): number {
  return shares * feeRate * price * (1 - price);
}

function exposureUsd(positions: PaperArbPosition[]): number {
  return positions.reduce((acc, p) => acc + p.costUsd, 0);
}

function roundShares(x: number): number {
  return Math.floor(x * 100) / 100;
}

function paperArbConfig() {
  return {
    bankrollStartUsd: envNumber("PAPER_ARB_BANKROLL_USD", 500),
    maxNewTradesPerScan: envInt("PAPER_ARB_MAX_NEW_TRADES", 5),
    maxTradeUsd: envNumber("PAPER_ARB_MAX_TRADE_USD", 25),
    maxExposureUsd: envNumber("PAPER_ARB_MAX_EXPOSURE_USD", 250),
    minShares: envNumber("PAPER_ARB_MIN_SHARES", 5),
    minEdge: envNumber("PAPER_ARB_MIN_EDGE", 0.0025),
    minProfitUsd: envNumber("PAPER_ARB_MIN_PROFIT_USD", 0.05),
    exitProfitUsd: envNumber("PAPER_ARB_EXIT_PROFIT_USD", 0.05),
    cooldownHours: envNumber("PAPER_ARB_COOLDOWN_HOURS", 6),
    maxHoldHours: envNumber("PAPER_ARB_MAX_HOLD_HOURS", 24 * 30),
    takerFeeRate: envNumber("PAPER_ARB_TAKER_FEE_RATE", 0.05)
  };
}

function defaultPaperArbState(bankrollStartUsd: number, ts: string): PaperArbState {
  return {
    version: 1,
    updatedAt: ts,
    bankrollCashUsd: bankrollStartUsd,
    realizedPnlUsd: 0,
    positions: [],
    lastEntryByMarketId: {}
  };
}

async function loadPaperArbState(): Promise<PaperArbState | null> {
  try {
    const txt = await readFile(defaultPaperArbStatePath(), "utf8");
    const obj = JSON.parse(txt) as PaperArbState;
    return obj?.version === 1 ? obj : null;
  } catch {
    return null;
  }
}

async function savePaperArbState(state: PaperArbState): Promise<void> {
  const filePath = defaultPaperArbStatePath();
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, JSON.stringify(state, null, 2) + "\n", "utf8");
}

async function appendPaperArbEvents(events: PaperArbEvent[]): Promise<void> {
  if (events.length === 0) return;
  const filePath = path.resolve(process.cwd(), "data/db/paper_arb_trades.jsonl");
  await ensureDir(path.dirname(filePath));
  await appendFile(filePath, events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
}

function defaultPaperArbStatePath(): string {
  return path.resolve(process.cwd(), "data/db/paper_arb_state.json");
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envInt(name: string, fallback: number): number {
  return Math.max(0, Math.trunc(envNumber(name, fallback)));
}
