import path from "node:path";
import { writeJsonFile } from "./lib/fs.js";
import { PolymarketGammaClient } from "./clients/polymarket.js";
import { fetchMarkets } from "./ingest/fetchMarkets.js";
import { fetchPrices } from "./ingest/fetchPrices.js";
import { buildFamilies } from "./normalize/buildFamilies.js";
import { scoreFamilies } from "./detect/basicAnomalies.js";
import { rankFamilies } from "./score/rank.js";
import { normalizeGammaMarkets } from "./normalize/normalizeMarkets.js";
import { appendFamilyRows, type PersistedFamilyRow } from "./persist/familyLog.js";
import { createFileLogger } from "./lib/logger.js";
import { writeHeartbeat } from "./persist/heartbeat.js";
import { runPaperTrade } from "./paper/engine.js";
import { writeDashboard, type Dashboard } from "./persist/dashboard.js";
import { fmtNum, fmtUsd, renderTable, truncate } from "./lib/pretty.js";

async function main(): Promise<void> {
  const log = await createFileLogger();
  const client = new PolymarketGammaClient();

  const { raw, marketsLoose, pagesFetched, gammaLimit, gammaPageLimit, maxMarkets, stopReason } = await fetchMarkets(
    client
  );
  const rawCount = raw.length;
  if (rawCount === 0 || marketsLoose.length === 0) {
    await log.error(`FATAL: zero markets fetched/parsed (raw=${rawCount}, parsed=${marketsLoose.length})`);
    process.exitCode = 2;
    return;
  }

  const { markets: normalized, stats: normStats } = normalizeGammaMarkets(marketsLoose);
  await fetchPrices(normalized);

  const families = buildFamilies(normalized);
  if (families.length === 0) {
    await log.error("FATAL: zero families built");
    process.exitCode = 3;
    return;
  }
  const scored = scoreFamilies(families);
  const ranked = rankFamilies(scored);

  // Persist one row per family per scan (local, read-only evaluation log).
  const ts = new Date().toISOString();
  const rows: PersistedFamilyRow[] = scored.map((f) => ({
    ts,
    family_id: f.family_id,
    family_type: f.family_type,
    title: f.title,
    opportunity_score: f.opportunity_score,
    features: {
      overround: f.features?.overround ?? null,
      maxSpike: f.features?.maxSpike ?? null,
      bestClusterZ: f.features?.bestClusterZ ?? null,
      liquidityMax: f.features?.liquidityMax ?? null,
      volumeMax: f.features?.volumeMax ?? null,
      validPrices: f.features?.validPrices ?? null,
      missingPrices: f.features?.missingPrices ?? null
    }
  }));
  await appendFamilyRows(rows);

  const outPath = path.resolve(process.cwd(), "data/out/families.json");
  await writeJsonFile(outPath, ranked);

  const bucketFamilies = scored.filter((f) => f.family_type === "bucket");
  const bucketWith6Prices = bucketFamilies.filter((f) => (f.features?.validPrices ?? 0) >= 6);
  const topScore = ranked.length ? ranked[0]!.opportunity_score : null;
  await writeHeartbeat({
    timestamp: ts,
    fetched: rawCount,
    parsed: marketsLoose.length,
    normalized: normStats.keptMarkets,
    families: families.length,
    bucketFamilies: bucketFamilies.length,
    topScore
  });

  const topRankedNonSingle = ranked.filter((f) => f.family_type !== "single").slice(0, 10);
  const topFamilies = topRankedNonSingle.map((f) => ({
    family_id: f.family_id,
    family_type: f.family_type,
    title: f.title,
    opportunity_score: f.opportunity_score,
    reasons: f.reasons,
    ...(f.family_type === "bucket"
      ? {
          features: {
            overround: f.features?.overround ?? null,
            maxSpike: f.features?.maxSpike ?? null,
            bestClusterZ: f.features?.bestClusterZ ?? null,
            liquidityMax: f.features?.liquidityMax ?? null,
            validPrices: f.features?.validPrices ?? null,
            missingPrices: f.features?.missingPrices ?? null
          }
        }
      : {})
  }));

  const dashboardBase: Dashboard = {
    timestamp: ts,
    scan: {
      fetched: rawCount,
      parsed: marketsLoose.length,
      normalized: normStats.keptMarkets,
      families: families.length,
      bucketFamilies: bucketFamilies.length,
      stopReason,
      pagesFetched,
      limits: {
        GAMMA_LIMIT: gammaLimit,
        GAMMA_PAGE_LIMIT: gammaPageLimit,
        MAX_MARKETS: maxMarkets
      }
    },
    topFamilies
  };

  let paperSummary: Dashboard["paper"] | undefined;

  // Optional paper trading step (must NOT fail the scan).
  if (process.env.PAPER_TRADE === "1") {
    try {
      const summary = await runPaperTrade();
      paperSummary = {
        bankrollCashUsd: summary.bankrollCashUsd,
        realizedPnlUsd: summary.realizedPnlUsd,
        unrealizedPnlUsd: summary.unrealizedPnlUsd,
        openPositionsCount: summary.openPositions,
        exposureUsd: summary.exposureUsd,
        newTradesSummary: summary.newTradesSummary,
        openPositionsSummary: summary.openPositionsSummary
      };
    } catch (e: any) {
      await log.warn(`paper: error (continuing scan): ${e?.message ?? String(e)}`);
    }
  }

  await writeDashboard({ ...dashboardBase, ...(paperSummary ? { paper: paperSummary } : {}) });

  // Clean console/log summary (single block)
  const summaryLines: string[] = [];
  summaryLines.push("=== Vrtl_Trader Scan ===");
  summaryLines.push(`ts: ${ts}`);
  summaryLines.push(
    `gamma: fetched=${rawCount} parsed=${marketsLoose.length} normalized=${normStats.keptMarkets} pages=${pagesFetched} stop=${stopReason}`
  );
  summaryLines.push(
    `limits: GAMMA_LIMIT=${gammaLimit} GAMMA_PAGE_LIMIT=${gammaPageLimit ?? "unset"} MAX_MARKETS=${maxMarkets ?? "unset"}`
  );
  summaryLines.push(
    `families=${families.length} buckets=${bucketFamilies.length} buckets(>=6 prices)=${bucketWith6Prices.length} topScore=${fmtNum(topScore, 3)}`
  );
  summaryLines.push(`outputs: data/out/families.json data/out/dashboard.json`);
  summaryLines.push(`heartbeat: data/db/last_scan.json`);
  if (paperSummary) {
    summaryLines.push(
      `paper: positions=${paperSummary.openPositionsCount} exposure=${fmtUsd(paperSummary.exposureUsd)} cash=${fmtUsd(
        paperSummary.bankrollCashUsd
      )} realized=${fmtUsd(paperSummary.realizedPnlUsd)} unrealized=${fmtUsd(paperSummary.unrealizedPnlUsd)}`
    );
  }
  summaryLines.push("");
  summaryLines.push("Top 10:");
  const tableRows: string[][] = [
    ["rank", "type", "score", "over", "spike", "z", "liq", "title"]
  ];
  for (let i = 0; i < topFamilies.length; i++) {
    const f = topFamilies[i]!;
    tableRows.push([
      String(i + 1),
      f.family_type,
      fmtNum(f.opportunity_score, 3),
      fmtNum(f.features?.overround ?? null, 3),
      fmtNum(f.features?.maxSpike ?? null, 3),
      fmtNum(f.features?.bestClusterZ ?? null, 2),
      fmtNum(f.features?.liquidityMax ?? null, 0),
      truncate(f.title, 60)
    ]);
  }
  summaryLines.push(renderTable(tableRows));

  await log.info(summaryLines.join("\n"));
  await log.flush();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});


