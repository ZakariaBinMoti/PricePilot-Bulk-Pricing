import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useSubmit, useNavigation } from "react-router";
import { redirect } from "react-router";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Banner,
  Box,
  Divider,
  List,
  InlineGrid,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import {
  getShopSubscription,
  createProSubscription,
  activateProPlan,
  downgradeToFree,
  PLANS,
} from "../services/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);

  // Check if returning from Shopify billing confirmation
  const chargeId = url.searchParams.get("charge_id");
  if (chargeId) {
    await activateProPlan(session.shop, chargeId);
  }

  const subscription = await getShopSubscription(session.shop, admin);

  return {
    subscription,
    plans: PLANS,
    shop: session.shop,
    justUpgraded: Boolean(chargeId),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  const url = new URL(request.url);
  const returnUrl = `${url.origin}/app/billing`;

  if (intent === "upgrade_pro") {
    const { confirmationUrl, error } = await createProSubscription(
      admin,
      session.shop,
      returnUrl
    );

    if (error || !confirmationUrl) {
      return Response.json({ error: error || "Failed to create subscription" }, { status: 400 });
    }

    // Redirect merchant to Shopify's confirmation screen
    return redirect(confirmationUrl);
  }

  if (intent === "downgrade_free") {
    await downgradeToFree(session.shop);
    return Response.json({ success: true, message: "Downgraded to Free plan." });
  }

  return Response.json({ error: "Invalid action" }, { status: 400 });
};

export default function BillingPage() {
  const { subscription, plans, justUpgraded } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const isPro = subscription.isPro;

  const handleUpgrade = () => {
    const formData = new FormData();
    formData.set("intent", "upgrade_pro");
    submit(formData, { method: "post" });
  };

  const handleDowngrade = () => {
    const formData = new FormData();
    formData.set("intent", "downgrade_free");
    submit(formData, { method: "post" });
  };

  return (
    <Page
      title="Plans & Billing"
      subtitle="Choose the right plan to power your store promotions"
      backAction={{ url: "/app" }}
    >
      <BlockStack gap="500">
        {justUpgraded && (
          <Banner title="Welcome to PricePilot Pro! 🎉" tone="success">
            <p>
              Your 7-day free trial is now active. You have full access to automated
              sale scheduling, auto-revert rollbacks, and unlimited variant edits.
            </p>
          </Banner>
        )}

        {/* Current Plan Banner */}
        <Banner
          title={`You are currently on the ${isPro ? "Pro Plan" : "Free Starter Plan"}`}
          tone={isPro ? "success" : "info"}
        >
          <p>
            {isPro
              ? "All features including sale scheduling, auto-revert, and price safeguards are unlocked."
              : "Upgrade to Pro to unlock sale scheduling, auto-reverting flash sales, and unlimited product updates."}
          </p>
        </Banner>

        <InlineGrid columns={2} gap="500">
          {/* FREE PLAN */}
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingLg" as="h2">
                  {plans.FREE.name}
                </Text>
                {!isPro ? (
                  <Badge tone="success">Current Plan</Badge>
                ) : (
                  <Badge>Basic</Badge>
                )}
              </InlineStack>

              <Text variant="heading2xl" as="p">
                $0{" "}
                <Text as="span" variant="bodySm" tone="subdued">
                  / forever
                </Text>
              </Text>

              <Text as="p" tone="subdued">
                Great for small shops and occasional quick discounts.
              </Text>

              <Divider />

              <List>
                {plans.FREE.features.map((feature, idx) => (
                  <List.Item key={idx}>✓ {feature}</List.Item>
                ))}
              </List>

              <Box paddingBlockStart="400">
                {isPro ? (
                  <Button onClick={handleDowngrade} loading={isSubmitting}>
                    Downgrade to Free
                  </Button>
                ) : (
                  <Button disabled>Active Plan</Button>
                )}
              </Box>
            </BlockStack>
          </Card>

          {/* PRO PLAN */}
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingLg" as="h2">
                  {plans.PRO.name}
                </Text>
                {isPro ? (
                  <Badge tone="success">Active Plan</Badge>
                ) : (
                  <Badge tone="attention">7-Day Free Trial</Badge>
                )}
              </InlineStack>

              <Text variant="heading2xl" as="p">
                ${plans.PRO.price}{" "}
                <Text as="span" variant="bodySm" tone="subdued">
                  / month
                </Text>
              </Text>

              <Text as="p" tone="subdued">
                For high-growth stores running seasonal flash sales, BFCM events,
                and large catalogs.
              </Text>

              <Divider />

              <List>
                {plans.PRO.features.map((feature, idx) => (
                  <List.Item key={idx}>✓ {feature}</List.Item>
                ))}
              </List>

              <Box paddingBlockStart="400">
                {!isPro ? (
                  <Button
                    variant="primary"
                    size="large"
                    onClick={handleUpgrade}
                    loading={isSubmitting}
                  >
                    Start 7-Day Free Trial
                  </Button>
                ) : (
                  <Button disabled variant="primary">
                    Current Plan
                  </Button>
                )}
              </Box>
            </BlockStack>
          </Card>
        </InlineGrid>
      </BlockStack>
    </Page>
  );
}
