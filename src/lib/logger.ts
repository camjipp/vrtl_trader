import path from "node:path";
import { appendFile } from "node:fs/promises";
import { ensureDir } from "./fs.js";

export type Logger = {
  info: (msg: string) => Promise<void>;
  warn: (msg: string) => Promise<void>;
  error: (msg: string) => Promise<void>;
  flush: () => Promise<void>;
};

export async function createFileLogger(opts?: { logFile?: string }): Promise<Logger> {
  const logFile = opts?.logFile ?? path.resolve(process.cwd(), "logs/scan.log");
  await ensureDir(path.dirname(logFile));

  // Serialize appends so multiple rapid writes stay in order.
  let chain = Promise.resolve();

  async function write(level: "INFO" | "WARN" | "ERROR", msg: string): Promise<void> {
    const line = `${new Date().toISOString()} ${level} ${msg}\n`;

    // Console output is still valuable for cron / systemd logs.
    if (level === "ERROR") console.error(msg);
    else if (level === "WARN") console.warn(msg);
    else console.log(msg);

    chain = chain.then(() => appendFile(logFile, line, "utf8"));
    await chain;
  }

  return {
    info: (msg) => write("INFO", msg),
    warn: (msg) => write("WARN", msg),
    error: (msg) => write("ERROR", msg),
    flush: async () => {
      await chain;
    }
  };
}


