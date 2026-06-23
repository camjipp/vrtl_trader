import type { NormalizedMarket } from "../normalize/normalizeMarkets.js";

export type SportsSignal = {
  ts: string;
  kind: "outright_underround" | "outright_overround" | "ladder_violation" | "ladder_near_miss";
  sport: string;
  groupKey: string;
  title: string;
  score: number;
  edge: number;
  cost?: number;
  payout?: number;
  markets: Array<{
    marketId: string;
    title: string;
    yes_price: number | null;
    yesTokenId?: string;
  }>;
  reason: string;
};

type ParsedTotal = {
  sport: string;
  eventKey: string;
  side: "over" | "under";
  line: number;
};

export function detectSportsSignals(markets: NormalizedMarket[], ts = new Date().toISOString()): SportsSignal[] {
  const signals: SportsSignal[] = [];
  signals.push(...detectOutrightSignals(markets, ts));
  signals.push(...detectTotalLadders(markets, ts));
  return signals.sort((a, b) => b.score - a.score).slice(0, 50);
}

function detectOutrightSignals(markets: NormalizedMarket[], ts: string): SportsSignal[] {
  const groups = new Map<string, NormalizedMarket[]>();
  for (const m of markets) {
    const parsed = parseOutrightWinner(m.title);
    if (!parsed || !isValidProb(m.yes_price)) continue;
    const key = `${parsed.sport}:${parsed.competition}`;
    const arr = groups.get(key) ?? [];
    arr.push(m);
    groups.set(key, arr);
  }

  const out: SportsSignal[] = [];
  for (const [key, members] of groups.entries()) {
    if (members.length < 4) continue;
    const cost = members.reduce((acc, m) => acc + (m.yes_price ?? 0), 0);
    const underEdge = 1 - cost;
    const overEdge = cost - 1;
    const [sport, competition] = key.split(":");

    if (underEdge > 0.005) {
      out.push({
        ts,
        kind: "outright_underround",
        sport: sport ?? "sports",
        groupKey: key,
        title: `${competition} outright underround`,
        score: clamp01(underEdge),
        edge: underEdge,
        cost,
        payout: 1,
        markets: members.map(signalMarket),
        reason: `Buy all mutually exclusive outcomes for ${cost.toFixed(3)} to cover $1 payout`
      });
      continue;
    }

    // Overround is not a direct buy-all arb, but it is a useful structural signal
    // for shorts/synthetic sells/relative-value analysis.
    if (overEdge > 0.005) {
      out.push({
        ts,
        kind: "outright_overround",
        sport: sport ?? "sports",
        groupKey: key,
        title: `${competition} outright overround`,
        score: clamp01(overEdge * 4),
        edge: overEdge,
        cost,
        payout: 1,
        markets: members.map(signalMarket),
        reason: `Mutually exclusive YES prices sum to ${cost.toFixed(3)}`
      });
    }
  }
  return out;
}

