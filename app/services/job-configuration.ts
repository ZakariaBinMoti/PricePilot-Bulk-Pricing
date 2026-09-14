import type { AdjustmentRule, PriceTarget } from "./price-calculator";
import type { ProductFilters } from "./product-conditions";

// Keep the extended rule in the existing JSON column so older jobs and databases
// remain compatible without changing any existing snapshot or subscription data.
export function serializeJobFilters(
  filters: ProductFilters,
  rule: AdjustmentRule,
  campaignName?: string,
): string {
  return JSON.stringify({
    ...filters,
    priceTargets: rule.priceTargets,
    campaignName: campaignName?.trim() || undefined,
  });
}

export function readJobTargets(filtersJson: string): PriceTarget[] | undefined {
  return JSON.parse(filtersJson).priceTargets;
}

export function readJobCampaignName(filtersJson: string): string | undefined {
  const campaignName = JSON.parse(filtersJson).campaignName;
  return typeof campaignName === "string" && campaignName.trim()
    ? campaignName
    : undefined;
}

export function withJobCampaignName(
  filtersJson: string,
  campaignName: string,
): string {
  return JSON.stringify({
    ...JSON.parse(filtersJson),
    campaignName: campaignName.trim(),
  });
}
