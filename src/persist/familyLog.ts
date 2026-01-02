import path from "node:path";
import { appendFile } from "node:fs/promises";
import { ensureDir } from "../lib/fs.js";

export type PersistedFamilyRow = {
  ts: string; // ISO timestamp for the scan run
  family_id: string;
  family_type: "bucket" | "multi" | "single";
  title: string;
  opportunity_score: number;
  features: {
    overround: number | null;
    maxSpike: number | null;
    bestClusterZ: number | null;
    liquidityMax: number | null;
    volumeMax: number | null;
    validPrices: number | null;
    missingPrices: number | null;
  };
};

export function defaultDbPath(): string {
  return path.resolve(process.cwd(), "data/db/family_scores.jsonl");
}

export async function appendFamilyRows(rows: PersistedFamilyRow[], filePath = defaultDbPath()): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const payload = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  await appendFile(filePath, payload, "utf8");
}


