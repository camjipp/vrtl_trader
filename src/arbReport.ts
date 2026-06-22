import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fmtNum, fmtUsd, renderTable, truncate } from "./lib/pretty.js";

type ArbEvent = {
  ts: string;
  type: "ENTRY" | "MARK" | "EXIT";
  positionId?: string;
  marketId?: string;
  costUsd?: number;
  lockedProfitUsd?: number;
  edge?: number;
  realizedPnlUsd?: number;
  markPnlUsd?: number;
};

export type ArbReport = {
  generatedAt: string;
  eventsPath: string;
  statePath: string;
  totals: {
    entries: number;
    marks: number;
    exits: number;
    realizedPnlUsd: number;
    lockedProfitEnteredUsd: number;
    avgEdge: number | null;
    avgCostUsd: number | null;
    bestEdge: number | null;
    worstMarkPnlUsd: number | null;
  };
  state: {
    bankrollCashUsd: number | null;
    realizedPnlUsd: number | null;
    openPositionsCount: number;
    exposureUsd: number;
    lockedProfitUsd: number;
    markToBidPnlUsd: number;
  };
  recentEntries: ArbEvent[];
  recentExits: ArbEvent[];
};

export function defaultArbEventsPath(): string {
  return path.resolve(process.cwd(), "data/db/paper_arb_trades.jsonl");
}

export function defaultArbStatePath(): string {
  return path.resolve(process.cwd(), "data/db/paper_arb_state.json");
}

export async function buildArbReport(args: { eventsPath?: string; statePath?: string } = {}): Promise<ArbReport> {
  const eventsPath = args.eventsPath ?? defaultArbEventsPath();
  const statePath = args.statePath ?? defaultArbStatePath();
  const events = await readEvents(eventsPath);
  const entries = events.filter((e) => e.type === "ENTRY");
  const marks = events.filter((e) => e.type === "MARK");
  const exits = events.filter((e) => e.type === "EXIT");
  const state = await readState(statePath);

  const edges = entries.map((e) => e.edge).filter(isFiniteNumber);
  const costs = entries.map((e) => e.costUsd).filter(isFiniteNumber);
  const markPnls = marks.map((e) => e.markPnlUsd).filter(isFiniteNumber);

  return {
    generatedAt: new Date().toISOString(),
    eventsPath,
    statePath,
    totals: {
      entries: entries.length,
      marks: marks.length,
      exits: exits.length,
      realizedPnlUsd: sum(exits.map((e) => e.realizedPnlUsd).filter(isFiniteNumber)),
      lockedProfitEnteredUsd: sum(entries.map((e) => e.lockedProfitUsd).filter(isFiniteNumber)),
      avgEdge: edges.length ? sum(edges) / edges.length : null,
      avgCostUsd: costs.length ? sum(costs) / costs.length : null,
      bestEdge: edges.length ? Math.max(...edges) : null,
      worstMarkPnlUsd: markPnls.length ? Math.min(...markPnls) : null
    },
    state: summarizeState(state),
    recentEntries: entries.slice(-10).reverse(),
    recentExits: exits.slice(-10).reverse()
  };
}

async function readEvents(filePath: string): Promise<ArbEvent[]> {
  if (!fs.existsSync(filePath)) return [];
  const input = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const events: ArbEvent[] = [];

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as ArbEvent;
      if (obj && typeof obj.ts === "string" && typeof obj.type === "string") events.push(obj);
    } catch {
      continue;
    }
  }

  return events;
}

async function readState(filePath: string): Promise<any | null> {
  try {
    return JSON.parse(await fs.promises.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function summarizeState(state: any): ArbReport["state"] {
  const positions = Array.isArray(state?.positions) ? state.positions : [];
  return {
    bankrollCashUsd: isFiniteNumber(state?.bankrollCashUsd) ? state.bankrollCashUsd : null,
    realizedPnlUsd: isFiniteNumber(state?.realizedPnlUsd) ? state.realizedPnlUsd : null,
    openPositionsCount: positions.length,
    exposureUsd: sum(positions.map((p: any) => p?.costUsd).filter(isFiniteNumber)),
    lockedProfitUsd: sum(positions.map((p: any) => p?.lockedProfitUsd).filter(isFiniteNumber)),
    markToBidPnlUsd: sum(positions.map((p: any) => p?.lastMarkPnlUsd).filter(isFiniteNumber))
  };
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function sum(xs: number[]): number {
  return xs.reduce((acc, x) => acc + x, 0);
}

async function main(): Promise<void> {
  const report = await buildArbReport();

  console.log("");
  console.log("=== Paper Arb Report ===");
  console.log(`generated: ${report.generatedAt}`);
  console.log(`events: ${report.eventsPath}`);
  console.log(`state: ${report.statePath}`);
  console.log("");
  console.log(
    `entries=${report.totals.entries} exits=${report.totals.exits} marks=${report.totals.marks} realized=${fmtUsd(
      report.totals.realizedPnlUsd
    )} lockedEntered=${fmtUsd(report.totals.lockedProfitEnteredUsd)} avgEdge=${fmtNum(
      report.totals.avgEdge === null ? null : report.totals.avgEdge * 100,
      2
    )}% avgCost=${fmtUsd(report.totals.avgCostUsd)}`
  );
  console.log(
    `cash=${fmtUsd(report.state.bankrollCashUsd)} open=${report.state.openPositionsCount} exposure=${fmtUsd(
      report.state.exposureUsd
    )} lockedOpen=${fmtUsd(report.state.lockedProfitUsd)} markPnL=${fmtUsd(report.state.markToBidPnlUsd)}`
  );

  if (report.recentEntries.length) {
    console.log("");
    console.log("Recent entries:");
    const rows = [["ts", "market", "cost", "locked", "edge"]];
    for (const e of report.recentEntries) {
      rows.push([
        truncate(e.ts, 19),
        truncate(String(e.marketId ?? ""), 12),
        fmtUsd(e.costUsd ?? null),
        fmtUsd(e.lockedProfitUsd ?? null),
        `${fmtNum(isFiniteNumber(e.edge) ? e.edge * 100 : null, 2)}%`
      ]);
    }
    console.log(renderTable(rows));
  }

  console.log("");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
