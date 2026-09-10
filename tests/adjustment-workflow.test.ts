import test from "node:test";
import assert from "node:assert/strict";
import {
  matchesFilters,
  validateFilters,
  type ProductCondition,
  type ProductFilters,
} from "../app/services/product-conditions.ts";
import {
  fetchAllFilteredVariants,
  fetchFilterOptions,
  type VariantData,
} from "../app/services/product-filter.server.ts";
import {
  calculateAdjustedPrice,
  validateRule,
  type AdjustmentRule,
} from "../app/services/price-calculator.ts";
import { executeDirectUpdates } from "../app/services/bulk-updater.server.ts";
import {
  serializeJobFilters,
  readJobTargets,
} from "../app/services/job-configuration.ts";
import {
  validateSubmission,
  type AdjustmentSubmission,
} from "../app/services/adjustment-request.ts";
import { previewFingerprint } from "../app/services/preview-fingerprint.server.ts";

const variant: VariantData = {
  id: "gid://shopify/ProductVariant/1",
  numericId: "1",
  title: "Small",
  productId: "gid://shopify/Product/1",
  productTitle: "Classic Cotton Shirt",
  sku: "SHIRT-S",
  price: "20.00",
  compareAtPrice: "30.00",
  inventoryQuantity: 5,
  tags: ["Summer", "Cotton"],
  vendor: "North Studio",
  productType: "Shirts",
  status: "ACTIVE",
  collectionIds: ["gid://shopify/Collection/1"],
};
const baseRule: AdjustmentRule = {
  adjustmentType: "percentage",
  adjustmentDirection: "increase",
  adjustmentValue: 10,
  roundingMode: "none",
  compareAtMode: "unchanged",
  priceTargets: ["price"],
};
const condition = (
  field: ProductCondition["field"],
  operator: ProductCondition["operator"],
  value: string,
): ProductCondition => ({ field, operator, value });
const filter = (...conditions: ProductCondition[]): ProductFilters => ({
  matchMode: "all",
  conditions,
});

test("Conditions combine all/any across product fields and variant prices", () => {
  const conditions = [
    condition("tag", "equals", "summer"),
    condition("price", "greater_than", "25"),
  ];
  assert.equal(
    matchesFilters(variant, { conditions, matchMode: "all" }),
    false,
  );
  assert.equal(matchesFilters(variant, { conditions, matchMode: "any" }), true);
  assert.equal(
    matchesFilters(
      variant,
      filter(
        condition("price", "less_than", "25"),
        condition("vendor", "equals", "North Studio"),
      ),
    ),
    true,
  );
  assert.equal(
    matchesFilters(
      { ...variant, price: "40.00" },
      filter(condition("price", "less_than", "25")),
    ),
    false,
  );
  assert.equal(
    matchesFilters(variant, { conditions: [], matchMode: "any" }),
    true,
  );
});

test("Title and SKU equality are distinct from substring matching and negation", () => {
  assert.equal(
    matchesFilters(variant, filter(condition("title", "equals", "Cotton"))),
    false,
  );
  assert.equal(
    matchesFilters(variant, filter(condition("title", "contains", "cotton"))),
    true,
  );
  assert.equal(
    matchesFilters(
      variant,
      filter(condition("title", "not_contains", "cotton")),
    ),
    false,
  );
  assert.equal(
    matchesFilters(variant, filter(condition("title", "not_equals", "Cotton"))),
    true,
  );
  assert.equal(
    matchesFilters(variant, filter(condition("sku", "contains", "shirt"))),
    true,
  );
  assert.equal(
    matchesFilters(variant, filter(condition("sku", "not_contains", "jacket"))),
    true,
  );
  assert.equal(
    matchesFilters(variant, filter(condition("tag", "not_equals", "Summer"))),
    false,
  );
  assert.equal(
    matchesFilters(variant, filter(condition("tag", "equals", "Sum"))),
    false,
  );
});

