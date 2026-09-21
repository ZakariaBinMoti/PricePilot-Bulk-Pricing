import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";

const updates: any[] = [];
const prisma = {
  priceJob: {
    findMany: async () => [],
    updateMany: async (args: any) => {
      updates.push(args);
      return { count: 0 };
    },
  },
  subscription: {
    findUnique: async () => ({ shop: "fixture.myshopify.com", plan: "FREE", status: "ACTIVE" }),
  },
};
globalThis.prisma = prisma as unknown as PrismaClient;
const { processDueScheduledJobs } = await import("../app/services/scheduler.server.ts");

test("Scheduler identifies interrupted updates without replaying price mutations", async () => {
  const result = await processDueScheduledJobs(async () => {
    throw new Error("No Shopify request expected");
  });
  assert.deepEqual(result, { startedCount: 0, revertedCount: 0, failedCount: 0 });
  assert.equal(updates[0].where.status, "processing");
  assert.equal(updates[0].data.status, "failed");
  assert.equal(updates[1].where.scheduleStatus, "reverting");
  assert.equal(updates[1].data.scheduleStatus, "sale_active");
});

test("A scheduled Pro sale is cancelled when Shopify no longer shows Pro", async (t) => {
  const job = { id: "sale-1", shop: "fixture.myshopify.com" };
  t.mock.method(prisma.priceJob, "findMany", async ({ where }: any) =>
    where.status === "scheduled" ? [job] : [],
  );
  const result = await processDueScheduledJobs(async () => ({
    graphql: async () => ({ json: async () => ({ data: { currentAppInstallation: { activeSubscriptions: [] } } }) }),
  }));
  assert.equal(result.startedCount, 0);
  assert.equal(result.failedCount, 0);
  assert.ok(updates.some((args) => args.where.id === job.id && args.data.status === "cancelled"));
});
