import { createHash } from "node:crypto";
import type { VariantData } from "./product-filter.server";

export function previewFingerprint(variants: VariantData[]): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        variants
          .map((variant) => [variant.id, variant.price, variant.compareAtPrice])
          .sort((a, b) => a[0]!.localeCompare(b[0]!)),
      ),
    )
    .digest("hex");
}
