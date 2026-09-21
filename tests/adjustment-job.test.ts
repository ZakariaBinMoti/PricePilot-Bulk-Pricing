import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import type { AdjustmentRule } from "../app/services/price-calculator.ts";
import type { VariantData } from "../app/services/product-filter.server.ts";

// Install an in-memory database double before importing the job pipeline. No
// development-store database or Shopify catalog is touched by these tests.
const unexpectedCall = async (_args: any): Promise<any> => {
  throw new Error("Unexpected database call");
};
const prisma = {
  priceJob: {
    create: unexpectedCall,
    count: unexpectedCall,
    findUnique: unexpectedCall,
    update: unexpectedCall,
    updateMany: unexpectedCall,
    deleteMany: unexpectedCall,
  },
  priceSnapshot: { createMany: unexpectedCall },
  auditLog: { create: unexpectedCall },
  $transaction: unexpectedCall,
};
globalThis.prisma = prisma as unknown as PrismaClient;
const { createJob, executeJob, deleteJobForShop } =
  await import("../app/services/job-manager.server.ts");

test("Deleting a finished adjustment is scoped to the shop and leaves an audit event", async (t) => {
  let deleted = false;
  let audited = false;
  t.mock.method(prisma, "$transaction", async (operation: any) => operation(prisma));
  t.mock.method(prisma.priceJob, "deleteMany", async ({ where }: any) => {
    assert.equal(where.id, "finished-job");
    assert.equal(where.shop, "fixture.myshopify.com");
    assert.deepEqual(where.status.in, ["completed", "failed", "rolled_back", "cancelled"]);
    assert.deepEqual(where.OR, [
      { isScheduled: false },
      { scheduleStatus: { in: ["completed", "cancelled"] } },
    ]);
    deleted = true;
    return { count: 1 };
  });
  t.mock.method(prisma.auditLog, "create", async ({ data }: any) => {
    assert.equal(data.shop, "fixture.myshopify.com");
    assert.equal(data.action, "adjustment_deleted");
    assert.deepEqual(JSON.parse(data.details), { deletedJobId: "finished-job" });
    audited = true;
    return {};
  });

  await deleteJobForShop("finished-job", "fixture.myshopify.com");
  assert.equal(deleted, true);
  assert.equal(audited, true);
});

test("A job not eligible for deletion is not audited as deleted", async (t) => {
  t.mock.method(prisma, "$transaction", async (operation: any) => operation(prisma));
  t.mock.method(prisma.priceJob, "deleteMany", async () => ({ count: 0 }));
  t.mock.method(prisma.auditLog, "create", async () => {
    throw new Error("An audit event must not be created for a rejected deletion.");
  });
  await assert.rejects(
    deleteJobForShop("active-job", "fixture.myshopify.com"),
    /cannot be deleted while it is active/,
  );
});

test("Job creation and execution preserve compare-at-only rules and snapshot only changes", async (t) => {
  let job: any;
  const snapshots: any[] = [];
  const updates: any[] = [];
  t.mock.method(prisma.priceJob, "create", async ({ data }: any) => {
    job = { ...data, id: "fixture-job" };
    return job;
  });
  t.mock.method(prisma.priceJob, "count", async () => 4);
  t.mock.method(prisma.priceJob, "findUnique", async () => job);
  t.mock.method(prisma.priceJob, "update", async ({ data }: any) => {
    Object.assign(job, data);
    return job;
  });
  t.mock.method(prisma.priceJob, "updateMany", async () => ({ count: 1 }));
  t.mock.method(prisma.priceSnapshot, "createMany", async ({ data }: any) => {
    snapshots.push(...data);
    return { count: data.length };
  });
  t.mock.method(prisma.auditLog, "create", async () => ({}));
  const rule: AdjustmentRule = {
    adjustmentType: "set",
    adjustmentDirection: "increase",
    adjustmentValue: 35,
    roundingMode: "none",
    compareAtMode: "unchanged",
    priceTargets: ["compareAtPrice"],
  };
  const id = await createJob({
    shop: "fixture.myshopify.com",
    rule,
    filters: {
      matchMode: "all",
      conditions: [{ field: "vendor", operator: "equals", value: "Example" }],
    },
  });
  const original: VariantData = {
    id: "gid://shopify/ProductVariant/1",
    numericId: "1",
    productId: "gid://shopify/Product/1",
    productTitle: "T-Shirt",
    title: "Small",
    price: "20.00",
    compareAtPrice: null,
    sku: null,
    inventoryQuantity: 5,
  };
  const admin = {
    graphql: async (_query: string, { variables }: any) => {
      updates.push(...variables.variants);
      return {
        json: async () => ({
          data: {
            productVariantsBulkUpdate: {
              productVariants: variables.variants,
              userErrors: [],
            },
          },
        }),
      };
    },
  };
  await executeJob(id, admin, "fixture.myshopify.com", [
    original,
    {
      ...original,
      id: "gid://shopify/ProductVariant/2",
      numericId: "2",
      compareAtPrice: "35.00",
    },
  ]);
  assert.equal(job.status, "completed");
  assert.equal(JSON.parse(job.filters).campaignName, "Adjustment 5");
  assert.equal(job.totalVariants, 1);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].price, "20.00");
  assert.equal(updates[0].compareAtPrice, "35.00");
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].originalCompareAtPrice, null);
  assert.equal(snapshots[0].newCompareAtPrice, "35.00");
});

test("Execution rechecks safeguards before any snapshot or Shopify mutation", async (t) => {
  let status = "pending";
  t.mock.method(prisma.priceJob, "updateMany", async () => ({ count: 1 }));
  t.mock.method(prisma.priceJob, "findUnique", async () => ({
    id: "guard-job",
    shop: "fixture.myshopify.com",
    adjustmentType: "fixed",
    adjustmentDirection: "decrease",
    adjustmentValue: 19,
    roundingMode: "none",
    compareAtMode: "unchanged",
    minPriceFloor: 5,
    maxPriceCeiling: null,
    guardBypassed: false,
    filters: JSON.stringify({ conditions: [], priceTargets: ["price"] }),
  }));
  t.mock.method(prisma.priceJob, "update", async ({ data }: any) => {
    if (data.status) status = data.status;
    return {};
  });
  t.mock.method(prisma.auditLog, "create", async () => ({}));
  const snapshot = t.mock.method(
    prisma.priceSnapshot,
    "createMany",
    async () => {
      throw new Error("Must not snapshot");
    },
  );
  let mutations = 0;
  await assert.rejects(
    executeJob(
      "guard-job",
      {
        graphql: async () => {
          mutations++;
        },
      },
      "fixture.myshopify.com",
      [
        {
          id: "gid://shopify/ProductVariant/1",
          numericId: "1",
          productId: "gid://shopify/Product/1",
          productTitle: "T-Shirt",
          title: "Small",
          price: "20.00",
          compareAtPrice: null,
          sku: null,
          inventoryQuantity: 5,
        },
      ],
    ),
    /safeguards/,
  );
  assert.equal(status, "failed");
  assert.equal(mutations, 0);
  assert.equal(snapshot.mock.callCount(), 0);
});

test("A second worker cannot apply an already claimed price job", async (t) => {
  t.mock.method(prisma.priceJob, "updateMany", async () => ({ count: 0 }));
  const lookup = t.mock.method(prisma.priceJob, "findUnique", unexpectedCall);
  const result = await executeJob("claimed-job", {}, "fixture.myshopify.com");
  assert.equal(result, null);
  assert.equal(lookup.mock.callCount(), 0);
});
