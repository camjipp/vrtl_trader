import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { buildArbReport } from "../arbReport.js";

const root = process.cwd();
const staticDir = path.resolve(root, "src/ui/static");

const routes: Record<string, string> = {
  "/api/dashboard": path.resolve(root, "data/out/dashboard.json"),
  "/api/last-scan": path.resolve(root, "data/db/last_scan.json"),
  "/api/paper-arb-state": path.resolve(root, "data/db/paper_arb_state.json")
};

async function main(): Promise<void> {
  const port = Number(process.env.DASHBOARD_PORT ?? 8787);
  const server = http.createServer((req, res) => {
    void handle(req, res);
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`Dashboard: http://127.0.0.1:${port}`);
  });
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  try {
    if (req.method !== "GET") {
      send(res, 405, "text/plain", "Method not allowed");
      return;
    }

    if (url.pathname === "/api/arb-report") {
      sendJson(res, await buildArbReport());
      return;
    }

    const dataPath = routes[url.pathname];
    if (dataPath) {
      send(res, 200, "application/json", await safeReadJsonText(dataPath));
      return;
    }

    const filePath = resolveStatic(url.pathname === "/" ? "/index.html" : url.pathname);
    if (!filePath) {
      send(res, 404, "text/plain", "Not found");
      return;
    }

    const body = await readFile(filePath);
    send(res, 200, contentType(filePath), body);
  } catch (e: any) {
    send(res, 500, "text/plain", e?.message ?? String(e));
  }
}

function resolveStatic(pathname: string): string | null {
  const decoded = decodeURIComponent(pathname);
  const filePath = path.resolve(staticDir, decoded.replace(/^\/+/, ""));
  if (!filePath.startsWith(staticDir)) return null;
  return filePath;
}

async function safeReadJsonText(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return JSON.stringify(null);
  }
}

function sendJson(res: http.ServerResponse, data: unknown): void {
  send(res, 200, "application/json", JSON.stringify(data, null, 2));
}

function send(res: http.ServerResponse, status: number, type: string, body: string | Buffer): void {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store"
  });
  res.end(body);
}

function contentType(filePath: string): string {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
