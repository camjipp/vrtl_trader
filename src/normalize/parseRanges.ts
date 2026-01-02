export type ParsedRange = {
  low: number;
  high: number;
  unit?: string;
  normalizedLabel: string;
};

export type RangeParseResult = {
  range: ParsedRange;
  confidence: number;
  reasons: string[];
};

/**
 * Parse bucket/range labels with common variants:
 * - "10–12", "10-12", "10 to 12", "between 10 and 12"
 * - units: $, %, °C/°F
 * - magnitude suffixes: k/m (e.g. "$10k–$20k")
 *
 * Notes / assumptions:
 * - We treat "k" = 1_000 and "m" = 1_000_000.
 * - Unit is inferred from either a "$" prefix, or suffix like "%", "°c", "°f", "c", "f".
 * - If both sides contain units, we prefer the more specific one (e.g. "°C" over "C").
 */
export function parseRangeFromText(text: string): ParsedRange | null {
  const cleaned = normalize(text);

  // Pattern 1: "between X and Y"
  {
    const m = cleaned.match(
      new RegExp(`between\\s+(?<a>\\S+)\\s+and\\s+(?<b>\\S+)`, "i")
    );
    if (m?.groups?.a && m?.groups?.b) {
      const r = parseRangeTokens(m.groups.a, m.groups.b);
      if (r && !isLikelySeasonOrYearRange(cleaned, r)) return r;
    }
  }

  // Pattern 2: "X - Y" / "X to Y"
  {
    // This handles both spaced and unspaced forms like "$10k-$20k" and "10-12°C".
    const rangeRe = new RegExp(
      `(?<a>\\$?[-]?\\d[\\d,]*(?:\\.\\d+)?(?:[km])?(?:%|°c|°f|c|f)?)\\s*(?:-|to)\\s*(?<b>\\$?[-]?\\d[\\d,]*(?:\\.\\d+)?(?:[km])?(?:%|°c|°f|c|f)?)`,
      "i"
    );
    const m = cleaned.match(rangeRe);
    if (m?.groups?.a && m?.groups?.b) {
      const r = parseRangeTokens(m.groups.a, m.groups.b);
      if (r && !isLikelySeasonOrYearRange(cleaned, r)) return r;
    }
  }

  return null;
}

/**
 * Parse a range and attach a confidence score.
 *
 * Confidence rules (as requested; with a couple explicit, pragmatic guards):
 * - +2 if it matches a clean range form (A–B, A-B, A to B, between A and B)
 * - +1 if high > low AND (high-low) is within a sane band for the unit
 * - -2 if the label contains additional non-year numbers besides the range endpoints
 * - Note: unit-consistency across outcomes is applied at the FAMILY level (see buildFamilies).
 */
export function parseRangeWithConfidence(text: string): RangeParseResult | null {
  const cleaned = normalize(text);
  const reasons: string[] = [];

  // Detect "clean range form" first; we reuse the same matching logic as parseRangeFromText.
  const betweenRe = /between\s+\S+\s+and\s+\S+/i;
  const dashRe = /(\$?[-]?\d[\d,]*(?:\.\d+)?(?:[km])?(?:%|°c|°f|c|f)?)\s*(?:-|to)\s*(\$?[-]?\d[\d,]*(?:\.\d+)?(?:[km])?(?:%|°c|°f|c|f)?)/i;
  const cleanForm = betweenRe.test(cleaned) || dashRe.test(cleaned);

  const range = parseRangeFromText(cleaned);
  if (!range) return null;

  let confidence = 0;
  if (cleanForm) {
    confidence += 2;
    reasons.push("cleanRangeForm");
  }

  const span = range.high - range.low;
  if (span > 0 && isSaneSpan(range, cleaned)) {
    confidence += 1;
    reasons.push("saneSpan");
  }

  const extraNums = countExtraNonYearNumbers(cleaned, range);
  if (extraNums > 0) {
    confidence -= 2;
    reasons.push(`extraNumbers(${extraNums})`);
  }

  return { range, confidence, reasons };
}

