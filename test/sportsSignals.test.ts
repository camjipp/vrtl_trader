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
