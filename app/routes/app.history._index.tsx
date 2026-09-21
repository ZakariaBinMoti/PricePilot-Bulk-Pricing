import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useActionData, useLoaderData, useNavigate, useNavigation, useSubmit } from "react-router";
import { useState } from "react";
import {
  Page,
  Card,
  BlockStack,
  DataTable,
  Badge,
  Pagination,
  EmptyState,
  Banner,
  Modal,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { deleteJobForShop, getJobsForShop, JobNotDeletableError } from "../services/job-manager.server";
import { describeAdjustment } from "../services/price-calculator";
import { readJobCampaignName } from "../services/job-configuration";
import { HistoryActions } from "../components/history-actions";

function readPage(value: string | null): number {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const page = readPage(url.searchParams.get("page"));

  const result = await getJobsForShop(session.shop, page, 15);
  return { ...result, currentPage: page };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  if (form.get("intent") !== "delete") {
    return Response.json({ error: "Unknown action." }, { status: 400 });
  }
  const jobId = form.get("jobId");
  if (typeof jobId !== "string" || !jobId) {
    return Response.json({ error: "Choose an adjustment to delete." }, { status: 400 });
  }
  try {
    await deleteJobForShop(jobId, session.shop);
    const page = readPage(String(form.get("page") || "1"));
    const { totalPages } = await getJobsForShop(session.shop, page, 15);
    return redirect(`/app/history?page=${Math.min(page, Math.max(1, totalPages))}`);
  } catch (error) {
    const notDeletable = error instanceof JobNotDeletableError;
    return Response.json({
      error: notDeletable ? error.message : "Unable to delete the adjustment. Please try again.",
    }, { status: notDeletable ? 409 : 500 });
  }
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
  if (job.adjustmentType === "set" || job.adjustmentType === "round") {
    return describeAdjustment(job);
  }
  const direction = job.adjustmentDirection === "increase" ? "+" : "-";
  if (job.adjustmentType === "percentage") return `${direction}${job.adjustmentValue}%`;
  return `${direction}$${job.adjustmentValue.toFixed(2)}`;
}

function formatFeatures(job: any) {
  const badges: string[] = [];
  if (job.isScheduled) badges.push("Scheduled");
  if (job.minPriceFloor || job.maxPriceCeiling) badges.push("Guards");
  return badges.length > 0 ? badges.join(" | ") : "Standard";
}

export default function HistoryIndexPage() {
  const { jobs, total, currentPage, totalPages } = useLoaderData<typeof loader>();
  const actionData = useActionData() as { error?: string } | undefined;
  const navigate = useNavigate();
  const navigation = useNavigation();
  const submit = useSubmit();
  const [jobToDelete, setJobToDelete] = useState<any>(null);
  const deleting = navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "delete";

  const confirmDelete = () => {
    if (!jobToDelete || deleting) return;
    const form = new FormData();
    form.set("intent", "delete");
    form.set("jobId", jobToDelete.id);
    form.set("page", String(currentPage));
    setJobToDelete(null);
    submit(form, { method: "post" });
  };

  return (
    <Page
      title="Price Adjustment & Audit History"
      subtitle={`${total} total adjustments & promotions recorded`}
      backAction={{ onAction: () => navigate("/app") }}
      primaryAction={{
        content: "New Adjustment",
        onAction: () => navigate("/app/adjust"),
      }}
    >
      <BlockStack gap="500">
        {actionData?.error && (
          <Banner title="Unable to delete adjustment" tone="critical">
            <p>{actionData.error}</p>
          </Banner>
        )}
        {deleting && (
          <Banner tone="info">
            <p>Deleting the adjustment from history…</p>
          </Banner>
        )}
        {jobs.length === 0 ? (
          <Card>
            <EmptyState
              heading="No adjustments recorded yet"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              action={{
                content: "Create your first adjustment",
                onAction: () => navigate("/app/adjust"),
              }}
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
              columnContentTypes={[
                "text",
                "text",
                "text",
                "text",
                "numeric",
                "text",
                "text",
                "text",
              ]}
              headings={[
                "Campaign",
                "Rule",
                "Date",
                "Type / Features",
                "Variants",
                "Rounding",
                "Status",
                "Actions",
              ]}
              rows={jobs.map((job: any) => [
                readJobCampaignName(job.filters) || "Untitled adjustment",
                formatRule(job),
                formatDate(job.createdAt),
                formatFeatures(job),
                job._count.snapshots.toString(),
                job.roundingMode === "none" ? "-" : job.roundingMode,
                <StatusBadge key={job.id} status={job.status} />,
                <HistoryActions key={`actions-${job.id}`} job={job} onDelete={setJobToDelete} />,
              ])}
            />

            {totalPages > 1 && (
              <div style={{ display: "flex", justifyContent: "center", padding: "16px" }}>
                <Pagination
                  hasPrevious={currentPage > 1}
                  hasNext={currentPage < totalPages}
                  onPrevious={() => {
                    navigate(`/app/history?page=${currentPage - 1}`);
                  }}
                  onNext={() => {
                    navigate(`/app/history?page=${currentPage + 1}`);
                  }}
                />
              </div>
            )}
          </Card>
        )}
      </BlockStack>
      <Modal
        open={Boolean(jobToDelete)}
        onClose={() => setJobToDelete(null)}
        title="Delete adjustment?"
        primaryAction={{ content: "Delete adjustment", destructive: true, onAction: confirmDelete }}
        secondaryActions={[{ content: "Keep adjustment", onAction: () => setJobToDelete(null) }]}
      >
        <Modal.Section>
          <p>
            This permanently removes {jobToDelete
              ? readJobCampaignName(jobToDelete.filters) || "this adjustment"
              : "this adjustment"} from history and deletes its saved price snapshots.
            You will no longer be able to roll it back. Current Shopify prices
            will not change, and audit events will remain. This cannot be undone.
          </p>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
