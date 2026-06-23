import test from "node:test";
import assert from "node:assert/strict";
import { detectSportsSignals } from "../src/detect/sportsSignals.js";
import type { NormalizedMarket } from "../src/normalize/normalizeMarkets.js";

function market(title: string, yes_price: number): NormalizedMarket {
  return {
    marketId: title,
    title,
    outcomes: ["Yes", "No"],
    prices: { Yes: yes_price, No: 1 - yes_price },
    tokenIds: { Yes: `${title}:yes`, No: `${title}:no` },
    yes_price,
    yesTokenId: `${title}:yes`,
    noTokenId: `${title}:no`
  };
}

test("detectSportsSignals finds sports outright overround", () => {
  const signals = detectSportsSignals(
    [
      market("Will Spain win the 2026 FIFA World Cup?", 0.3),
      market("Will England win the 2026 FIFA World Cup?", 0.3),
      market("Will France win the 2026 FIFA World Cup?", 0.3),
      market("Will Brazil win the 2026 FIFA World Cup?", 0.3)
    ],
    "2026-01-01T00:00:00.000Z"
  );

  assert.equal(signals[0]?.kind, "outright_overround");
  assert.equal(signals[0]?.sport, "soccer");
  assert.equal(signals[0]?.markets.length, 4);
});

test("detectSportsSignals finds over totals ladder violation", () => {
  const signals = detectSportsSignals(
    [
      market("Will Lakers vs Knicks total be over 1.5 points?", 0.4),
      market("Will Lakers vs Knicks total be over 2.5 points?", 0.5)
    ],
    "2026-01-01T00:00:00.000Z"
  );

  assert.equal(signals[0]?.kind, "ladder_violation");
  assert.ok(Math.abs((signals[0]?.edge ?? 0) - 0.1) < 1e-9);
});

test("detectSportsSignals finds dutching discount against team no", () => {
  const signals = detectSportsSignals(
    [
      market("Will Arsenal beat Chelsea?", 0.8),
      market("Will Chelsea beat Arsenal?", 0.12),
      market("Will Arsenal vs Chelsea end in a draw?", 0.16)
    ],
    "2026-01-01T00:00:00.000Z"
  );

  const dutching = signals.find((s) => s.kind === "dutching_discount");
  assert.equal(dutching?.title, "Arsenal NO dutching discount");
  assert.ok(Math.abs((dutching?.edge ?? 0) - 0.08) < 1e-9);
  assert.equal(dutching?.markets.length, 3);
});

test("detectSportsSignals finds complementary total underround", () => {
  const signals = detectSportsSignals(
    [
      market("Will Lakers vs Knicks total be over 225.5 points?", 0.47),
      market("Will Lakers vs Knicks total be under 225.5 points?", 0.48)
    ],
    "2026-01-01T00:00:00.000Z"
  );

  const pair = signals.find((s) => s.kind === "total_pair_underround");
  assert.equal(pair?.title, "Over/Under 225.5 underround");
  assert.ok(Math.abs((pair?.edge ?? 0) - 0.05) < 1e-9);
});

test("detectSportsSignals finds under totals ladder violation", () => {
  const signals = detectSportsSignals(
    [
      market("Will Lakers vs Knicks total be under 1.5 points?", 0.55),
      market("Will Lakers vs Knicks total be under 2.5 points?", 0.5)
    ],
    "2026-01-01T00:00:00.000Z"
  );

  const ladder = signals.find((s) => s.kind === "ladder_violation");
  assert.equal(ladder?.title, "UNDER ladder violation");
  assert.ok(Math.abs((ladder?.edge ?? 0) - 0.05) < 1e-9);
});
