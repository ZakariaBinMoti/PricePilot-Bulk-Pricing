import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import {
  useLoaderData,
  useSubmit,
  useNavigation,
  useRevalidator,
  useSearchParams,
  useNavigate,
} from "react-router";
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
  ProgressBar,
  Divider,
  Modal,
  Box,
  DescriptionList,
  TextField,
} from "@shopify/polaris";
import { useState, useEffect } from "react";
import { authenticate } from "../shopify.server";
import {
  getJob,
  executeRollback,
  updateJobCampaignName,
} from "../services/job-manager.server";
import { cancelScheduledJob } from "../services/scheduler.server";
import { loadSnapshot, getSnapshotStats } from "../services/snapshot.server";
import { formatPriceDisplay, describeAdjustment } from "../services/price-calculator";
import { describeConditions } from "../services/product-conditions";
import { readJobCampaignName, readJobTargets } from "../services/job-configuration";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const jobId = params.jobId;

  if (!jobId) throw new Response("Job ID required", { status: 400 });

  const job = await getJob(jobId);
  if (!job) throw new Response("Job not found", { status: 404 });
  if (job.shop !== session.shop) throw new Response("Unauthorized", { status: 403 });

  // Load snapshot data (first 100 entries for display)
  const snapshots = await loadSnapshot(jobId);
  const snapshotStats = await getSnapshotStats(jobId);
  const displaySnapshots = snapshots.slice(0, 100);

  return {
    job,
    snapshots: displaySnapshots,
    totalSnapshots: snapshots.length,
    stats: snapshotStats,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const jobId = params.jobId;

  if (!jobId) throw new Response("Job ID required", { status: 400 });

  if (intent === "rollback") {
    try {
      await executeRollback(jobId, admin, session.shop);
      return Response.json({ success: true, message: "Prices successfully rolled back!" });
    } catch (error) {
      return Response.json({
        success: false,
        message: error instanceof Error ? error.message : "Rollback failed",
      });
    }
  }

  if (intent === "cancel_schedule") {
    try {
      await cancelScheduledJob(jobId, session.shop);
      return Response.json({ success: true, message: "Scheduled promotion cancelled." });
    } catch (error) {
      return Response.json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to cancel schedule",
      });
    }
  }

  if (intent === "rename_campaign") {
    try {
      await updateJobCampaignName(
        jobId,
        session.shop,
        String(formData.get("campaignName") || ""),
      );
      return Response.json({ success: true, message: "Campaign name updated." });
    } catch (error) {
      return Response.json({
        success: false,
        message: error instanceof Error ? error.message : "Unable to update campaign name.",
      });
    }
  }

  return Response.json({ success: false, message: "Unknown action" });
};