export function removeFirstRangeForGrouping(text: string): { base: string; range?: ParsedRange } {
  const normalized = normalize(text);

  // We remove the first matched range-like substring.
  const betweenRe = new RegExp(`between\\s+(?<a>\\S+)\\s+and\\s+(?<b>\\S+)`, "i");
  const dashRe = new RegExp(
    `(?<a>\\$?[-]?\\d[\\d,]*(?:\\.\\d+)?(?:[km])?(?:%|°c|°f|c|f)?)\\s*(?:-|to)\\s*(?<b>\\$?[-]?\\d[\\d,]*(?:\\.\\d+)?(?:[km])?(?:%|°c|°f|c|f)?)`,
    "i"
  );

  let m = normalized.match(betweenRe);
  if (m?.groups?.a && m?.groups?.b) {
    const range = parseRangeTokens(m.groups.a, m.groups.b);
    if (range && isLikelySeasonOrYearRange(normalized, range)) return { base: normalized.trim() };
    const base = normalized.replace(betweenRe, " ").replace(/\s+/g, " ").trim();
    return range ? { base, range } : { base };
  }

  m = normalized.match(dashRe);
  if (m?.groups?.a && m?.groups?.b) {
    const range = parseRangeTokens(m.groups.a, m.groups.b);
    if (range && isLikelySeasonOrYearRange(normalized, range)) return { base: normalized.trim() };
    const base = normalized.replace(dashRe, " ").replace(/\s+/g, " ").trim();
    return range ? { base, range } : { base };
  }

  return { base: normalized.trim() };
}

function parseRangeTokens(aRaw: string, bRaw: string): ParsedRange | null {
  const a = parseValueToken(aRaw);
  const b = parseValueToken(bRaw);
  if (!a || !b) return null;

  // Heuristic: if only one side has a magnitude suffix (k/m), assume the other side shares it
  // when its absolute value is "small". This fixes common labels like "$50k-$100".
  const aHasK = /k\b/i.test(stripPunct(aRaw));
  const bHasK = /k\b/i.test(stripPunct(bRaw));
  const aHasM = /m\b/i.test(stripPunct(aRaw));
  const bHasM = /m\b/i.test(stripPunct(bRaw));

  let av = a.value;
  let bv = b.value;
  if (aHasK && !bHasK && !bHasM && Math.abs(bv) < 1000) bv = bv * 1000;
  if (bHasK && !aHasK && !aHasM && Math.abs(av) < 1000) av = av * 1000;
  if (aHasM && !bHasM && !bHasK && Math.abs(bv) < 1000) bv = bv * 1_000_000;
  if (bHasM && !aHasM && !aHasK && Math.abs(av) < 1000) av = av * 1_000_000;

  const low = Math.min(av, bv);
  const high = Math.max(av, bv);
  if (!Number.isFinite(low) || !Number.isFinite(high) || low === high) return null;

  const unit = chooseUnit(a.unit, b.unit);
  const normalizedLabel = formatNormalizedLabel(low, high, unit);

  return { low, high, normalizedLabel, ...(unit ? { unit } : {}) };
}

/**
 * Prevent obvious false-positives like sports season strings "2025-26" / "2025-2026".
 * We only apply these guards when the range has no explicit unit.
 */
function isLikelySeasonOrYearRange(fullText: string, r: ParsedRange): boolean {
  if (r.unit) return false;
  const t = fullText.toLowerCase();

  // If the text mentions "season" and one side looks like a 4-digit year, reject.
  const hasYear = /\b(19|20)\d{2}\b/.test(t);
  if (t.includes("season") && hasYear) return true;

  // Reject pure year-to-year ranges like 2025-2026.
  if (r.low >= 1900 && r.high <= 2100) return true;

  // Reject 2-digit/4-digit "2025-26" style when a year is present.
  if (hasYear && (r.low >= 1900 || r.high >= 1900) && (r.low < 100 || r.high < 100)) return true;

  return false;
}

