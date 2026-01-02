import test from "node:test";
import assert from "node:assert/strict";
import { parseRangeFromText, removeFirstRangeForGrouping } from "../src/normalize/parseRanges.js";

test("parseRangeFromText parses hyphen and en-dash ranges", () => {
  assert.deepEqual(parseRangeFromText("10-12"), { low: 10, high: 12, normalizedLabel: "10-12" });
  assert.deepEqual(parseRangeFromText("10–12"), { low: 10, high: 12, normalizedLabel: "10-12" });
  assert.deepEqual(parseRangeFromText("12 — 14"), { low: 12, high: 14, normalizedLabel: "12-14" });
});

test("parseRangeFromText parses decimals and 'to'", () => {
  assert.deepEqual(parseRangeFromText("3.0 to 3.5"), { low: 3, high: 3.5, normalizedLabel: "3-3.5" });
});

test("parseRangeFromText finds first range inside longer text", () => {
  assert.deepEqual(parseRangeFromText("Will CPI be 3.0–3.5% in Jan?"), {
    low: 3,
    high: 3.5,
    unit: "%",
    normalizedLabel: "3-3.5%"
  });
});

test("removeFirstRangeForGrouping strips the bucket for grouping", () => {
  const { base, range } = removeFirstRangeForGrouping("CPI 3.0–3.5% (Jan 2026)");
  assert.equal(base, "CPI (Jan 2026)");
  assert.deepEqual(range, { low: 3, high: 3.5, unit: "%", normalizedLabel: "3-3.5%" });
});


