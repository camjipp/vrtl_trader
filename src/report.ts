import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { defaultDbPath, type PersistedFamilyRow } from "./persist/familyLog.js";

type ReportArgs = {
  days: number;
  topN: number;
  threshold: number;
};

function parseArgs(argv: string[]): ReportArgs {
  // Examples:
  //   npm run report -- --days=7 --topN=20 --threshold=0.25
  const args: ReportArgs = { days: 7, topN: 20, threshold: 0.25 };
  for (const raw of argv) {
    if (!raw.startsWith("--")) continue;
    const [k, v] = raw.slice(2).split("=");
    if (!k || v === undefined) continue;
    if (k === "days") args.days = Number(v);
    if (k === "topN") args.topN = Number(v);
    if (k === "threshold") args.threshold = Number(v);
  }
  return args;
}

type Agg = {
  family_id: string;
  family_type: PersistedFamilyRow["family_type"];
  title: string;
  count: number;
  avgScore: number;
  maxScore: number;
  lastTs: string;
};

async function readRowsSince(filePath: string, sinceMs: number): Promise<PersistedFamilyRow[]> {
  if (!fs.existsSync(filePath)) return [];

  const input = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  const rows: PersistedFamilyRow[] = [];
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== "object") continue;
    const r = obj as PersistedFamilyRow;
    const t = Date.parse(r.ts);
    if (!Number.isFinite(t) || t < sinceMs) continue;
    if (!r.family_id || !r.family_type || typeof r.opportunity_score !== "number") continue;
    rows.push(r);
  }
  return rows;
}

function aggregateRecurring(rows: PersistedFamilyRow[]): Agg[] {
  const map = new Map<string, { sum: number; count: number; max: number; lastTs: string; title: string; type: Agg["family_type"] }>();
  for (const r of rows) {
    const cur = map.get(r.family_id);
    const lastTs = !cur || r.ts > cur.lastTs ? r.ts : cur.lastTs;
    const max = !cur ? r.opportunity_score : Math.max(cur.max, r.opportunity_score);
    const sum = (cur?.sum ?? 0) + r.opportunity_score;
    const count = (cur?.count ?? 0) + 1;
    map.set(r.family_id, { sum, count, max, lastTs, title: r.title, type: r.family_type });
  }
  return [...map.entries()].map(([family_id, v]) => ({
    family_id,
    family_type: v.type,
    title: v.title,
    count: v.count,
    avgScore: v.sum / v.count,
    maxScore: v.max,
    lastTs: v.lastTs
  }));
}

function avgScoreByType(rows: PersistedFamilyRow[]): Array<{ family_type: PersistedFamilyRow["family_type"]; avg: number; n: number }> {
  const by = new Map<PersistedFamilyRow["family_type"], { sum: number; n: number }>();
  for (const r of rows) {
    const cur = by.get(r.family_type) ?? { sum: 0, n: 0 };
    cur.sum += r.opportunity_score;
    cur.n += 1;
    by.set(r.family_type, cur);
  }
  return (["bucket", "multi", "single"] as const).map((t) => {
    const v = by.get(t) ?? { sum: 0, n: 0 };
    return { family_type: t, avg: v.n ? v.sum / v.n : 0, n: v.n };
  });
}

function groupByScan(rows: PersistedFamilyRow[]): Map<string, PersistedFamilyRow[]> {
  const byTs = new Map<string, PersistedFamilyRow[]>();
  for (const r of rows) {
    const arr = byTs.get(r.ts) ?? [];
    arr.push(r);
    byTs.set(r.ts, arr);
  }
  return new Map([...byTs.entries()].sort((a, b) => Date.parse(a[0]) - Date.parse(b[0])));
}

function computePersistenceHours(args: { scans: Map<string, PersistedFamilyRow[]>; topN: number; threshold: number }): {
  samples: number;
  avgHours: number;
  medianHours: number;
} {
  const scanTimes = [...args.scans.keys()].sort((a, b) => Date.parse(a) - Date.parse(b));
  if (scanTimes.length < 2) return { samples: 0, avgHours: 0, medianHours: 0 };

  const durationsHrs: number[] = [];

  // For each scan, take topN families by score, then measure how long until that family
  // falls below threshold or disappears.
  for (let s = 0; s < scanTimes.length; s++) {
    const ts0 = scanTimes[s]!;
    const rows0 = args.scans.get(ts0)!;
    const top = rows0
      .slice()
      .sort((a, b) => b.opportunity_score - a.opportunity_score)
      .slice(0, args.topN);

    for (const r0 of top) {
      const t0 = Date.parse(ts0);
      let endMs: number | null = null;
      for (let s2 = s + 1; s2 < scanTimes.length; s2++) {
        const ts = scanTimes[s2]!;
        const rows = args.scans.get(ts)!;
        const match = rows.find((x) => x.family_id === r0.family_id);
        const score = match?.opportunity_score ?? -Infinity;
        if (!(score >= args.threshold)) {
          endMs = Date.parse(ts);
          break;
        }
      }
      if (endMs !== null) durationsHrs.push((endMs - t0) / 36e5);
    }
  }

  if (durationsHrs.length === 0) return { samples: 0, avgHours: 0, medianHours: 0 };
  const avgHours = durationsHrs.reduce((a, b) => a + b, 0) / durationsHrs.length;
  const sorted = durationsHrs.slice().sort((a, b) => a - b);
  const medianHours = sorted[Math.floor(sorted.length / 2)]!;
  return { samples: durationsHrs.length, avgHours, medianHours };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const filePath = defaultDbPath();

  const now = Date.now();
  const sinceMs = now - args.days * 24 * 60 * 60 * 1000;
  const rows = await readRowsSince(filePath, sinceMs);

  console.log("");
  console.log("Report (local, read-only)");
  console.log(`DB: ${filePath}`);
  console.log(`Window: last ${args.days} day(s) | rows: ${rows.length}`);
  console.log("");

  // (1) Top recurring families
  const recurring = aggregateRecurring(rows)
    .sort((a, b) => b.count - a.count || b.avgScore - a.avgScore)
    .slice(0, 20);

  console.log("Top recurring families (last window):");
  for (const r of recurring) {
    console.log(
      `- seen=${r.count} | avg=${r.avgScore.toFixed(3)} | max=${r.maxScore.toFixed(3)} | ${r.family_type.toUpperCase()} | ${r.title} | ${r.family_id}`
    );
  }
  console.log("");

  // (2) Average score by family_type
  console.log("Average score by family_type:");
  for (const x of avgScoreByType(rows)) {
    console.log(`- ${x.family_type}: avg=${x.avg.toFixed(3)} (n=${x.n})`);
  }
  console.log("");

  // (3) Persistence of top-N edges
  const scans = groupByScan(rows);
  const persistence = computePersistenceHours({ scans, topN: args.topN, threshold: args.threshold });

  console.log("Top-edge persistence (heuristic):");
  console.log(`- definition: for each scan’s top ${args.topN}, time until score < ${args.threshold} or disappears`);
  console.log(`- samples: ${persistence.samples}`);
  console.log(`- avg: ${persistence.avgHours.toFixed(2)} hours | median: ${persistence.medianHours.toFixed(2)} hours`);
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});


