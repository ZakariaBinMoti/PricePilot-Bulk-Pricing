import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, Link } from "react-router";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  DataTable,
  Banner,
  EmptyState,
  Box,
  InlineGrid,
  Divider,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { getDashboardStats } from "../services/job-manager.server";
import { getShopSubscription } from "../services/billing.server";
import { describeAdjustment } from "../services/price-calculator";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [stats, subscription] = await Promise.all([
    getDashboardStats(session.shop),
    getShopSubscription(session.shop, admin),
  ]);

  return { stats, subscription, shop: session.shop };
};

function StatusBadge({ status }: { status: string }) {
  const statusMap: Record<string, { tone: any; label: string }> = {
    pending: { tone: "attention", label: "Pending" },
    scheduled: { tone: "info", label: "Scheduled" },
    processing: { tone: "info", label: "Processing" },
    completed: { tone: "success", label: "Completed" },
    failed: { tone: "critical", label: "Failed" },
    rolled_back: { tone: "warning", label: "Rolled Back" },
  };
  const config = statusMap[status] || { tone: "new", label: status };
  return <Badge tone={config.tone}>{config.label}</Badge>;
}

function formatDate(dateString: string | null) {
  if (!dateString) return "—";
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRule(job: any) {
  if (job.adjustmentType === "set" || job.adjustmentType === "round") return describeAdjustment(job);
  const direction = job.adjustmentDirection === "increase" ? "+" : "-";
  const symbol = job.adjustmentType === "percentage" ? "%" : "$";
  if (job.adjustmentType === "percentage") {
    return `${direction}${job.adjustmentValue}${symbol}`;
  }
  return `${direction}${symbol}${job.adjustmentValue.toFixed(2)}`;
}

export default function DashboardPage() {
  const { stats, subscription } = useLoaderData<typeof loader>();

  const hasJobs = stats.totalJobs > 0;
  const hasActiveJobs = stats.activeJobs.length > 0;
  const scheduledJobs = stats.scheduledJobs || [];

  return (
    <Page
      title="PricePilot ‑ Bulk Pricing"
      subtitle="High-speed bulk price adjustments, sale scheduling & profit safeguards"
      primaryAction={{
        content: "⚡ New Adjustment",
        url: "/app/adjust",
      }}
      secondaryActions={[
        {
          content: "💳 Plans & Billing",
          url: "/app/billing",
        },
      ]}
    >
      <BlockStack gap="500">
        {/* Subscription Plan Badge */}
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="200" blockAlign="center">
            <Text variant="bodyMd" as="span" tone="subdued">
              Plan:
            </Text>
            {subscription.isPro ? (
              <Badge tone="success">PricePilot Pro (Active)</Badge>
            ) : (
              <Badge tone="info">Free Starter Plan</Badge>
            )}
          </InlineStack>

          {!subscription.isPro && (
            <Link to="/app/billing">
              <Button variant="plain">Upgrade to Pro for Automated Scheduling →</Button>
            </Link>
          )}
        </InlineStack>

        {/* Active Jobs Banner */}
        {hasActiveJobs && (
          <Banner
            title={`${stats.activeJobs.length} adjustment job(s) currently processing`}
            tone="info"
          >
            <p>
              Background workers are applying prices directly to your Shopify catalog.
              You can safely navigate away or inspect progress in the Audit History.
            </p>
          </Banner>
        )}

        {/* Scheduled Sales Section */}
        {scheduledJobs.length > 0 && (
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingMd" as="h2">
                  ⏰ Upcoming Scheduled Sales ({scheduledJobs.length})
                </Text>
                <Badge tone="attention">Automated</Badge>
              </InlineStack>
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "text"]}
                headings={["Starts At", "Rule", "Auto-Revert", "Status", "Action"]}
                rows={scheduledJobs.map((job: any) => [
                  formatDate(job.scheduledStartAt),
                  formatRule(job),
                  job.autoRevert ? `Yes (at ${formatDate(job.scheduledEndAt)})` : "No",
                  <StatusBadge key={job.id} status={job.status} />,
                  <Link key={`link-${job.id}`} to={`/app/history/${job.id}`}>
                    <Button size="slim">Manage</Button>
                  </Link>,
                ])}
              />
            </BlockStack>
          </Card>
        )}

        {/* Stats Cards */}
        <InlineGrid columns={3} gap="400">
          <Card>
            <BlockStack gap="200">
              <Text variant="headingSm" as="h3">
                Total Adjustments
              </Text>
              <Text variant="heading2xl" as="p">
                {stats.totalJobs}
              </Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text variant="headingSm" as="h3">
                Completed Jobs
              </Text>
              <Text variant="heading2xl" as="p">
                {stats.completedJobs}
              </Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text variant="headingSm" as="h3">
                Variants Updated
              </Text>
              <Text variant="heading2xl" as="p">
                {stats.totalVariantsUpdated.toLocaleString()}
              </Text>
            </BlockStack>
          </Card>
        </InlineGrid>

        {/* Quick Actions */}
        <Card>
          <BlockStack gap="400">
            <Text variant="headingMd" as="h2">
              Quick Actions
            </Text>
            <InlineStack gap="300">
              <Link to="/app/adjust">
                <Button variant="primary" size="large">
                  ⚡ New Price Adjustment
                </Button>
              </Link>
              <Link to="/app/history">
                <Button size="large">📜 Audit & Rollback History</Button>
              </Link>
              <Link to="/app/billing">
                <Button size="large">💎 Manage Subscription</Button>
              </Link>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Recent Activity */}
        <Card>
          <BlockStack gap="400">
            <Text variant="headingMd" as="h2">
              Recent Price Adjustments
            </Text>

            {!hasJobs ? (
              <EmptyState
                heading="No price adjustments executed yet"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                action={{
                  content: "Create your first adjustment",
                  url: "/app/adjust",
                }}
              >
                <p>
                  Target your products by collection, tags, or vendor, set your
                  percentage or dollar rule, preview live changes, and launch with 1-click.
                </p>
              </EmptyState>
            ) : (
              <DataTable
                columnContentTypes={[
                  "text",
                  "text",
                  "numeric",
                  "text",
                  "text",
                ]}
                headings={[
                  "Date",
                  "Rule",
                  "Variants",
                  "Status",
                  "Action",
                ]}
                rows={stats.recentJobs.map((job: any) => [
                  formatDate(job.createdAt),
                  formatRule(job),
                  job._count.snapshots.toString(),
                  <StatusBadge key={job.id} status={job.status} />,
                  <Link key={`link-${job.id}`} to={`/app/history/${job.id}`}>
                    <Button size="slim">Details & Rollback</Button>
                  </Link>,
                ])}
              />
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