function StatusBadge({ status }: { status: string }) {
  const statusMap: Record<string, { tone: any; label: string }> = {
    pending: { tone: "info", label: "Pending" },
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

function formatDate(dateInput: string | Date | null | undefined) {
  if (!dateInput) return "—";
  return new Date(dateInput).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatFilters(filtersJson: string): Array<{ term: string; description: string }> {
  try {
    const filters = JSON.parse(filtersJson);
    const items: Array<{ term: string; description: string }> = [];
    if (filters.conditions?.length) {
      items.push({ term: "Matching", description: filters.matchMode === "any" ? "Any condition" : "All conditions" });
      describeConditions(filters).forEach((description, index) => items.push({ term: `Condition ${index + 1}`, description }));
    }
    if (filters.collectionId) items.push({ term: "Collection", description: filters.collectionId });
    if (filters.tags?.length) items.push({ term: "Tags", description: filters.tags.join(", ") });
    if (filters.titleKeyword) items.push({ term: "Title keyword", description: filters.titleKeyword });
    if (filters.productType) items.push({ term: "Product Type", description: filters.productType });
    if (filters.vendor) items.push({ term: "Vendor", description: filters.vendor });
    if (filters.status) items.push({ term: "Status", description: filters.status });
    if (items.length === 0) items.push({ term: "Target", description: "All products" });
    return items;
  } catch {
    return [{ term: "Target", description: "All products" }];
  }
}

export default function JobDetailPage() {
  const navigate = useNavigate();
  const { job, snapshots, totalSnapshots, stats } =
    useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const isLoading = navigation.state === "submitting";

  const [showRollbackModal, setShowRollbackModal] = useState(false);
  const [showCampaignModal, setShowCampaignModal] = useState(
    () => searchParams.get("editCampaign") === "1",
  );
  const [campaignDraft, setCampaignDraft] = useState("");
  const [campaignError, setCampaignError] = useState("");

  const canRollback = job.status === "completed" && totalSnapshots > 0;
  const isProcessing = job.status === "processing" || job.status === "pending";
  const revalidator = useRevalidator();
  useEffect(() => {
    if (!isProcessing) return;
    const timer = setInterval(() => { if (revalidator.state === "idle") void revalidator.revalidate(); }, 2000);
    return () => clearInterval(timer);
  }, [isProcessing, revalidator]);
  const isScheduledWait = job.status === "scheduled";
  const progress =
    job.totalVariants > 0
      ? Math.round((job.processedVariants / job.totalVariants) * 100)
      : 0;

  const ruleText = describeAdjustment(job);
  const priceTargets = readJobTargets(job.filters);
  const campaignName = readJobCampaignName(job.filters);

  useEffect(() => {
    if (showCampaignModal) setCampaignDraft(campaignName || "");
  }, [showCampaignModal, campaignName]);

  const handleRollback = () => {
    const formData = new FormData();
    formData.set("intent", "rollback");
    submit(formData, { method: "post" });
    setShowRollbackModal(false);
  };

  const handleCancelSchedule = () => {
    const formData = new FormData();
    formData.set("intent", "cancel_schedule");
    submit(formData, { method: "post" });
  };

  const openCampaignEditor = () => {
    setCampaignDraft(campaignName || "");
    setCampaignError("");
    setShowCampaignModal(true);
  };

  const saveCampaignName = () => {
    const name = campaignDraft.trim();
    if (!name) {
      setCampaignError("Enter a campaign name.");
      return;
    }
    const formData = new FormData();
    formData.set("intent", "rename_campaign");
    formData.set("campaignName", name);
    submit(formData, { method: "post" });
    setShowCampaignModal(false);
  };

  return (
    <Page
      title={campaignName || `Adjustment: ${ruleText}`}
      subtitle={`${campaignName ? `${ruleText} • ` : ""}Created ${formatDate(job.createdAt)}`}
      backAction={{ onAction: () => navigate("/app/history") }}
      secondaryActions={[
        {
          content: campaignName ? "Rename campaign" : "Name campaign",
          onAction: openCampaignEditor,
        },
        ...(canRollback
          ? [
              {
                content: "↩️ Rollback All Prices",
                destructive: true,
                onAction: () => setShowRollbackModal(true),
              },
            ]
          : []),
        ...(isScheduledWait
          ? [
              {
                content: "Cancel Scheduled Sale",
                destructive: true,
                onAction: handleCancelSchedule,
              },
            ]
          : []),
      ]}
    >
      <BlockStack gap="500">
        {/* Processing Banner */}
        {isProcessing && (
          <Banner title="Job in progress" tone="info">
            <BlockStack gap="200">
              <Text as="p">
                Processing {job.processedVariants} of {job.totalVariants}{" "}
                variants...
              </Text>
              <ProgressBar progress={progress} size="small" />
            </BlockStack>
          </Banner>
        )}

        {/* Scheduled Banner */}
        {isScheduledWait && (
          <Banner title="⏰ Scheduled Sale Pending Launch" tone="info">
            <p>
              This promotion will automatically execute on{" "}
              <strong>{formatDate(job.scheduledStartAt)}</strong>.
              {job.autoRevert &&
                ` Prices will automatically revert on ${formatDate(job.scheduledEndAt)}.`}
            </p>
          </Banner>
        )}

        {/* Job was rolled back */}
        {job.status === "rolled_back" && (
          <Banner title="This adjustment was rolled back" tone="warning">
            <p>All catalog prices were restored to their original snapshot values.</p>
          </Banner>
        )}

        {/* Job failed */}
        {job.status === "failed" && (
          <Banner title="This adjustment failed" tone="critical">
            <p>
              {job.errorLog
                ? JSON.parse(job.errorLog)
                    .map((e: any) => e.message)
                    .join("; ")
                : "An unexpected error occurred."}
            </p>
          </Banner>
        )}

        <Layout>
          {/* Job Details */}
          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text variant="headingMd" as="h2">
                    Job Details
                  </Text>
                  <StatusBadge status={job.status} />
                </InlineStack>

                <DescriptionList
                  items={[
                    { term: "Campaign", description: campaignName || "Untitled adjustment" },
                    { term: "Rule", description: ruleText },
                    { term: "Price fields", description: priceTargets?.map((target) => target === "price" ? "Main Price" : "Compare-at Price").join(", ") || "Main Price with compare-at synchronization" },
                    {
                      term: "Rounding",
                      description:
                        job.roundingMode === "none"
                          ? "None"
                          : job.roundingMode,
                    },
                    {
                      term: "Compare-At",
                      description:
                        priceTargets ? (priceTargets.includes("compareAtPrice") ? "Adjusted using the selected action" : "Unchanged") : job.compareAtMode === "set"
                          ? "Set old price as Compare-At"
                          : job.compareAtMode === "clear"
                          ? "Clear Compare-At"
                          : "Unchanged",
                    },
                    {
                      term: "Created",
                      description: formatDate(job.createdAt),
                    },
                    {
                      term: "Completed",
                      description: formatDate(job.completedAt),
                    },
                  ]}
                />
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Statistics */}
          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  Catalog Statistics
                </Text>

                <DescriptionList
                  items={[
                    {
                      term: "Total Variants",
                      description: stats.totalVariants.toLocaleString(),
                    },
                    {
                      term: "Avg. Original Price",
                      description: formatPriceDisplay(
                        stats.averageOriginalPrice.toFixed(2)
                      ),
                    },
                    {
                      term: "Avg. New Price",
                      description: formatPriceDisplay(
                        stats.averageNewPrice.toFixed(2)
                      ),
                    },
                    {
                      term: "Total Catalog Difference",
                      description: formatPriceDisplay(
                        Math.abs(stats.totalPriceDifference).toFixed(2)
                      ),
                    },
                    {
                      term: "Processed",
                      description: `${job.processedVariants} / ${job.totalVariants}`,
                    },
                    {
                      term: "Failed",
                      description: job.failedVariants.toString(),
                    },
                  ]}
                />
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Safeguards & Scheduling Information */}
          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">
                  🛡️ Price Safeguards
                </Text>
                <DescriptionList
                  items={[
                    {
                      term: "Min Floor",
                      description: job.minPriceFloor
                        ? `$${job.minPriceFloor.toFixed(2)}`
                        : "None set",
                    },
                    {
                      term: "Max Ceiling",
                      description: job.maxPriceCeiling
                        ? `$${job.maxPriceCeiling.toFixed(2)}`
                        : "None set",
                    },
                    {
                      term: "Bypass Used",
                      description: job.guardBypassed
                        ? "Yes (confirmed by merchant)"
                        : "No",
                    },
                  ]}
                />
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">
                  ⏰ Scheduling & Auto-Revert
                </Text>
                <DescriptionList
                  items={[
                    {
                      term: "Scheduled Start",
                      description: formatDate(job.scheduledStartAt),
                    },
                    {
                      term: "Scheduled End",
                      description: formatDate(job.scheduledEndAt),
                    },
                    {
                      term: "Auto-Revert",
                      description: job.autoRevert
                        ? "Enabled (Restores prices automatically)"
                        : "Disabled",
                    },
                    {
                      term: "Schedule Status",
                      description: job.scheduleStatus || "Standard",
                    },
                  ]}
                />
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Filters Used */}
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">
                  Target Product Filters
                </Text>
                <DescriptionList items={formatFilters(job.filters)} />
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Variant Price Diff Table */}
        {snapshots.length > 0 && (
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text variant="headingMd" as="h2">
                  Variant Price Audit & Diff
                </Text>
                <Badge>
                  {`Showing ${snapshots.length} of ${totalSnapshots}`}
                </Badge>
              </InlineStack>

              <DataTable
                columnContentTypes={[
                  "text",
                  "text",
                  "numeric",
                  "numeric",
                  "numeric",
                ]}
                headings={[
                  "Product",
                  "Variant",
                  "Original Price",
                  "Adjusted Price",
                  "Compare-At",
                ]}
                rows={snapshots.map((s: any) => [
                  s.productTitle,
                  s.variantTitle,
                  formatPriceDisplay(s.originalPrice),
                  formatPriceDisplay(s.newPrice),
                  s.newCompareAtPrice
                    ? formatPriceDisplay(s.newCompareAtPrice)
                    : "—",
                ])}
              />

              {totalSnapshots > 100 && (
                <Text as="p" tone="subdued" alignment="center">
                  Showing first 100 of {totalSnapshots} variants in snapshot.
                </Text>
              )}
            </BlockStack>
          </Card>
        )}

        <Modal
          open={showCampaignModal}
          onClose={() => {
            setShowCampaignModal(false);
            setCampaignError("");
          }}
          title={campaignName ? "Rename campaign" : "Name campaign"}
          primaryAction={{
            content: "Save name",
            onAction: saveCampaignName,
            loading: isLoading,
          }}
          secondaryActions={[
            {
              content: "Cancel",
              onAction: () => {
                setShowCampaignModal(false);
                setCampaignError("");
              },
            },
          ]}
        >
          <Modal.Section>
            <TextField
              label="Campaign name"
              value={campaignDraft}
              onChange={(nextValue) => {
                setCampaignDraft(nextValue);
                setCampaignError("");
              }}
              autoComplete="off"
              maxLength={120}
              error={campaignError || undefined}
            />
          </Modal.Section>
        </Modal>

        {/* Rollback Confirmation Modal */}
        <Modal
          open={showRollbackModal}
          onClose={() => setShowRollbackModal(false)}
          title="Confirm Rollback"
          primaryAction={{
            content: "↩️ Rollback All Prices",
            onAction: handleRollback,
            destructive: true,
            loading: isLoading,
          }}
          secondaryActions={[
            {
              content: "Cancel",
              onAction: () => setShowRollbackModal(false),
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="300">
              <Banner tone="warning">
                <p>
                  This will restore all {totalSnapshots} variant prices to
                  their exact pre-adjustment values saved in the snapshot.
                </p>
              </Banner>
              <Text as="p">
                <strong>Original rule:</strong> {ruleText}
              </Text>
              <Text as="p">
                <strong>Variants affected:</strong>{" "}
                {totalSnapshots.toLocaleString()}
              </Text>
            </BlockStack>
          </Modal.Section>
        </Modal>
      </BlockStack>
    </Page>
  );
}
