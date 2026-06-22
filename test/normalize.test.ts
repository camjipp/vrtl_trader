import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGammaMarkets } from "../src/normalize/normalizeMarkets.js";

test("normalizeGammaMarkets keeps CLOB token metadata for binary markets", () => {
  const { markets } = normalizeGammaMarkets([
    {
      id: "123",
      conditionId: "0xabc",
      question: "Will example happen?",
      outcomes: '["Yes","No"]',
      outcomePrices: '["0.40","0.60"]',
      clobTokenIds: '["yes-token","no-token"]',
      orderPriceMinTickSize: "0.01",
      negRisk: false
    }
  ]);

  assert.equal(markets.length, 1);
  assert.equal(markets[0]!.conditionId, "0xabc");
  assert.equal(markets[0]!.yesTokenId, "yes-token");
  assert.equal(markets[0]!.noTokenId, "no-token");
  assert.equal(markets[0]!.tokenIds.Yes, "yes-token");
  assert.equal(markets[0]!.tokenIds.No, "no-token");
  assert.equal(markets[0]!.tickSize, 0.01);
  assert.equal(markets[0]!.negRisk, false);
});
