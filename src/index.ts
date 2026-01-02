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

  // Console summary: top 20
  const top = ranked.filter((f) => f.family_type !== "single").slice(0, 20);
  await log.info("");
  await log.info("Scan complete (read-only)");
  await log.info(`Families written: ${outPath}`);
  await log.info("");
  await log.info("Stats:");
  await log.info(
    `- gamma paging: GAMMA_LIMIT=${gammaLimit} GAMMA_PAGE_LIMIT=${gammaPageLimit ?? "unset"} MAX_MARKETS=${maxMarkets ?? "unset"}`
  );
  await log.info(`- gamma pagesFetched=${pagesFetched} stopReason=${stopReason}`);
  await log.info(`- markets fetched (raw): ${rawCount}`);
  await log.info(`- markets parsed (zod): ${marketsLoose.length}`);
  await log.info(
    `- markets normalized kept: ${normStats.keptMarkets} (with outcomes: ${normStats.marketsWithOutcomes}, with prices: ${normStats.marketsWithPrices})`
  );
  await log.info(`- families built: ${families.length}`);
  await log.info(`- bucket families: ${bucketFamilies.length} (with ≥6 valid prices: ${bucketWith6Prices.length})`);
  await log.info(`- persisted rows appended: ${rows.length}`);
  await log.info(`- heartbeat: data/db/last_scan.json`);
  await log.info("");
  await log.info("Top 20 families:");
  for (const f of top) {
    if (f.family_type === "bucket") {
      const over = f.features?.overround;
      const spike = f.features?.maxSpike;
      const cluster = f.features?.bestCluster;
      const liq = f.features?.liquidityMax;
      await log.info(`# score=${f.opportunity_score.toFixed(3)} | BUCKET | ${f.title}`);
      await log.info(
        `  outcomes: ${f.num_outcomes} | overround: ${over === null || over === undefined ? "n/a" : over.toFixed(3)} | maxSpike: ${spike === null || spike === undefined ? "n/a" : spike.toFixed(3)}`
      );
      if (liq !== null && liq !== undefined) await log.info(`  liquidityMax: ${liq.toFixed(0)}`);
      if (cluster)
        await log.info(
          `  bestCluster: [${cluster.labels.join(", ")}] cost=${cluster.cost.toFixed(3)} ratio=${cluster.ratio.toFixed(3)} z=${cluster.z.toFixed(2)}`
        );
      if (f.reasons.length) await log.info(`  why: ${f.reasons.join("; ")}`);
    } else {
      await log.info(
        `# score=${f.opportunity_score.toFixed(3)} | ${f.family_type.toUpperCase()} | outcomes=${f.num_outcomes} | ${f.title}`
      );
      if (f.reasons.length) await log.info(`  why: ${f.reasons.join("; ")}`);
    }
  }
  await log.info("");
  await log.info(`Raw markets: ${path.resolve(process.cwd(), "data/raw/markets_raw.json")}`);
  await log.info(`Raw prices:  ${path.resolve(process.cwd(), "data/raw/prices_raw.json")}`);
  await log.info("");
  await log.flush();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});


