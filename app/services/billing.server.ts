/**
 * Billing Service for PricePilot
 *
 * Implements Shopify's official GraphQL Billing API for the Freemium model.
 * Free tier: Up to 50 variants per adjustment, instant rollback, basic rounding.
 * Pro tier ($14.99/month, 7-day trial): larger adjustments, automated scheduling,
 * auto-revert sales, and price floor/ceiling guard overrides.
 */

import prisma from "../db.server.ts";

export const PLANS = {
  FREE: {
    name: "Free Starter",
    id: "FREE",
    price: 0,
    variantLimit: 50,
    schedulingAllowed: false,
    guardsAllowed: true,
    features: [
      "Up to 50 variants per bulk edit",
      "Percentage & Fixed price changes",
      "Compare-at strikethrough price sync",
      "Psychological rounding (.99, .95, .00)",
      "1-Click manual rollback (snapshots)",
      "Standard audit history",
    ],
  },
  PRO: {
    name: "PricePilot Pro",
    id: "PRO",
    price: 14.99,
    interval: "EVERY_30_DAYS",
    trialDays: 7,
    variantLimit: Infinity,
    schedulingAllowed: true,
    guardsAllowed: true,
    features: [
      "Adjust more than 50 variants per job",
      "⏰ Automated Sale Scheduling (set start date & time)",
      "↩️ Auto-Revert (automatically restore prices when sale ends)",
      "🛡️ Price Floor & Ceiling Safeguards with bypass warnings",
      "Price adjustment history and manual rollback",
    ],
  },
};

const APP_SUBSCRIPTION_CREATE_MUTATION = `#graphql
  mutation AppSubscriptionCreate(
    $name: String!
    $returnUrl: URL!
    $lineItems: [AppSubscriptionLineItemInput!]!
    $trialDays: Int
    $test: Boolean
  ) {
    appSubscriptionCreate(
      name: $name
      returnUrl: $returnUrl
      lineItems: $lineItems
      trialDays: $trialDays
      test: $test
    ) {
      appSubscription {
        id
        status
      }
      confirmationUrl
      userErrors {
        field
        message
      }
    }
  }
`;

const GET_CURRENT_SUBSCRIPTION = `#graphql
  query GetCurrentSubscription {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        currentPeriodEnd
        lineItems {
          plan {
            pricingDetails {
              ... on AppRecurringPricing {
                price {
                  amount
                  currencyCode
                }
                interval
              }
            }
          }
        }
      }
    }
  }
`;

const CANCEL_SUBSCRIPTION = `#graphql
  mutation CancelSubscription($id: ID!) {
    appSubscriptionCancel(id: $id) {
      appSubscription { id status }
      userErrors { field message }
    }
  }
`;

const SHOP_PLAN = `#graphql
  query BillingTestStore {
    shop { plan { partnerDevelopment } }
  }
`;

async function activeProSubscription(admin: any) {
  const response = await admin.graphql(GET_CURRENT_SUBSCRIPTION);
  const result = await response.json();
  if (result.errors?.length || !result.data?.currentAppInstallation) {
    throw new Error("Could not verify the Shopify subscription.");
  }
  return result.data.currentAppInstallation.activeSubscriptions?.find(
    (subscription: any) =>
      subscription.status === "ACTIVE" && subscription.name === PLANS.PRO.name,
  ) ?? null;
}

/**
 * Check a shop's current subscription plan.
 */
export async function getShopSubscription(shop: string, admin: any) {
  // First check database
  let sub = await prisma.subscription.findUnique({
    where: { shop },
  });

  if (!sub) {
    sub = await prisma.subscription.create({
      data: {
        shop,
        plan: "FREE",
        status: "ACTIVE",
      },
    });
  }

  // A successful trial may not return a charge_id. Shopify is authoritative;
  // never grant Pro from a stale local record.
  const activePro = await activeProSubscription(admin);
  if (activePro) {
    sub = await prisma.subscription.update({
      where: { shop },
      data: {
        plan: "PRO",
        status: "ACTIVE",
        shopifyChargeId: activePro.id,
        currentPeriodEnd: activePro.currentPeriodEnd
          ? new Date(activePro.currentPeriodEnd)
          : null,
      },
    });
  } else if (sub.plan !== "FREE" || sub.shopifyChargeId) {
    sub = await prisma.subscription.update({
      where: { shop },
      data: { plan: "FREE", status: "ACTIVE", shopifyChargeId: null, currentPeriodEnd: null },
    });
  }

  const planDetails = sub.plan === "PRO" ? PLANS.PRO : PLANS.FREE;

  return {
    ...sub,
    isPro: sub.plan === "PRO" && sub.status === "ACTIVE",
    planDetails,
  };
}

/**
 * Create a Shopify recurring application charge for the Pro plan.
 */
export async function createProSubscription(
  admin: any,
  shop: string,
  returnUrl: string,
  isTest: boolean =
    process.env.SHOPIFY_BILLING_TEST === "true" ||
    process.env.NODE_ENV !== "production"
): Promise<{ confirmationUrl: string | null; error: string | null }> {
  try {
    if (isTest) {
      const planResponse = await admin.graphql(SHOP_PLAN);
      const plan = await planResponse.json();
      if (plan.errors?.length || plan.data?.shop?.plan?.partnerDevelopment !== true) {
        return { confirmationUrl: null, error: "Test billing is allowed only on a Shopify development store." };
      }
    }
    const response = await admin.graphql(APP_SUBSCRIPTION_CREATE_MUTATION, {
      variables: {
        name: PLANS.PRO.name,
        returnUrl,
        trialDays: PLANS.PRO.trialDays,
        test: isTest,
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: {
                  amount: PLANS.PRO.price,
                  currencyCode: "USD",
                },
                interval: PLANS.PRO.interval,
              },
            },
          },
        ],
      },
    });

    const result = await response.json();
    const data = result.data?.appSubscriptionCreate;

    if (data?.userErrors?.length > 0) {
      return {
        confirmationUrl: null,
        error: data.userErrors.map((e: any) => e.message).join(", "),
      };
    }

    if (result.errors?.length || !data?.confirmationUrl) {
      return { confirmationUrl: null, error: "Shopify did not create a subscription confirmation." };
    }
    return {
      confirmationUrl: data.confirmationUrl,
      error: null,
    };
  } catch (error) {
    return {
      confirmationUrl: null,
      error: error instanceof Error ? error.message : "Failed to initiate subscription",
    };
  }
}

/** Cancel with Shopify first, then reconcile local state from Shopify. */
export async function cancelProSubscription(shop: string, admin: any) {
  const activePro = await activeProSubscription(admin);
  if (!activePro) return getShopSubscription(shop, admin);

  const response = await admin.graphql(CANCEL_SUBSCRIPTION, {
    variables: { id: activePro.id },
  });
  const result = await response.json();
  const cancellation = result.data?.appSubscriptionCancel;
  if (result.errors?.length || cancellation?.userErrors?.length ||
      cancellation?.appSubscription?.status !== "CANCELLED") {
    throw new Error(
      cancellation?.userErrors?.map((error: any) => error.message).join("; ") ||
      "Shopify did not confirm subscription cancellation.",
    );
  }
  return getShopSubscription(shop, admin);
}
