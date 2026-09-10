/**
 * Price Calculator Service
 *
 * Pure business logic for price calculations.
 * All calculations use integer cents internally to avoid floating-point errors.
 * Prices are stored/returned as string representations of decimals (e.g., "19.99").
 * Includes Price Safeguards (Floor & Ceiling) with bypassable warning detection.
 */

export type AdjustmentType = "percentage" | "fixed" | "set" | "round";
export type PriceTarget = "price" | "compareAtPrice";
export type AdjustmentDirection = "increase" | "decrease";
export type RoundingMode = "none" | ".99" | ".95" | ".00" | "nearest_10";
export type CompareAtMode = "set" | "clear" | "unchanged";

export interface AdjustmentRule {
  adjustmentType: AdjustmentType;
  adjustmentDirection: AdjustmentDirection;
  adjustmentValue: number;
  roundingMode: RoundingMode;
  compareAtMode: CompareAtMode;
  // Undefined retains the original compare-at synchronization for existing jobs.
  priceTargets?: PriceTarget[];

  // 🛡️ Price Safeguards
  minPriceFloor?: number | null; // e.g. 1.00 (warn if price drops below $1.00)
  maxPriceCeiling?: number | null; // e.g. 500.00 (warn if price exceeds $500.00)
}

export interface PriceCalculationResult {
  originalPrice: string;
  originalCompareAtPrice: string | null;
  newPrice: string;
  newCompareAtPrice: string | null;
  priceChanged: boolean;

  // 🛡️ Guard checks
  guardBreached: boolean;
  guardBreachType: "BELOW_FLOOR" | "ABOVE_CEILING" | null;
  guardWarningMessage: string | null;
}

// System absolute minimum price in cents ($0.01)
const MIN_PRICE_CENTS = 1;

/**
 * Converts a price string to cents (integer).
 * E.g., "19.99" → 1999
 */
function toCents(price: string): number {
  const parsed = parseFloat(price);
  if (isNaN(parsed)) return 0;
  return Math.round(parsed * 100);
}

/**
 * Converts cents (integer) to a formatted price string.
 * E.g., 1999 → "19.99"
 */
function fromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Calculate the adjusted price based on the rule.
 * Returns the new price in cents.
 */
function calculateRawAdjustedCents(
  currentCents: number,
  rule: AdjustmentRule,
): number {
  let newCents: number;

  if (rule.adjustmentType === "set") {
    newCents = Math.round(rule.adjustmentValue * 100);
  } else if (rule.adjustmentType === "round") {
    newCents = currentCents;
  } else if (rule.adjustmentType === "percentage") {
    const multiplier =
      rule.adjustmentDirection === "increase"
        ? 1 + rule.adjustmentValue / 100
        : 1 - rule.adjustmentValue / 100;
    newCents = Math.round(currentCents * multiplier);
  } else {
    // Fixed amount — value is in dollars, convert to cents
    const adjustmentCents = Math.round(rule.adjustmentValue * 100);
    newCents =
      rule.adjustmentDirection === "increase"
        ? currentCents + adjustmentCents
        : currentCents - adjustmentCents;
  }

  // Enforce absolute minimum system price ($0.01)
  return Math.max(newCents, MIN_PRICE_CENTS);
}

/**
 * Apply psychological rounding to a price in cents.
 */
export function applyRounding(cents: number, mode: RoundingMode): number {
  if (mode === "none") return cents;

  const dollars = cents / 100;

  switch (mode) {
    case ".99": {
      return Math.max(Math.floor(dollars) * 100 + 99, MIN_PRICE_CENTS);
    }
    case ".95": {
      return Math.max(Math.floor(dollars) * 100 + 95, MIN_PRICE_CENTS);
    }
    case ".00": {
      return Math.max(Math.round(dollars) * 100, MIN_PRICE_CENTS);
    }
    case "nearest_10": {
      return Math.max(Math.round(dollars / 10) * 10 * 100, MIN_PRICE_CENTS);
    }
    default:
      return cents;
  }
}

/**
 * Calculate the compare-at price based on the mode.
 */
