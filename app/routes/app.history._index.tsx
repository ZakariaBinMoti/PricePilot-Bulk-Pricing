import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, Link } from "react-router";
import {
  Page,
  Card,
  BlockStack,
  DataTable,
  Badge,
  Button,
  Pagination,
  EmptyState,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { getJobsForShop } from "../services/job-manager.server";
import { describeAdjustment } from "../services/price-calculator";
import { readJobCampaignName } from "../services/job-configuration";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1");

  const result = await getJobsForShop(session.shop, page, 15);
  return { ...result, currentPage: page };
};

function StatusBadge({ status }: { status: string }) {
  const statusMap: Record<string, { tone: any; label: string }> = {
    pending: { tone: "attention", label: "Pending" },
    scheduled: { tone: "info", label: "Scheduled" },
    processing: { tone: "info", label: "Processing" },
    completed: { tone: "success", label: "Completed" },
    failed: { tone: "critical", label: "Failed" },
    rolled_back: { tone: "warning", label: "Rolled Back" },
    cancelled: { tone: "subdued", label: "Cancelled" },
  };
  const config = statusMap[status] || { tone: "new", label: status };
  return <Badge tone={config.tone}>{config.label}</Badge>;
}

function formatDate(dateString: string) {
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
  if (job.adjustmentType === "percentage") return `${direction}${job.adjustmentValue}%`;
  return `${direction}$${job.adjustmentValue.toFixed(2)}`;
}

function formatFeatures(job: any) {
  const badges: string[] = [];
  if (job.isScheduled) badges.push("Scheduled");
  if (job.minPriceFloor || job.maxPriceCeiling) badges.push("Guards");
  return badges.length > 0 ? badges.join(" • ") : "Standard";
}

function formatCampaignAndRule(job: any) {
  const campaignName = readJobCampaignName(job.filters);
  return campaignName ? `${campaignName} — ${formatRule(job)}` : formatRule(job);
}

export default function HistoryIndexPage() {
  const { jobs, total, currentPage, totalPages } = useLoaderData<typeof loader>();

  return (
    <Page
      title="Price Adjustment & Audit History"
      subtitle={`${total} total adjustments & promotions recorded`}
      backAction={{ url: "/app" }}
      primaryAction={{ content: "New Adjustment", url: "/app/adjust" }}
    >
      <BlockStack gap="500">
        {jobs.length === 0 ? (
          <Card>
            <EmptyState
              heading="No adjustments recorded yet"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              action={{ content: "Create your first adjustment", url: "/app/adjust" }}
            >
              <p>
                When you launch price adjustments or schedule flash sales, they'll
                be logged here with full pre-update price snapshots and 1-click rollback.
              </p>
            </EmptyState>
          </Card>
        ) : (
          <Card>
            <DataTable
              columnContentTypes={["text", "text", "text", "numeric", "text", "text", "text"]}
              headings={["Date", "Campaign / Rule", "Type / Features", "Variants", "Rounding", "Status", "Action"]}
              rows={jobs.map((job: any) => [
                formatDate(job.createdAt),
                formatCampaignAndRule(job),
                formatFeatures(job),
                job._count.snapshots.toString(),
                job.roundingMode === "none" ? "—" : job.roundingMode,
                <StatusBadge key={job.id} status={job.status} />,
                <div
                  key={`actions-${job.id}`}
                  style={{ display: "flex", gap: "8px", whiteSpace: "nowrap" }}
                >
                  <Link to={`/app/history/${job.id}`}>
                    <Button size="slim" variant="plain">
                      Inspect & Rollback →
                    </Button>
                  </Link>
                  <Link to={`/app/history/${job.id}?editCampaign=1`}>
                    <Button size="slim" variant="plain">
                      Rename
                    </Button>
                  </Link>
                </div>,
              ])}
            />

            {totalPages > 1 && (
              <div style={{ display: "flex", justifyContent: "center", padding: "16px" }}>
                <Pagination
                  hasPrevious={currentPage > 1}
                  hasNext={currentPage < totalPages}
                  onPrevious={() => {
                    window.location.href = `/app/history?page=${currentPage - 1}`;
                  }}
                  onNext={() => {
                    window.location.href = `/app/history?page=${currentPage + 1}`;
                  }}
                />
              </div>
            )}
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}
