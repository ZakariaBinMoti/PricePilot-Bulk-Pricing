import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateAdjustedPrice,
  applyRounding,
  validateRule,
  calculateDiscountPercentage,
  summarizeGuardBreaches,
  type AdjustmentRule,
} from "../app/services/price-calculator.ts";

test("Price Calculator - Percentage decrease with compare-at set", () => {
  const rule: AdjustmentRule = {
    adjustmentType: "percentage",
    adjustmentDirection: "decrease",
    adjustmentValue: 20, // 20% off
    roundingMode: "none",
    compareAtMode: "set",
  };

  const result = calculateAdjustedPrice("50.00", null, rule);

  assert.equal(result.newPrice, "40.00");
  assert.equal(result.newCompareAtPrice, "50.00"); // Old price becomes compare-at
  assert.equal(result.priceChanged, true);
  assert.equal(result.guardBreached, false);
});

test("Price Calculator - Percentage increase with compare-at unchanged", () => {
  const rule: AdjustmentRule = {
    adjustmentType: "percentage",
    adjustmentDirection: "increase",
    adjustmentValue: 10, // 10% markup
    roundingMode: "none",
    compareAtMode: "unchanged",
  };

  const result = calculateAdjustedPrice("100.00", "120.00", rule);

  assert.equal(result.newPrice, "110.00");
  assert.equal(result.newCompareAtPrice, "120.00"); // Left unchanged
  assert.equal(result.priceChanged, true);
});

test("Price Calculator - Fixed amount decrease and clear compare-at", () => {
  const rule: AdjustmentRule = {
    adjustmentType: "fixed",
    adjustmentDirection: "decrease",
    adjustmentValue: 15.50,
    roundingMode: "none",
    compareAtMode: "clear",
  };

  const result = calculateAdjustedPrice("45.50", "60.00", rule);

  assert.equal(result.newPrice, "30.00");
  assert.equal(result.newCompareAtPrice, null); // Cleared
  assert.equal(result.priceChanged, true);
});

test("Price Calculator - Psychological Rounding (.99, .95, .00, nearest_10)", () => {
  // .99 rounding: 1942 cents ($19.42) -> $19.99
  assert.equal(applyRounding(1942, ".99"), 1999);

  // .95 rounding: 2412 cents ($24.12) -> $24.95
  assert.equal(applyRounding(2412, ".95"), 2495);

  // .00 rounding: 1460 cents ($14.60) -> $15.00
  assert.equal(applyRounding(1460, ".00"), 1500);

  // nearest_10 rounding: 4800 cents ($48.00) -> $50.00
  assert.equal(applyRounding(4800, "nearest_10"), 5000);
});

test("Price Calculator - Combined calculation with .99 rounding", () => {
  const rule: AdjustmentRule = {
    adjustmentType: "percentage",
    adjustmentDirection: "decrease",
    adjustmentValue: 15, // 15% off $20 = $17 -> rounded .99 = $16.99
    roundingMode: ".99",
    compareAtMode: "set",
  };

  const result = calculateAdjustedPrice("20.00", null, rule);

  // $20 - 15% = $17.00 -> formatted to .99 ending = $17.99
  assert.equal(result.newPrice, "17.99");
  assert.equal(result.newCompareAtPrice, "20.00");
});

test("Price Safeguards - Floor breach triggers warning", () => {
  const rule: AdjustmentRule = {
    adjustmentType: "fixed",
    adjustmentDirection: "decrease",
    adjustmentValue: 9.50, // $10 - $9.50 = $0.50 (below $1.00 floor)
    roundingMode: "none",
    compareAtMode: "set",
    minPriceFloor: 1.00,
    maxPriceCeiling: 100.00,
  };

  const result = calculateAdjustedPrice("10.00", null, rule);

  assert.equal(result.newPrice, "0.50");
  assert.equal(result.guardBreached, true);
  assert.equal(result.guardBreachType, "BELOW_FLOOR");
  assert.ok(result.guardWarningMessage?.includes("below your floor safeguard"));
});

test("Price Safeguards - Ceiling breach triggers warning", () => {
  const rule: AdjustmentRule = {
    adjustmentType: "percentage",
    adjustmentDirection: "increase",
    adjustmentValue: 150, // $50 + 150% = $125 (exceeds $100.00 ceiling)
    roundingMode: "none",
    compareAtMode: "unchanged",
    minPriceFloor: 1.00,
    maxPriceCeiling: 100.00,
  };

  const result = calculateAdjustedPrice("50.00", null, rule);

  assert.equal(result.newPrice, "125.00");
  assert.equal(result.guardBreached, true);
  assert.equal(result.guardBreachType, "ABOVE_CEILING");
  assert.ok(result.guardWarningMessage?.includes("exceeds your ceiling safeguard"));
});

test("Price Safeguards - Summarize batch breaches", () => {
  const safeItem = calculateAdjustedPrice("25.00", null, {
    adjustmentType: "percentage",
    adjustmentDirection: "decrease",
    adjustmentValue: 10,
    roundingMode: "none",
    compareAtMode: "set",
    minPriceFloor: 5.00,
    maxPriceCeiling: 100.00,
  });

  const breachedItem = calculateAdjustedPrice("4.00", null, {
    adjustmentType: "percentage",
    adjustmentDirection: "decrease",
    adjustmentValue: 50,
    roundingMode: "none",
    compareAtMode: "set",
    minPriceFloor: 5.00,
    maxPriceCeiling: 100.00,
  });

  const summary = summarizeGuardBreaches([safeItem, breachedItem]);

  assert.equal(summary.hasBreaches, true);
  assert.equal(summary.totalBreached, 1);
  assert.equal(summary.belowFloorCount, 1);
  assert.equal(summary.aboveCeilingCount, 0);
  assert.equal(summary.sampleWarnings.length, 1);
});

test("Price Calculator - System absolute minimum clamp ($0.01)", () => {
  const rule: AdjustmentRule = {
    adjustmentType: "percentage",
    adjustmentDirection: "decrease",
    adjustmentValue: 100, // 100% off
    roundingMode: "none",
    compareAtMode: "set",
  };

  const result = calculateAdjustedPrice("10.00", null, rule);

  // Must clamp to $0.01 minimum, never negative or zero
  assert.equal(result.newPrice, "0.01");
});

test("Rule Validation - Catches invalid parameters", () => {
  const invalidRule: any = {
    adjustmentType: "invalid_type",
    adjustmentDirection: "decrease",
    adjustmentValue: -5,
    roundingMode: "none",
    compareAtMode: "set",
    minPriceFloor: 100,
    maxPriceCeiling: 50, // Floor > Ceiling error
  };

  const errors = validateRule(invalidRule);
  assert.ok(errors.length >= 3);
  assert.ok(errors.some((e: string) => e.includes("Invalid adjustment type")));
  assert.ok(errors.some((e: string) => e.includes("greater than 0")));
  assert.ok(errors.some((e: string) => e.includes("cannot be greater than price ceiling")));
});
