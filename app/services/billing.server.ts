/**
 * Billing Service for PricePilot
 *
 * Implements Shopify's official GraphQL Billing API for the Freemium model.
 * Free tier: Up to 50 variants per adjustment, instant rollback, basic rounding.
 * Pro tier ($14.99/month, 7-day trial): Unlimited adjustments, automated scheduling,
 * auto-revert sales, price floor/ceiling guards, priority processing.
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
      "⚡ Unlimited variants & products (no limit)",
      "⏰ Automated Sale Scheduling (set start date & time)",
      "↩️ Auto-Revert (automatically restore prices when sale ends)",
      "🛡️ Price Floor & Ceiling Safeguards with bypass warnings",
      "🚀 High-speed bulk background processing",
      "📜 Unlimited version control & price audit history",
      "Priority customer support",
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

/**
 * Check a shop's current subscription plan.
 */
export async function getShopSubscription(shop: string, admin?: any) {
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

  // Always reconcile the local record with Shopify when an authenticated Admin
  // client is available. A successful trial may not return a charge_id, so the
  // active subscription query is the source of truth.
  if (admin) {
    try {
      const response = await admin.graphql(GET_CURRENT_SUBSCRIPTION);
      const data = await response.json();
      const activeSubs = data.data?.currentAppInstallation?.activeSubscriptions || [];
      const activePro = activeSubs.find(
        (s: any) => s.status === "ACTIVE" && s.name === PLANS.PRO.name,
      );

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
      } else if (sub.plan === "PRO") {
        sub = await prisma.subscription.update({
          where: { shop },
          data: { plan: "FREE", status: "CANCELLED" },
        });
      }
    } catch (e) {
      console.warn("Could not verify Shopify subscription via GraphQL:", e);
    }
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
  isTest: boolean = process.env.NODE_ENV !== "production"
): Promise<{ confirmationUrl: string | null; error: string | null }> {
  try {
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

/**
 * Activate subscription in local database once confirmed.
 */
export async function activateProPlan(shop: string, chargeId?: string) {
  return prisma.subscription.upsert({
    where: { shop },
    update: {
      plan: "PRO",
      status: "ACTIVE",
      shopifyChargeId: chargeId,
    },
    create: {
      shop,
      plan: "PRO",
      status: "ACTIVE",
      shopifyChargeId: chargeId,
    },
  });
}

/**
 * Downgrade to Free plan.
 */
export async function downgradeToFree(shop: string) {
  return prisma.subscription.upsert({
    where: { shop },
    update: {
      plan: "FREE",
      status: "ACTIVE",
    },
    create: {
      shop,
      plan: "FREE",
      status: "ACTIVE",
    },
  });
}