function calculateCompareAt(
  originalPriceCents: number,
  newPriceCents: number,
  originalCompareAtCents: number | null,
  mode: CompareAtMode,
): number | null {
  switch (mode) {
    case "set":
      // Set the original price as compare-at when discount applies
      if (newPriceCents < originalPriceCents) {
        return originalPriceCents;
      }
      return originalCompareAtCents;
    case "clear":
      return null;
    case "unchanged":
      return originalCompareAtCents;
    default:
      return originalCompareAtCents;
  }
}

/**
 * Main price calculation function with Safeguard evaluation.
 */
export function calculateAdjustedPrice(
  currentPrice: string,
  currentCompareAtPrice: string | null,
  rule: AdjustmentRule,
): PriceCalculationResult {
  const currentCents = toCents(currentPrice);
  const currentCompareAtCents = currentCompareAtPrice
    ? toCents(currentCompareAtPrice)
    : null;

  // Step 1: Calculate raw adjusted price
  const adjustsMainPrice =
    !rule.priceTargets || rule.priceTargets.includes("price");
  let newCents = adjustsMainPrice
    ? calculateRawAdjustedCents(currentCents, rule)
    : currentCents;

  // Step 2: Apply rounding
  if (adjustsMainPrice) newCents = applyRounding(newCents, rule.roundingMode);

  // Enforce absolute system minimum
  if (adjustsMainPrice) newCents = Math.max(newCents, MIN_PRICE_CENTS);

  // Step 3: Calculate compare-at price
  let newCompareAtCents = calculateCompareAt(
    currentCents,
    newCents,
    currentCompareAtCents,
    rule.compareAtMode,
  );

  if (rule.priceTargets) {
    newCompareAtCents = currentCompareAtCents;
    if (
      rule.priceTargets.includes("compareAtPrice") &&
      (currentCompareAtCents !== null || rule.adjustmentType === "set")
    ) {
      newCompareAtCents = applyRounding(
        calculateRawAdjustedCents(currentCompareAtCents ?? 0, rule),
        rule.roundingMode,
      );
    }
  }

  const newPrice = fromCents(newCents);
  const newCompareAt =
    newCompareAtCents !== null ? fromCents(newCompareAtCents) : null;

  const guardedPrices = [
    ...(adjustsMainPrice ? [Number(newPrice)] : []),
    ...(rule.priceTargets?.includes("compareAtPrice") && newCompareAt !== null
      ? [Number(newCompareAt)]
      : []),
  ];

  // Step 4: Evaluate Price Safeguards (Floor & Ceiling)
  let guardBreached = false;
  let guardBreachType: "BELOW_FLOOR" | "ABOVE_CEILING" | null = null;
  let guardWarningMessage: string | null = null;

  if (
    rule.minPriceFloor !== undefined &&
    rule.minPriceFloor !== null &&
    !isNaN(rule.minPriceFloor) &&
    guardedPrices.some((price) => price < rule.minPriceFloor!)
  ) {
    guardBreached = true;
    guardBreachType = "BELOW_FLOOR";
    guardWarningMessage = `A selected price is below your floor safeguard of ${rule.minPriceFloor.toFixed(2)}`;
  } else if (
    rule.maxPriceCeiling !== undefined &&
    rule.maxPriceCeiling !== null &&
    !isNaN(rule.maxPriceCeiling) &&
    guardedPrices.some((price) => price > rule.maxPriceCeiling!)
  ) {
    guardBreached = true;
    guardBreachType = "ABOVE_CEILING";
    guardWarningMessage = `A selected price exceeds your ceiling safeguard of ${rule.maxPriceCeiling.toFixed(2)}`;
  }

  return {
    originalPrice: currentPrice,
    originalCompareAtPrice: currentCompareAtPrice,
    newPrice,
    newCompareAtPrice: newCompareAt,
    priceChanged:
      newCents !== currentCents || newCompareAtCents !== currentCompareAtCents,
    guardBreached,
    guardBreachType,
    guardWarningMessage,
  };
}

/**
 * Summarize guard breaches across a batch of calculated items.
 */
export function summarizeGuardBreaches(results: PriceCalculationResult[]) {
  const belowFloor = results.filter((r) => r.guardBreachType === "BELOW_FLOOR");
  const aboveCeiling = results.filter(
    (r) => r.guardBreachType === "ABOVE_CEILING",
  );
  const totalBreached = belowFloor.length + aboveCeiling.length;

  return {
    hasBreaches: totalBreached > 0,
    totalBreached,
    belowFloorCount: belowFloor.length,
    aboveCeilingCount: aboveCeiling.length,
    sampleWarnings: results
      .filter((r) => r.guardBreached)
      .slice(0, 3)
      .map((r) => r.guardWarningMessage!),
  };
}

