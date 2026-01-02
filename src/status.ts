import path from "node:path";
import { readFile } from "node:fs/promises";
import { renderTable, fmtNum, fmtUsd, truncate } from "./lib/pretty.js";

async function main(): Promise<void> {
  const lastScanPath = path.resolve(process.cwd(), "data/db/last_scan.json");
  const dashboardPath = path.resolve(process.cwd(), "data/out/dashboard.json");

  const lastScan = await safeReadJson<any>(lastScanPath);
  const dashboard = await safeReadJson<any>(dashboardPath);

  console.log("");
  console.log("=== Status ===");
  console.log(`last_scan: ${lastScanPath}`);
  if (lastScan) {
    console.log(
      `ts=${lastScan.timestamp} fetched=${lastScan.fetched} parsed=${lastScan.parsed} normalized=${lastScan.normalized} families=${lastScan.families} bucketFamilies=${lastScan.bucketFamilies} topScore=${fmtNum(lastScan.topScore, 3)}`
    );
  } else {
    console.log("missing last_scan.json (run scan first)");
  }

  console.log("");
  console.log(`dashboard: ${dashboardPath}`);
  if (!dashboard) {
    console.log("missing dashboard.json (run scan first)");
    console.log("");
    return;
  }

  console.log(`ts=${dashboard.timestamp}`);
  if (dashboard.scan) {
    console.log(
      `scan: fetched=${dashboard.scan.fetched} parsed=${dashboard.scan.parsed} normalized=${dashboard.scan.normalized} families=${dashboard.scan.families} bucketFamilies=${dashboard.scan.bucketFamilies} stopReason=${dashboard.scan.stopReason}`
    );
  }

  const top = Array.isArray(dashboard.topFamilies) ? dashboard.topFamilies.slice(0, 10) : [];
  console.log("");
  console.log("Top 10 (dashboard):");
  const rows: string[][] = [["rank", "type", "score", "over", "spike", "z", "liq", "title"]];
  for (let i = 0; i < top.length; i++) {
    const f = top[i];
    rows.push([
      String(i + 1),
      String(f.family_type ?? ""),
      fmtNum(Number(f.opportunity_score), 3),
      fmtNum(f.features?.overround ?? null, 3),
      fmtNum(f.features?.maxSpike ?? null, 3),
      fmtNum(f.features?.bestClusterZ ?? null, 2),
      fmtNum(f.features?.liquidityMax ?? null, 0),
      truncate(String(f.title ?? ""), 60)
    ]);
  }
  console.log(renderTable(rows));

  if (dashboard.paper) {
    console.log("");
    console.log("Paper:");
    console.log(
      `positions=${dashboard.paper.openPositionsCount} exposure=${fmtUsd(dashboard.paper.exposureUsd)} cash=${fmtUsd(dashboard.paper.bankrollCashUsd)} realized=${fmtUsd(dashboard.paper.realizedPnlUsd)} unrealized=${fmtUsd(dashboard.paper.unrealizedPnlUsd)}`
    );

    const open = Array.isArray(dashboard.paper.openPositionsSummary) ? dashboard.paper.openPositionsSummary : [];
    if (open.length) {
      console.log("");
      console.log("Open positions:");
      const pr: string[][] = [["id", "family", "market", "outcome", "entry", "entryPx", "markPx", "usd"]];
      for (const p of open.slice(0, 25)) {
        pr.push([
          truncate(String(p.positionId ?? ""), 12),
          truncate(String(p.family_id ?? ""), 22),
          truncate(String(p.marketId ?? ""), 10),
          String(p.outcome ?? ""),
          truncate(String(p.entryTs ?? ""), 19),
          fmtNum(p.entryPrice ?? null, 4),
          fmtNum(p.lastMarkPrice ?? null, 4),
          fmtUsd(p.entryUsd ?? null)
        ]);
      }
      console.log(renderTable(pr));
    }
  }

  console.log("");
}

async function safeReadJson<T>(filePath: string): Promise<T | null> {
  try {
    const txt = await readFile(filePath, "utf8");
    return JSON.parse(txt) as T;
  } catch {
    return null;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});