test("Collection, stock, status, and null compare-at conditions have exact semantics", () => {
  assert.equal(
    matchesFilters(
      variant,
      filter(
        condition("collection", "equals", "gid://shopify/Collection/1"),
        condition("inventory", "greater_or_equal", "5"),
        condition("status", "equals", "ACTIVE"),
      ),
    ),
    true,
  );
  assert.equal(
    matchesFilters(
      variant,
      filter(
        condition("collection", "not_equals", "gid://shopify/Collection/1"),
      ),
    ),
    false,
  );
  assert.equal(
    matchesFilters(
      variant,
      filter(condition("inventory", "less_or_equal", "5")),
    ),
    true,
  );
  assert.equal(
    matchesFilters(
      variant,
      filter(condition("compareAtPrice", "equals", "30")),
    ),
    true,
  );
  assert.equal(
    matchesFilters(
      { ...variant, compareAtPrice: null },
      filter(condition("compareAtPrice", "less_than", "10")),
    ),
    false,
  );
});

test("Legacy filters retain tag OR matching and combine collection with vendor", () => {
  assert.equal(
    matchesFilters(variant, {
      tags: ["Winter", "Cotton"],
      vendor: "North Studio",
      collectionId: "gid://shopify/Collection/1",
    }),
    true,
  );
  assert.equal(
    matchesFilters(variant, {
      collectionId: "gid://shopify/Collection/1",
      vendor: "Another vendor",
    }),
    false,
  );
});

test("Invalid or unfinished conditions cannot become an all-catalog adjustment", () => {
  assert.ok(validateFilters(filter(condition("tag", "equals", ""))).length);
  assert.ok(
    validateFilters(filter(condition("price", "contains", "2"))).length,
  );
  assert.ok(
    validateFilters(filter(condition("price", "less_than", "Infinity"))).length,
  );
  assert.ok(
    validateFilters(filter(condition("collection", "equals", "Winter"))).length,
  );
  assert.ok(
    validateFilters(filter(condition("status", "equals", "bogus"))).length,
  );
  assert.deepEqual(
    validateFilters(filter(condition("inventory", "less_than", "-1"))),
    [],
  );
});

test("Each price target is updated independently, and both use their own starting value", () => {
  assert.equal(
    calculateAdjustedPrice("20.00", "30.00", baseRule).newCompareAtPrice,
    "30.00",
  );
  const compareOnly = calculateAdjustedPrice("20.00", "30.00", {
    ...baseRule,
    priceTargets: ["compareAtPrice"],
  });
  assert.equal(compareOnly.newPrice, "20.00");
  assert.equal(compareOnly.newCompareAtPrice, "33.00");
  assert.equal(compareOnly.priceChanged, true);
  const both = calculateAdjustedPrice("20.00", "30.00", {
    ...baseRule,
    priceTargets: ["price", "compareAtPrice"],
  });
  assert.equal(both.newPrice, "22.00");
  assert.equal(both.newCompareAtPrice, "33.00");
});

test("Fixed price creates a missing compare-at; relative changes keep it empty", () => {
  const set = calculateAdjustedPrice("20.00", null, {
    ...baseRule,
    adjustmentType: "set",
    adjustmentValue: 45,
    priceTargets: ["compareAtPrice"],
  });
  assert.equal(set.newPrice, "20.00");
  assert.equal(set.newCompareAtPrice, "45.00");
  assert.equal(
    calculateAdjustedPrice("20.00", null, {
      ...baseRule,
      priceTargets: ["compareAtPrice"],
    }).priceChanged,
    false,
  );
  const fixed = calculateAdjustedPrice("20.00", "30.00", {
    ...baseRule,
    adjustmentType: "fixed",
    adjustmentDirection: "decrease",
    adjustmentValue: 5,
    priceTargets: ["price", "compareAtPrice"],
  });
  assert.equal(fixed.newPrice, "15.00");
  assert.equal(fixed.newCompareAtPrice, "25.00");
});

test("Rounding-only updates selected fields without an adjustment amount", () => {
  const rule: AdjustmentRule = {
    ...baseRule,
    adjustmentType: "round",
    adjustmentValue: 0,
    roundingMode: ".99",
    priceTargets: ["price", "compareAtPrice"],
  };
  assert.deepEqual(validateRule(rule), []);
  const result = calculateAdjustedPrice("20.20", "30.20", rule);
  assert.equal(result.newPrice, "20.99");
  assert.equal(result.newCompareAtPrice, "30.99");
  assert.equal(
    calculateAdjustedPrice("20.20", null, rule).newCompareAtPrice,
    null,
  );
  assert.ok(validateRule({ ...rule, roundingMode: "none" }).length);
});