function parseValueToken(raw: string): { value: number; unit?: string } | null {
  // strip punctuation around token but keep $ and ° and % and letters for suffix.
  let t = raw.trim();
  t = t.replace(/^[("']+|[)"',.?]+$/g, "");

  // Accept optional currency prefix.
  let unit: string | undefined;
  if (t.startsWith("$")) {
    unit = "$";
    t = t.slice(1);
  }

  // Accept optional degree prefix (rare)
  if (t.startsWith("°")) {
    // We'll treat degree unit as suffix later; keep it by stripping and remembering.
    unit = unit ?? "°";
    t = t.slice(1);
  }

  // Extract trailing unit markers and magnitude suffix.
  // Examples: "10k", "3.5%", "12°C", "12c"
  const m = t.match(
    /^(?<num>-?\d{1,3}(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?)(?<mag>[km])?(?<u>%|°c|°f|c|f)?$/i
  );
  if (!m?.groups?.num) return null;

  const n = Number(m.groups.num.replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;

  const mag = (m.groups.mag ?? "").toLowerCase();
  const mult = mag === "k" ? 1_000 : mag === "m" ? 1_000_000 : 1;

  const u = (m.groups.u ?? "").toLowerCase();
  if (u) {
    const normalizedUnit = u === "c" ? "°c" : u === "f" ? "°f" : u;
    unit = mergeUnit(unit, normalizedUnit);
  }

  return { value: n * mult, ...(unit ? { unit } : {}) };
}

function normalize(s: string): string {
  return (
    s
      // normalize dash variants to "-"
      .replace(/[\u2012\u2013\u2014\u2212]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function mergeUnit(existing: string | undefined, incoming: string): string {
  if (!existing) return incoming;
  if (existing === "°" && (incoming === "°c" || incoming === "°f")) return incoming;
  return existing;
}

function chooseUnit(a?: string, b?: string): string | undefined {
  // Prefer explicit °c/°f over "°" over $, %, etc.
  const prefs = ["°c", "°f", "°", "$", "%"];
  for (const p of prefs) {
    if (a === p || b === p) return p === "°" ? undefined : p;
  }
  return a ?? b;
}

function formatNormalizedLabel(low: number, high: number, unit?: string): string {
  const base = `${stripTrailingZeros(low)}-${stripTrailingZeros(high)}`;
  return unit ? `${base}${unit}` : base;
}

function stripTrailingZeros(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const s = n.toString();
  if (!s.includes(".")) return s;
  return s.replace(/\.?0+$/, "");
}

function stripPunct(s: string): string {
  return s.replace(/^[("']+|[)"',.?]+$/g, "").trim();
}

function isSaneSpan(r: ParsedRange, fullText: string): boolean {
  // Very simple "sanity bands" so we avoid absurd interpretations.
  // These are intentionally loose; they only exist to weed out obvious nonsense.
  const span = r.high - r.low;
  const absHigh = Math.max(Math.abs(r.high), Math.abs(r.low));

  if (r.unit === "%") return span > 0 && span <= 100 && r.low >= 0 && r.high <= 100;
  if (r.unit === "°c" || r.unit === "°f") return span > 0 && span <= 200 && absHigh <= 300;
  if (r.unit === "$") return span > 0 && span <= 50_000_000;

  // No unit: avoid year-ish and huge spans.
  if (isLikelySeasonOrYearRange(fullText, r)) return false;
  return span > 0 && span <= 5_000_000;
}

function countExtraNonYearNumbers(text: string, r: ParsedRange): number {
  // Count numbers in the label, excluding:
  // - 4-digit years (1900..2100)
  // - the two range endpoints (approx)
  const nums = [...text.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  const isYear = (n: number) => Number.isInteger(n) && n >= 1900 && n <= 2100;
  const approxEq = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  const extra = nums.filter((n) => !isYear(n) && !approxEq(n, r.low) && !approxEq(n, r.high));
  return extra.length;
}


