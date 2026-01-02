import path from "node:path";
import { writeJsonFile } from "../lib/fs.js";

export type ScanHeartbeat = {
  timestamp: string;
  fetched: number;
  parsed: number;
  normalized: number;
  families: number;
  bucketFamilies: number;
  topScore: number | null;
};

export function defaultHeartbeatPath(): string {
  return path.resolve(process.cwd(), "data/db/last_scan.json");
}

export async function writeHeartbeat(hb: ScanHeartbeat, filePath = defaultHeartbeatPath()): Promise<void> {
  await writeJsonFile(filePath, hb);
}


