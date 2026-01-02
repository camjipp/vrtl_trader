import path from "node:path";
import { readFile, writeFile, appendFile } from "node:fs/promises";
import { ensureDir } from "../lib/fs.js";
import type { PaperState, PaperTradeEvent } from "./types.js";

export function defaultPaperStatePath(): string {
  return path.resolve(process.cwd(), "data/db/paper_state.json");
}

export function defaultPaperTradesPath(): string {
  return path.resolve(process.cwd(), "data/db/paper_trades.jsonl");
}

export async function loadPaperState(filePath = defaultPaperStatePath()): Promise<PaperState | null> {
  try {
    const txt = await readFile(filePath, "utf8");
    const obj = JSON.parse(txt) as PaperState;
    if (!obj || obj.version !== 1) return null;
    return obj;
  } catch {
    return null;
  }
}

export async function savePaperState(state: PaperState, filePath = defaultPaperStatePath()): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, JSON.stringify(state, null, 2) + "\n", "utf8");
}

export async function appendPaperEvents(
  events: PaperTradeEvent[],
  filePath = defaultPaperTradesPath()
): Promise<void> {
  if (events.length === 0) return;
  await ensureDir(path.dirname(filePath));
  const payload = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  await appendFile(filePath, payload, "utf8");
}


