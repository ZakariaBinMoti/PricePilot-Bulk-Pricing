import { validateRule, type AdjustmentRule } from "./price-calculator.ts";
import { validateFilters, type ProductFilters } from "./product-conditions.ts";
import type { VariantData } from "./product-filter.server";

export interface AdjustmentSubmission {
  campaignName: string;
  filters: ProductFilters;
  rule: AdjustmentRule;
  previewFingerprint: string;
  guardBypassed: boolean;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  autoRevert: boolean;
}
export interface AdjustmentPreview {
  variants: VariantData[];
  fingerprint: string;
  filtersKey: string;
}
export interface AdjustmentResponse {
  preview?: AdjustmentPreview;
  errors?: string[];
}

export function validateSubmission(
  input: AdjustmentSubmission,
  isPro: boolean,
  now = new Date(),
): string[] {
  if (!input || !input.filters || !input.rule)
    return ["Invalid adjustment request."];
  const errors = [
    ...validateFilters(input.filters),
    ...validateRule(input.rule),
  ];
  if (!input.rule.priceTargets) errors.push("Select at least one price field.");
  if (!input.previewFingerprint)
    errors.push("Apply filters and review the preview first.");
  if (input.scheduledStartAt) {
    if (!isPro) errors.push("Sale scheduling requires the Pro plan.");
    const start = new Date(input.scheduledStartAt);
    if (!Number.isFinite(start.getTime()) || start <= now)
      errors.push("Choose a start date and time in the future.");
    if (input.scheduledEndAt) {
      const end = new Date(input.scheduledEndAt);
      if (!Number.isFinite(end.getTime()) || end <= start)
        errors.push("The sale end must be after its start.");
    }
  } else if (input.scheduledEndAt || input.autoRevert)
    errors.push("Choose a sale start before enabling auto-revert.");
  if (input.autoRevert && !input.scheduledEndAt)
    errors.push("Choose a sale end time for auto-revert.");
  return errors;
}