test("Unselected zero prices remain untouched; compare-at safeguards are evaluated", () => {
  const result = calculateAdjustedPrice("0.00", "30.00", {
    ...baseRule,
    priceTargets: ["compareAtPrice"],
    maxPriceCeiling: 32,
  });
  assert.equal(result.newPrice, "0.00");
  assert.equal(result.guardBreached, true);
  assert.ok(validateRule({ ...baseRule, priceTargets: [] }).length);
  assert.ok(validateRule({ ...baseRule, adjustmentValue: Infinity }).length);
  assert.ok(validateRule({ ...baseRule, minPriceFloor: NaN }).length);
});

test("Extended pricing targets survive job serialization; legacy jobs use their original behavior", () => {
  const encoded = serializeJobFilters(
    filter(condition("vendor", "equals", "North Studio")),
    { ...baseRule, priceTargets: ["compareAtPrice"] },
  );
  assert.deepEqual(readJobTargets(encoded), ["compareAtPrice"]);
  assert.equal(JSON.parse(encoded).conditions[0].value, "North Studio");
  assert.equal(readJobTargets('{"vendor":"North Studio"}'), undefined);
});

test("Preview fingerprint detects changed matches and prices, independent of ordering", () => {
  const other = { ...variant, id: "gid://shopify/ProductVariant/2" };
  assert.equal(
    previewFingerprint([variant, other]),
    previewFingerprint([other, variant]),
  );
  assert.notEqual(
    previewFingerprint([variant]),
    previewFingerprint([variant, other]),
  );
  assert.notEqual(
    previewFingerprint([variant]),
    previewFingerprint([{ ...variant, compareAtPrice: "31.00" }]),
  );
});

test("Scheduling rejects missing ends, past starts, reversed dates, and Free-plan requests", () => {
  const input: AdjustmentSubmission = {
    filters: filter(),
    rule: baseRule,
    previewFingerprint: "test",
    guardBypassed: false,
    scheduledStartAt: "2030-01-02T12:00:00Z",
    scheduledEndAt: "2030-01-03T12:00:00Z",
    autoRevert: true,
  };
  const now = new Date("2030-01-01T00:00:00Z");
  assert.deepEqual(validateSubmission(input, true, now), []);
  assert.ok(
    validateSubmission(input, false, now).some((error) =>
      error.includes("Pro"),
    ),
  );
  assert.ok(
    validateSubmission({ ...input, scheduledEndAt: null }, true, now).length,
  );
  assert.ok(
    validateSubmission({ ...input, scheduledStartAt: "2029-01-01" }, true, now)
      .length,
  );
  assert.ok(
    validateSubmission(
      { ...input, scheduledEndAt: "2030-01-02T10:00:00Z" },
      true,
      now,
    ).length,
  );
});

function shopifyNode(id: number, price = "20.00") {
  return {
    id: `gid://shopify/ProductVariant/${id}`,
    title: "Small",
    price,
    compareAtPrice: "30.00",
    sku: "SHIRT-S",
    inventoryQuantity: 5,
    image: null,
    product: {
      id: variant.productId,
      title: variant.productTitle,
      tags: variant.tags,
      vendor: variant.vendor,
      productType: variant.productType,
      status: "ACTIVE",
      featuredMedia: {
        preview: {
          image: { url: "https://example.com/shirt.png", altText: "Shirt" },
        },
      },
    },
  };
}