function detectTotalLadders(markets: NormalizedMarket[], ts: string): SportsSignal[] {
  const groups = new Map<string, Array<NormalizedMarket & { parsedTotal: ParsedTotal }>>();
  for (const m of markets) {
    const parsedTotal = parseTotalLine(m.title);
    if (!parsedTotal || !isValidProb(m.yes_price)) continue;
    const key = `${parsedTotal.sport}:${parsedTotal.eventKey}:${parsedTotal.side}`;
    const arr = groups.get(key) ?? [];
    arr.push(Object.assign(m, { parsedTotal }));
    groups.set(key, arr);
  }

  const out: SportsSignal[] = [];
  for (const [key, rows] of groups.entries()) {
    if (rows.length < 2) continue;
    const sorted = rows.slice().sort((a, b) => a.parsedTotal.line - b.parsedTotal.line);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const cur = sorted[i]!;
      const prevP = prev.yes_price!;
      const curP = cur.yes_price!;
      const side = cur.parsedTotal.side;

      // Over lower line should be >= over higher line.
      // Under lower line should be <= under higher line.
      const violation = side === "over" ? curP - prevP : prevP - curP;
      const nearMiss = side === "over" ? prevP - curP : curP - prevP;

      if (violation > 0.002) {
        out.push({
          ts,
          kind: "ladder_violation",
          sport: cur.parsedTotal.sport,
          groupKey: key,
          title: `${side.toUpperCase()} ladder violation`,
          score: clamp01(violation * 10),
          edge: violation,
          markets: [signalMarket(prev), signalMarket(cur)],
          reason:
            side === "over"
              ? `${cur.title} priced above easier lower line ${prev.title}`
              : `${prev.title} priced above easier higher under line ${cur.title}`
        });
      } else if (nearMiss >= 0 && nearMiss < 0.01) {
        out.push({
          ts,
          kind: "ladder_near_miss",
          sport: cur.parsedTotal.sport,
          groupKey: key,
          title: `${side.toUpperCase()} ladder near-miss`,
          score: clamp01((0.01 - nearMiss) * 3),
          edge: 0.01 - nearMiss,
          markets: [signalMarket(prev), signalMarket(cur)],
          reason: `Adjacent ${side} totals are only ${(nearMiss * 100).toFixed(2)} points apart`
        });
      }
    }
  }
  return out;
}

function parseOutrightWinner(title: string): { sport: string; competition: string; team: string } | null {
  const t = clean(title);
  const worldCup = t.match(/^will (?<team>.+?) win the (?<year>20\d{2}) fifa world cup\??$/i);
  if (worldCup?.groups?.team && worldCup.groups.year) {
    return {
      sport: "soccer",
      competition: `${worldCup.groups.year} FIFA World Cup`,
      team: worldCup.groups.team.trim()
    };
  }

  const generic = t.match(/^will (?<team>.+?) win the (?<competition>.+?)\??$/i);
  if (!generic?.groups?.team || !generic.groups.competition) return null;
  const competition = generic.groups.competition.trim();
  if (!/\b(world cup|nba|nfl|mlb|nhl|championship|tournament|league|cup)\b/i.test(competition)) return null;
  return {
    sport: inferSport(competition),
    competition,
    team: generic.groups.team.trim()
  };
}

function parseTotalLine(title: string): ParsedTotal | null {
  const t = clean(title);
  const m = t.match(/\b(?<side>over|under)\s+(?<line>\d+(?:\.\d+)?)\b/i);
  if (!m?.groups?.side || !m.groups.line) return null;
  const line = Number(m.groups.line);
  if (!Number.isFinite(line)) return null;
  const side = m.groups.side.toLowerCase() as "over" | "under";

  const eventKey = t
    .replace(/\b(over|under)\s+\d+(?:\.\d+)?\b/gi, "")
    .replace(/\b(total|points|goals|runs|score)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 140);

  return {
    sport: inferSport(t),
    eventKey,
    side,
    line
  };
}

function signalMarket(m: NormalizedMarket): SportsSignal["markets"][number] {
  return {
    marketId: m.marketId,
    title: m.title,
    yes_price: m.yes_price,
    ...(m.yesTokenId ? { yesTokenId: m.yesTokenId } : {})
  };
}

function isValidProb(x: number | null): x is number {
  return typeof x === "number" && Number.isFinite(x) && x > 0.0001 && x < 0.9999;
}

function inferSport(text: string): string {
  if (/\bfifa|world cup|soccer|goal|goals\b/i.test(text)) return "soccer";
  if (/\bnba|basketball\b/i.test(text)) return "basketball";
  if (/\bnfl|football\b/i.test(text)) return "football";
  if (/\bmlb|baseball|runs?\b/i.test(text)) return "baseball";
  if (/\bnhl|hockey\b/i.test(text)) return "hockey";
  return "sports";
}

function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
