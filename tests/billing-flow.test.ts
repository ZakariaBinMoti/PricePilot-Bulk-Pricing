import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";

let subscription: any = null;
const prisma = {
  subscription: {
    findUnique: async () => subscription,
    create: async ({ data }: any) => (subscription = { ...data }),
    update: async ({ data }: any) => (subscription = { ...subscription, ...data }),
  },
};
globalThis.prisma = prisma as unknown as PrismaClient;
const { getShopSubscription, cancelProSubscription, createProSubscription } =
  await import("../app/services/billing.server.ts");

function adminWith(active: any[] = []) {
  return {
    graphql: async (query: string) => ({
      json: async () => query.includes("appSubscriptionCancel")
        ? { data: { appSubscriptionCancel: { appSubscription: { status: "CANCELLED" }, userErrors: [] } } }
        : { data: { currentAppInstallation: { activeSubscriptions: active } } },
    }),
  };
}

test("Pro access requires a verified active Shopify subscription", async () => {
  subscription = { shop: "fixture.myshopify.com", plan: "PRO", status: "ACTIVE", shopifyChargeId: "old" };
  await assert.rejects(
    getShopSubscription(subscription.shop, { graphql: async () => { throw new Error("offline"); } }),
    /offline/,
  );
  const result = await getShopSubscription(subscription.shop, adminWith());
  assert.equal(result.isPro, false);
  assert.equal(result.shopifyChargeId, null);
  assert.equal(result.plan, "FREE");
});

test("Cancelling Pro calls Shopify before removing access", async () => {
  const shop = "fixture.myshopify.com";
  const active = { id: "gid://shopify/AppSubscription/1", name: "PricePilot Pro", status: "ACTIVE" };
  subscription = { shop, plan: "PRO", status: "ACTIVE", shopifyChargeId: active.id };
  let cancelled = false;
  const admin = {
    graphql: async (query: string, options?: any) => {
      if (query.includes("appSubscriptionCancel")) {
        assert.equal(options.variables.id, active.id);
        cancelled = true;
        return { json: async () => ({ data: { appSubscriptionCancel: { appSubscription: { id: active.id, status: "CANCELLED" }, userErrors: [] } } }) };
      }
      return { json: async () => ({ data: { currentAppInstallation: { activeSubscriptions: cancelled ? [] : [active] } } }) };
    },
  };
  const result = await cancelProSubscription(shop, admin);
  assert.equal(cancelled, true);
  assert.equal(result.isPro, false);
  assert.equal(result.plan, "FREE");
});

test("Failed Shopify cancellation keeps Pro unchanged", async () => {
  const shop = "fixture.myshopify.com";
  const active = { id: "gid://shopify/AppSubscription/1", name: "PricePilot Pro", status: "ACTIVE" };
  subscription = { shop, plan: "PRO", status: "ACTIVE", shopifyChargeId: active.id };
  await assert.rejects(cancelProSubscription(shop, {
    graphql: async (query: string) => ({ json: async () => query.includes("appSubscriptionCancel")
      ? { data: { appSubscriptionCancel: { appSubscription: null, userErrors: [{ message: "Denied" }] } } }
      : { data: { currentAppInstallation: { activeSubscriptions: [active] } } } }),
  }), /Denied/);
  assert.equal(subscription.plan, "PRO");
});

test("Billing test flag is sent to Shopify", async () => {
  let variables: any;
  const result = await createProSubscription({
    graphql: async (query: string, options: any) => {
      if (query.includes("partnerDevelopment")) {
        return { json: async () => ({ data: { shop: { plan: { partnerDevelopment: true } } } }) };
      }
      variables = options.variables;
      return { json: async () => ({ data: { appSubscriptionCreate: { confirmationUrl: "https://shopify.test/confirm", userErrors: [] } } }) };
    },
  }, "fixture.myshopify.com", "https://example.com/app/billing", true);
  assert.equal(variables.test, true);
  assert.equal(variables.trialDays, 7);
  assert.equal(result.confirmationUrl, "https://shopify.test/confirm");
});

test("A test subscription cannot be created for a non-development store", async () => {
  let created = false;
  const result = await createProSubscription({
    graphql: async (query: string) => {
      if (query.includes("appSubscriptionCreate")) created = true;
      return { json: async () => ({ data: { shop: { plan: { partnerDevelopment: false } } } }) };
    },
  }, "merchant.myshopify.com", "https://example.com/app/billing", true);
  assert.equal(created, false);
  assert.match(result.error || "", /development store/);
});
