import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import {
  useActionData,
  useLoaderData,
  useSubmit,
  useNavigation,
  useNavigate,
} from "react-router";
import { useState } from "react";
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
  Modal,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import {
  getShopSubscription,
  createProSubscription,
  cancelProSubscription,
  PLANS,
} from "../services/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);

  // The return parameter is only a hint for the UI. Shopify's active
  // subscriptions query, not the URL, determines whether Pro is enabled.
  const chargeId = url.searchParams.get("charge_id");

  const subscription = await getShopSubscription(session.shop, admin);

  return {
    subscription,
    plans: PLANS,
    shop: session.shop,
    justUpgraded: Boolean(chargeId) && subscription.isPro,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session, redirect } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  const appUrl = process.env.SHOPIFY_APP_URL || process.env.RENDER_EXTERNAL_URL;
  if (!appUrl) {
    return Response.json({ error: "The public app URL is not configured." }, { status: 503 });
  }
  const returnUrl = new URL("/app/billing", appUrl).toString();

  if (intent === "upgrade_pro") {
    const current = await getShopSubscription(session.shop, admin);
    if (current.isPro) {
      return Response.json({ error: "Pro is already active for this store." }, { status: 409 });
    }
    const { confirmationUrl, error } = await createProSubscription(
      admin,
      session.shop,
      returnUrl
    );

    if (error || !confirmationUrl) {
      return Response.json({ error: error || "Failed to create subscription" }, { status: 400 });
    }

    // Shopify's redirect helper handles top-level navigation from an embedded app.
    return redirect(confirmationUrl, { target: "_top" });
  }

  if (intent === "downgrade_free") {
    try {
      await cancelProSubscription(session.shop, admin);
      return Response.json({ success: true, message: "Shopify subscription cancelled. Free plan is active." });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Cancellation failed." }, { status: 502 });
    }
  }

  return Response.json({ error: "Invalid action" }, { status: 400 });
};

export default function BillingPage() {
  const { subscription, plans, justUpgraded } = useLoaderData<typeof loader>();
  const actionData = useActionData() as
    | { error?: string }
    | undefined;
  const submit = useSubmit();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const isSubmitting = navigation.state === "submitting";
  const [confirmDowngrade, setConfirmDowngrade] = useState(false);

  const isPro = subscription.isPro;

  const handleUpgrade = () => {
    const formData = new FormData();
    formData.set("intent", "upgrade_pro");
    submit(formData, { method: "post" });
  };

  const handleDowngrade = () => {
    setConfirmDowngrade(false);
    const formData = new FormData();
    formData.set("intent", "downgrade_free");
    submit(formData, { method: "post" });
  };

  return (
    <Page
      title="Plans & Billing"
      subtitle="Choose the right plan to power your store promotions"
      backAction={{ onAction: () => navigate("/app") }}
    >
      <BlockStack gap="500">
        {actionData?.error && (
          <Banner title="Unable to start the Pro trial" tone="critical">
            <p>{actionData.error}</p>
          </Banner>
        )}
        {justUpgraded && (
          <Banner title="Welcome to PricePilot Pro! 🎉" tone="success">
            <p>
              Your 7-day free trial is now active. You have full access to automated
              sale scheduling, auto-revert rollbacks, and larger variant edits.
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
              : "Upgrade to Pro to unlock sale scheduling, auto-reverting flash sales, and larger product updates."}
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
                  <Button onClick={() => setConfirmDowngrade(true)} loading={isSubmitting}>
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
        <Modal
          open={confirmDowngrade}
          onClose={() => setConfirmDowngrade(false)}
          title="Cancel Pro subscription?"
          primaryAction={{ content: "Cancel Pro subscription", onAction: handleDowngrade, loading: isSubmitting }}
          secondaryActions={[{ content: "Keep Pro", onAction: () => setConfirmDowngrade(false) }]}
        >
          <Modal.Section>
            Shopify will stop the Pro subscription. Pro features may end immediately,
            and this cancellation does not request a prorated credit.
          </Modal.Section>
        </Modal>
      </BlockStack>
    </Page>
  );
}