test("Catalog pagination includes variants beyond 100 and intersects collection with price conditions", async () => {
  const cursors: unknown[] = [];
  const admin = {
    graphql: async (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => {
      if (query.includes("AdjustmentCollectionMembers"))
        return {
          json: async () => ({
            data: {
              collection: {
                products: {
                  nodes: [{ id: variant.productId }],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          }),
        };
      cursors.push(options?.variables?.after);
      return {
        json: async () => ({
          data: {
            productVariants: options?.variables?.after
              ? {
                  nodes: [shopifyNode(101, "10.00")],
                  pageInfo: { hasNextPage: false, endCursor: null },
                }
              : {
                  nodes: Array.from({ length: 100 }, (_, i) =>
                    shopifyNode(i + 1),
                  ),
                  pageInfo: { hasNextPage: true, endCursor: "page2" },
                },
          },
        }),
      };
    },
  };
  const results = await fetchAllFilteredVariants(
    admin,
    filter(
      condition("collection", "equals", "gid://shopify/Collection/1"),
      condition("price", "less_than", "15"),
    ),
  );
  assert.deepEqual(cursors, [null, "page2"]);
  assert.equal(results.length, 1);
  assert.equal(results[0].numericId, "101");
  assert.equal(results[0].imageUrl, "https://example.com/shirt.png");
});

test("Catalog errors and missing collections fail visibly instead of returning misleading matches", async () => {
  await assert.rejects(
    fetchAllFilteredVariants(
      {
        graphql: async () => ({
          json: async () => ({ errors: [{ message: "Access denied" }] }),
        }),
      },
      filter(),
    ),
    /Access denied/,
  );
  await assert.rejects(
    fetchAllFilteredVariants(
      {
        graphql: async () => ({
          json: async () => ({ data: { collection: null } }),
        }),
      },
      filter(condition("collection", "equals", "gid://shopify/Collection/1")),
    ),
    /no longer exists/,
  );
});

test("Autocomplete options paginate all tags, types, vendors and collections", async () => {
  const admin = {
    graphql: async (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => {
      if (query.includes("AdjustmentCollections"))
        return {
          json: async () => ({
            data: {
              collections: {
                nodes: [{ id: "gid://shopify/Collection/1", title: "Summer" }],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          }),
        };
      const field = ["productTags", "productTypes", "productVendors"].find(
        (name) => query.includes(name),
      )!;
      return {
        json: async () => ({
          data: {
            [field]: {
              nodes: options?.variables?.after
                ? ["Second page"]
                : ["First page"],
              pageInfo: {
                hasNextPage: !options?.variables?.after,
                endCursor: options?.variables?.after ? null : "next",
              },
            },
          },
        }),
      };
    },
  };
  const options = await fetchFilterOptions(admin);
  for (const field of ["tag", "vendor", "productType"] as const)
    assert.deepEqual(
      options[field].map((option) => option.value),
      ["First page", "Second page"],
    );
  assert.equal(options.collection[0].label, "Summer");
});

test("Compare-at-only changes reach the mutation, and large products are chunked", async () => {
  const requests: any[] = [];
  const admin = {
    graphql: async (_query: string, request: any) => {
      requests.push(request.variables);
      return {
        json: async () => ({
          data: {
            productVariantsBulkUpdate: {
              userErrors: [],
              productVariants: request.variables.variants,
            },
          },
        }),
      };
    },
  };
  const items = Array.from({ length: 251 }, (_, index) => ({
    variant: { ...variant, id: `gid://shopify/ProductVariant/${index + 1}` },
    calculation: calculateAdjustedPrice(variant.price, variant.compareAtPrice, {
      ...baseRule,
      priceTargets: ["compareAtPrice"],
    }),
  }));
  const result = await executeDirectUpdates(admin, items);
  assert.equal(result.updatedCount, 251);
  assert.deepEqual(
    requests.map((request) => request.variants.length),
    [250, 1],
  );
  assert.equal(requests[0].variants[0].price, "20.00");
  assert.equal(requests[0].variants[0].compareAtPrice, "33.00");
});

test("Top-level GraphQL mutation errors are not recorded as successful updates", async () => {
  const result = await executeDirectUpdates(
    {
      graphql: async () => ({
        json: async () => ({ errors: [{ message: "Throttled" }] }),
      }),
    },
    [
      {
        variant,
        calculation: calculateAdjustedPrice(
          variant.price,
          variant.compareAtPrice,
          baseRule,
        ),
      },
    ],
  );
  assert.equal(result.success, false);
  assert.equal(result.updatedCount, 0);
  assert.equal(result.failedCount, 1);
});
