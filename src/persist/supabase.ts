import { readFile } from "node:fs/promises";
import type { Dashboard } from "./dashboard.js";
import type { PaperArbSummary } from "../paper/arb.js";

type SupabaseConfig = {
  url: string;
  key: string;
  workerId: string;
};

export type SupabaseScanPayload = {
  dashboard: Dashboard;
  paperArbSummary?: PaperArbSummary;
};

export function getSupabaseConfig(): SupabaseConfig | null {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY;
  if (!url || !key) return null;
  return {
    url,
    key,
    workerId: process.env.BOT_WORKER_ID ?? "local"
  };
}

export async function syncScanToSupabase(payload: SupabaseScanPayload): Promise<void> {
  const cfg = getSupabaseConfig();
  if (!cfg) return;

  const { dashboard, paperArbSummary } = payload;
  await insertRows(cfg, "bot_scans", [
    {
      ts: dashboard.timestamp,
      venue: "polymarket",
      fetched: dashboard.scan.fetched,
      parsed: dashboard.scan.parsed,
      normalized: dashboard.scan.normalized,
      families: dashboard.scan.families,
      bucket_families: dashboard.scan.bucketFamilies,
      bucket_families_with_6_valid_prices: dashboard.scan.bucketFamiliesWith6ValidPrices,
      pages_fetched: dashboard.scan.pagesFetched,
      stop_reason: dashboard.scan.stopReason,
      top_score: dashboard.topFamilies[0]?.opportunity_score ?? null,
      limits: dashboard.scan.limits,
      warnings: dashboard.warnings,
      top_families: dashboard.topFamilies,
      paper_arb: dashboard.paperArb ?? null
    }
  ]);

  if (paperArbSummary) {
    await syncPaperArb(cfg, paperArbSummary);
  }

  if (dashboard.sportsSignals?.length) {
    await insertRows(
      cfg,
      "arb_opportunities",
      dashboard.sportsSignals.slice(0, 50).map((s) => ({
        ts: s.ts,
        venue: "polymarket",
        strategy: `sports_${s.kind}`,
        market_id: s.groupKey,
        title: s.title,
        cost_usd: s.cost ?? null,
        locked_profit_usd: s.kind === "outright_underround" ? s.edge : null,
        edge: s.edge,
        payload: s
      }))
    );
  }

  await insertRows(cfg, "bot_heartbeats", [
    {
      ts: dashboard.timestamp,
      worker_id: cfg.workerId,
      mode: process.env.PAPER_ARB === "1" ? "paper_arb" : "scan",
      status: "ok",
      message: "scan complete",
      payload: {
        fetched: dashboard.scan.fetched,
        families: dashboard.scan.families,
        opportunities: dashboard.paperArb?.opportunities ?? null
      }
    }
  ]);
}

async function syncPaperArb(cfg: SupabaseConfig, summary: PaperArbSummary): Promise<void> {
  if (summary.newTradesSummary.length > 0) {
    await upsertRows(
      cfg,
      "paper_arb_trades",
      summary.newTradesSummary.map((t) => ({
        source_event_id: sourceEventId(summary.ts, "ENTRY", t.positionId, t.marketId),
        ts: summary.ts,
        event_type: "ENTRY",
        position_id: t.positionId,
        venue: "polymarket",
        market_id: t.marketId,
        title: t.title,
        shares: t.shares,
        cost_usd: t.costUsd,
        locked_profit_usd: t.lockedProfitUsd,
        edge: t.edge,
        payload: t
      })),
      "source_event_id"
    );

    await insertRows(
      cfg,
      "arb_opportunities",
      summary.newTradesSummary.map((t) => ({
        ts: summary.ts,
        venue: "polymarket",
        strategy: "bundle_yes_no_long",
        market_id: t.marketId,
        title: t.title,
        shares: t.shares,
        cost_usd: t.costUsd,
        locked_profit_usd: t.lockedProfitUsd,
        edge: t.edge,
        payload: t
      }))
    );
  }

  await upsertRows(
    cfg,
    "paper_arb_positions",
    summary.openPositionsSummary.map((p) => ({
      position_id: p.positionId,
      venue: "polymarket",
      market_id: p.marketId,
      title: p.title,
      entry_ts: p.entryTs,
      shares: p.shares,
      cost_usd: p.costUsd,
      locked_profit_usd: p.lockedProfitUsd,
      last_mark_pnl_usd: p.lastMarkPnlUsd,
      status: "open",
      payload: p,
      updated_at: summary.ts
    })),
    "position_id"
  );

  await syncPaperArbEventsFromJsonl(cfg);
}

async function syncPaperArbEventsFromJsonl(cfg: SupabaseConfig): Promise<void> {
  // Best-effort backfill for MARK/EXIT rows. This stays simple for now; duplicate
  // rows are acceptable in early paper mode because position state is authoritative.
  const filePath = "data/db/paper_arb_trades.jsonl";
  let txt: string;
  try {
    txt = await readFile(filePath, "utf8");
  } catch {
    return;
  }

  const events = txt
    .trim()
    .split("\n")
    .slice(-100)
    .map((line) => {
      try {
        return JSON.parse(line) as any;
      } catch {
        return null;
      }
    })
    .filter((x) => x && (x.type === "MARK" || x.type === "EXIT"));

  if (events.length === 0) return;
  await upsertRows(
    cfg,
    "paper_arb_trades",
    events.map((e) => ({
      source_event_id: sourceEventId(e.ts, e.type, e.positionId, e.marketId),
      ts: e.ts,
      event_type: e.type,
      position_id: e.positionId ?? null,
      venue: "polymarket",
      market_id: e.marketId ?? null,
      realized_pnl_usd: e.realizedPnlUsd ?? null,
      mark_pnl_usd: e.markPnlUsd ?? null,
      payload: e
    })),
    "source_event_id"
  );
}

function sourceEventId(ts: string, type: string, positionId?: string, marketId?: string): string {
  return ["paper-arb", ts, type, positionId ?? "", marketId ?? ""].join(":");
}

async function insertRows(cfg: SupabaseConfig, table: string, rows: unknown[]): Promise<void> {
  if (rows.length === 0) return;
  await restWrite(cfg, table, rows, "POST");
}

async function upsertRows(cfg: SupabaseConfig, table: string, rows: unknown[], onConflict: string): Promise<void> {
  if (rows.length === 0) return;
  await restWrite(cfg, `${table}?on_conflict=${encodeURIComponent(onConflict)}`, rows, "POST", {
    Prefer: "resolution=merge-duplicates"
  });
}

async function restWrite(
  cfg: SupabaseConfig,
  tableOrPath: string,
  rows: unknown[],
  method: "POST",
  headers: Record<string, string> = {}
): Promise<void> {
  const res = await fetch(`${cfg.url}/rest/v1/${tableOrPath}`, {
    method,
    headers: {
      apikey: cfg.key,
      authorization: `Bearer ${cfg.key}`,
      "content-type": "application/json",
      Prefer: "return=minimal",
      ...headers
    },
    body: JSON.stringify(rows)
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Supabase ${res.status} ${tableOrPath}: ${body.slice(0, 500)}`);
  }
}