/**
 * Validate an adjustment rule before execution.
 */
export function validateRule(rule: AdjustmentRule): string[] {
  const errors: string[] = [];

  if (!["percentage", "fixed", "set", "round"].includes(rule.adjustmentType)) {
    errors.push("Invalid adjustment type.");
  }

  if (!["increase", "decrease"].includes(rule.adjustmentDirection)) {
    errors.push("Invalid direction. Must be 'increase' or 'decrease'.");
  }

  if (!Number.isFinite(rule.adjustmentValue)) {
    errors.push("Adjustment value must be a valid number.");
  }

  if (rule.adjustmentType !== "round" && rule.adjustmentValue <= 0) {
    errors.push("Adjustment value must be greater than 0.");
  }

  if (
    rule.adjustmentType === "percentage" &&
    rule.adjustmentValue > 100 &&
    rule.adjustmentDirection === "decrease"
  ) {
    errors.push("Cannot decrease by more than 100%.");
  }

  if (rule.adjustmentType === "percentage" && rule.adjustmentValue > 1000) {
    errors.push("Percentage increase cannot exceed 1000%.");
  }

  if (
    !["none", ".99", ".95", ".00", "nearest_10"].includes(rule.roundingMode)
  ) {
    errors.push("Invalid rounding mode.");
  }

  if (!["set", "clear", "unchanged"].includes(rule.compareAtMode)) {
    errors.push("Invalid compare-at mode.");
  }

  if (rule.adjustmentType === "round" && rule.roundingMode === "none")
    errors.push("Choose a rounding option.");
  if (rule.adjustmentType === "set" && rule.adjustmentValue < 0.01)
    errors.push("The fixed price must be at least 0.01.");
  if (
    rule.priceTargets !== undefined &&
    (!Array.isArray(rule.priceTargets) ||
      !rule.priceTargets.length ||
      rule.priceTargets.some(
        (target) => !["price", "compareAtPrice"].includes(target),
      ))
  )
    errors.push("Select Main Price, Compare-at Price, or both.");
  for (const guard of [rule.minPriceFloor, rule.maxPriceCeiling]) {
    if (guard != null && (!Number.isFinite(guard) || guard < 0))
      errors.push("Price safeguards must be valid non-negative numbers.");
  }

  // Validate floor/ceiling relationships
  if (
    rule.minPriceFloor !== undefined &&
    rule.minPriceFloor !== null &&
    rule.maxPriceCeiling !== undefined &&
    rule.maxPriceCeiling !== null
  ) {
    if (rule.minPriceFloor > rule.maxPriceCeiling) {
      errors.push(
        "Price floor (min) cannot be greater than price ceiling (max).",
      );
    }
  }

  return errors;
}

export function describeAdjustment(rule: {
  adjustmentType: string;
  adjustmentDirection: string;
  adjustmentValue: number;
  roundingMode: string;
}): string {
  if (rule.adjustmentType === "set")
    return `Set to ${rule.adjustmentValue.toFixed(2)}`;
  if (rule.adjustmentType === "round")
    return `Round to ${rule.roundingMode === "nearest_10" ? "nearest 10" : rule.roundingMode}`;
  return `${rule.adjustmentDirection === "increase" ? "Increase" : "Decrease"} by ${rule.adjustmentValue}${rule.adjustmentType === "percentage" ? "%" : " (fixed amount)"}`;
}

/**
 * Format a price for display (with currency symbol).
 */
export function formatPriceDisplay(
  price: string,
  currencyCode: string = "USD",
): string {
  const num = parseFloat(price);
  if (isNaN(num)) return price;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode,
  }).format(num);
}

/**
 * Calculate the discount percentage between two prices.
 */
export function calculateDiscountPercentage(
  originalPrice: string,
  newPrice: string,
): number {
  const original = parseFloat(originalPrice);
  const adjusted = parseFloat(newPrice);

  if (isNaN(original) || isNaN(adjusted) || original === 0) return 0;

  return Math.round(((original - adjusted) / original) * 100);
}
