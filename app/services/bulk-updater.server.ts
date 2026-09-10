/**
 * Bulk Updater Service
 *
 * Handles submitting price updates to Shopify via the GraphQL Admin API.
 * Uses two strategies:
 *   - Small batches (<100 variants): Direct `productVariantsBulkUpdate` mutation
 *   - Large batches (100+ variants): Shopify Bulk Operations API with JSONL
 */

import type { VariantData } from "./product-filter.server";
import type { PriceCalculationResult } from "./price-calculator";

export interface UpdateItem {
  variant: VariantData;
  calculation: PriceCalculationResult;
}

export interface UpdateResult {
  success: boolean;
  updatedCount: number;
  failedCount: number;
  errors: Array<{ variantId: string; message: string }>;
  bulkOperationId?: string; // For async bulk operations
}

/**
 * GraphQL mutation to update variants of a single product.
 * Used for small batches.
 */
const VARIANT_BULK_UPDATE = `#graphql
  mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id
        price
        compareAtPrice
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * GraphQL mutation to start a bulk operation using JSONL.
 * Used for large batches (100+ variants).
 */
const BULK_MUTATION_RUN = `#graphql
  mutation bulkOperationRunMutation($mutation: String!, $stagedUploadPath: String!) {
    bulkOperationRunMutation(
      mutation: $mutation
      stagedUploadPath: $stagedUploadPath
    ) {
      bulkOperation {
        id
        url
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * GraphQL mutation for staged upload (required for bulk operations).
 */
const STAGED_UPLOAD = `#graphql
  mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters {
          name
          value
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Group update items by their parent product ID.
 * This is required because `productVariantsBulkUpdate` works per-product.
 */
function groupByProduct(items: UpdateItem[]): Map<string, UpdateItem[]> {
  const groups = new Map<string, UpdateItem[]>();

  for (const item of items) {
    const productId = item.variant.productId;
    if (!groups.has(productId)) {
      groups.set(productId, []);
    }
    groups.get(productId)!.push(item);
  }

  return groups;
}

/**
 * Execute direct variant updates for a single product.
 * Best for small batches.
 */
async function updateProductVariantsDirect(
  admin: any,
  productId: string,
  items: UpdateItem[],
): Promise<UpdateResult> {
  const variantInputs = items.map((item) => ({
    id: item.variant.id,
    price: item.calculation.newPrice,
    compareAtPrice: item.calculation.newCompareAtPrice,
  }));

  try {
    const response = await admin.graphql(VARIANT_BULK_UPDATE, {
      variables: {
        productId,
        variants: variantInputs,
      },
    });

    const data = await response.json();
    const result = data.data?.productVariantsBulkUpdate;

    if (data.errors?.length || !result) {
      throw new Error(
        data.errors
          ?.map((error: { message: string }) => error.message)
          .join("; ") || "Shopify did not confirm the price update.",
      );
    }

    if (result?.userErrors?.length > 0) {
      return {
        success: false,
        updatedCount: 0,
        failedCount: items.length,
        errors: result.userErrors.map((err: any) => ({
          variantId: "unknown",
          message: `${err.field}: ${err.message}`,
        })),
      };
    }

    return {
      success: true,
      updatedCount: items.length,
      failedCount: 0,
      errors: [],
    };
  } catch (error) {
    return {
      success: false,
      updatedCount: 0,
      failedCount: items.length,
      errors: [
        {
          variantId: "batch",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      ],
    };
  }
}

/**
 * Execute direct updates for small batches (<100 variants).
 * Groups by product and calls `productVariantsBulkUpdate` for each group.
 */
export async function executeDirectUpdates(
  admin: any,
  items: UpdateItem[],
  onProgress?: (processed: number, total: number) => void,
): Promise<UpdateResult> {
  const groups = groupByProduct(items);
  let totalUpdated = 0;
  let totalFailed = 0;
  const allErrors: Array<{ variantId: string; message: string }> = [];
  let processed = 0;

  for (const [productId, productItems] of groups) {
    for (let offset = 0; offset < productItems.length; offset += 250) {
      const batch = productItems.slice(offset, offset + 250);
      const result = await updateProductVariantsDirect(admin, productId, batch);

      totalUpdated += result.updatedCount;
      totalFailed += result.failedCount;
      allErrors.push(...result.errors);

      processed += batch.length;
      onProgress?.(processed, items.length);

      // Small delay to respect rate limits
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return {
    success: totalFailed === 0,
    updatedCount: totalUpdated,
    failedCount: totalFailed,
    errors: allErrors,
  };
}

/**
 * Generate a JSONL file content for bulk operations.
 * Each line contains a mutation for one variant.
 */
export function generateBulkUpdateJSONL(items: UpdateItem[]): string {
  const groups = groupByProduct(items);
  const lines: string[] = [];

  for (const [productId, productItems] of groups) {
    const variants = productItems.map((item) => ({
      id: item.variant.id,
      price: item.calculation.newPrice,
      compareAtPrice: item.calculation.newCompareAtPrice,
    }));

    lines.push(
      JSON.stringify({
        input: {
          productId,
          variants,
        },
      }),
    );
  }

  return lines.join("\n");
}

/**
 * Create a staged upload for the JSONL file.
 */
export async function createStagedUpload(
  admin: any,
  jsonlContent: string,
): Promise<{
  url: string;
  resourceUrl: string;
  parameters: Array<{ name: string; value: string }>;
} | null> {
  const response = await admin.graphql(STAGED_UPLOAD, {
    variables: {
      input: [
        {
          filename: "price-adjustment.jsonl",
          mimeType: "text/jsonl",
          httpMethod: "POST",
          resource: "BULK_MUTATION_VARIABLES",
        },
      ],
    },
  });

  const data = await response.json();
  const targets = data.data?.stagedUploadsCreate?.stagedTargets;

  if (!targets || targets.length === 0) return null;

  const target = targets[0];

  // Upload the JSONL content to the staged URL
  const formData = new FormData();
  for (const param of target.parameters) {
    formData.append(param.name, param.value);
  }
  formData.append("file", new Blob([jsonlContent], { type: "text/jsonl" }));

  await fetch(target.url, {
    method: "POST",
    body: formData,
  });

  return target;
}

/**
 * Start a bulk mutation operation using the uploaded JSONL file.
 */
export async function startBulkOperation(
  admin: any,
  stagedUploadPath: string,
): Promise<UpdateResult> {
  const mutation = `
    mutation productVariantsBulkUpdate($input: ProductVariantsBulkUpdateInput!) {
      productVariantsBulkUpdate(productId: $input.productId, variants: $input.variants) {
        productVariants {
          id
          price
          compareAtPrice
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const response = await admin.graphql(BULK_MUTATION_RUN, {
    variables: {
      mutation,
      stagedUploadPath,
    },
  });

  const data = await response.json();
  const result = data.data?.bulkOperationRunMutation;

  if (result?.userErrors?.length > 0) {
    return {
      success: false,
      updatedCount: 0,
      failedCount: 0,
      errors: result.userErrors.map((err: any) => ({
        variantId: "bulk",
        message: `${err.field}: ${err.message}`,
      })),
    };
  }

  return {
    success: true,
    updatedCount: 0, // Will be updated when bulk operation completes
    failedCount: 0,
    errors: [],
    bulkOperationId: result?.bulkOperation?.id,
  };
}

/**
 * Check the status of a running bulk operation.
 */
const BULK_OPERATION_STATUS = `#graphql
  query BulkOperationStatus {
    currentBulkOperation(type: MUTATION) {
      id
      status
      errorCode
      objectCount
      url
    }
  }
`;

export async function checkBulkOperationStatus(admin: any): Promise<{
  id: string;
  status: string;
  errorCode: string | null;
  objectCount: number;
  url: string | null;
} | null> {
  const response = await admin.graphql(BULK_OPERATION_STATUS);
  const data = await response.json();
  return data.data?.currentBulkOperation || null;
}
