import { z } from "zod";
import { getJson } from "../lib/http.js";

/**
 * Single-source market discovery client using Polymarket's public Gamma API.
 *
 * Important constraints (explicit):
 * - Read-only only (no auth, no trading, no websockets)
 * - Uses ONE endpoint family: Gamma `/markets` for discovery/metadata
 * - Schema-flexible: we keep the raw JSON verbatim and only *optionally* parse fields via Zod
 */
export class PolymarketGammaClient {
  private readonly baseUrl: string;

  constructor(baseUrl = "https://gamma-api.polymarket.com") {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async fetchMarketsRaw(params?: { limit?: number; offset?: number; active?: boolean; closed?: boolean }): Promise<unknown> {
    const url =
      `${this.baseUrl}/markets` +
      toQuery({
        // Assumption: these params are commonly supported; if ignored, raw JSON is still stored verbatim.
        active: params?.active ?? true,
        closed: params?.closed ?? false,
        limit: params?.limit ?? 200,
        offset: params?.offset ?? 0
      });
    return await getJson<unknown>(url);
  }
}

export type GammaMarketLoose = z.infer<typeof GammaMarketLooseZ>;

/**
 * Loose/optional schema for a single market record.
 * We only parse what we need for normalization (id/question/outcomes/prices),
 * and we allow unknown keys via `.passthrough()`.
 */
export const GammaMarketLooseZ = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    market_id: z.union([z.string(), z.number()]).optional(),
    conditionId: z.string().optional(),
    condition_id: z.string().optional(),

    question: z.string().optional(),
    title: z.string().optional(),
    name: z.string().optional(),
    slug: z.string().optional(),
    url: z.string().optional(),

    event_id: z.union([z.string(), z.number()]).optional(),
    eventId: z.union([z.string(), z.number()]).optional(),

    // Outcomes/prices are not guaranteed; Gamma sometimes returns these as JSON-encoded strings.
    outcomes: z.union([z.array(z.string()), z.string()]).optional(),
    outcomePrices: z.union([z.array(z.union([z.string(), z.number()])), z.string()]).optional(),
    outcome_prices: z.union([z.array(z.union([z.string(), z.number()])), z.string()]).optional(),

    // Many responses embed event metadata under `events: [{ id, title, ... }]`.
    events: z
      .array(
        z
          .object({
            id: z.union([z.string(), z.number()]).optional(),
            title: z.string().optional()
          })
          .passthrough()
      )
      .optional()
    ,
    // Liquidity/volume often appear in numeric or string form.
    liquidityNum: z.number().optional(),
    volumeNum: z.number().optional(),
    liquidity: z.union([z.string(), z.number()]).optional(),
    volume: z.union([z.string(), z.number()]).optional(),
    liquidityClob: z.union([z.string(), z.number()]).optional(),
    volumeClob: z.union([z.string(), z.number()]).optional()
  })
  .passthrough();

/**
 * Extract a market array from the raw `/markets` response.
 * We do NOT mutate the raw JSON; this is only for downstream processing.
 *
 * Assumption: Gamma often returns either:
 * - `Market[]`
 * - `{ data: Market[] }` or `{ markets: Market[] }`
 */
export function extractMarketsArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const candidate =
      (Array.isArray(obj.markets) && obj.markets) ||
      (Array.isArray(obj.data) && obj.data) ||
      (Array.isArray(obj.results) && obj.results);
    if (candidate) return candidate as unknown[];
  }
  return [];
}

export function parseMarketsLoosely(markets: unknown[]): GammaMarketLoose[] {
  const parsed: GammaMarketLoose[] = [];
  for (const m of markets) {
    const r = GammaMarketLooseZ.safeParse(m);
    if (r.success) parsed.push(r.data);
  }
  return parsed;
}

function toQuery(params: Record<string, string | number | boolean | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    usp.set(k, String(v));
  }
  const q = usp.toString();
  return q.length ? `?${q}` : "";
}


