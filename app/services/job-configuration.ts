import type { AdjustmentRule, PriceTarget } from "./price-calculator";
import type { ProductFilters } from "./product-conditions";

// Keep the extended rule in the existing JSON column so older jobs and databases
// remain compatible without changing any existing snapshot or subscription data.
export function serializeJobFilters(
  filters: ProductFilters,
  rule: AdjustmentRule,
): string {
  return JSON.stringify({ ...filters, priceTargets: rule.priceTargets });
}

export function readJobTargets(filtersJson: string): PriceTarget[] | undefined {
  return JSON.parse(filtersJson).priceTargets;
}
