import test from "node:test";
import assert from "node:assert/strict";
import { PLANS } from "../app/services/billing.server.ts";
import { buildRollbackData, type SnapshotEntry } from "../app/services/snapshot.server.ts";

test("Billing - Plan feature definitions", () => {
  assert.equal(PLANS.FREE.price, 0);
  assert.equal(PLANS.FREE.schedulingAllowed, false);
  assert.equal(PLANS.FREE.variantLimit, 50);

  assert.equal(PLANS.PRO.price, 14.99);
  assert.equal(PLANS.PRO.schedulingAllowed, true);
  assert.equal(PLANS.PRO.variantLimit, Infinity);
  assert.equal(PLANS.PRO.trialDays, 7);
});

test("Snapshot & Rollback - Swaps new and original prices faithfully", () => {
  const mockSnapshots: SnapshotEntry[] = [
    {
      jobId: "job-1",
      variantId: "101",
      variantGid: "gid://shopify/ProductVariant/101",
      productTitle: "Classic T-Shirt",
      variantTitle: "Black / M",
      originalPrice: "25.00",
      originalCompareAtPrice: "30.00",
      newPrice: "19.99",
      newCompareAtPrice: "25.00",
    },
    {
      jobId: "job-1",
      variantId: "102",
      variantGid: "gid://shopify/ProductVariant/102",
      productTitle: "Leather Jacket",
      variantTitle: "Brown / L",
      originalPrice: "150.00",
      originalCompareAtPrice: null,
      newPrice: "120.00",
      newCompareAtPrice: "150.00",
    },
  ];

  const rollbackData = buildRollbackData(mockSnapshots);

  assert.equal(rollbackData.length, 2);

  // Variant 101: restorePrice must be 25.00, compareAt 30.00
  assert.equal(rollbackData[0].variantGid, "gid://shopify/ProductVariant/101");
  assert.equal(rollbackData[0].restorePrice, "25.00");
  assert.equal(rollbackData[0].restoreCompareAtPrice, "30.00");

  // Variant 102: restorePrice must be 150.00, compareAt null
  assert.equal(rollbackData[1].variantGid, "gid://shopify/ProductVariant/102");
  assert.equal(rollbackData[1].restorePrice, "150.00");
  assert.equal(rollbackData[1].restoreCompareAtPrice, null);
});
