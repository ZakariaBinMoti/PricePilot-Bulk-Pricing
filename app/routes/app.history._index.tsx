import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Page,
  Card,
  BlockStack,
  DataTable,
  Badge,
  Pagination,
  EmptyState,
  Icon,
} from "@shopify/polaris";
import { MenuVerticalIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { getJobsForShop } from "../services/job-manager.server";
import { describeAdjustment } from "../services/price-calculator";
import { readJobCampaignName } from "../services/job-configuration";
import styles from "../components/history-actions.module.css";

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

function HistoryActions({ job }: { job: any }) {
  const campaignName = readJobCampaignName(job.filters);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);

  const closeMenu = () => setMenuPosition(null);

  const toggleMenu = () => {
    if (menuPosition) {
      closeMenu();
      return;
    }

    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const menuWidth = 176;
    const menuHeight = 88;
    const gap = 6;
    const viewportPadding = 8;
    const openAbove = rect.bottom + gap + menuHeight > window.innerHeight;

    setMenuPosition({
      top: openAbove ? rect.top - menuHeight - gap : rect.bottom + gap,
      left: Math.min(
        window.innerWidth - menuWidth - viewportPadding,
        Math.max(viewportPadding, rect.right - menuWidth),
      ),
    });
  };

  useEffect(() => {
    if (!menuPosition) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        closeMenu();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [menuPosition]);

  return (
    <div className={styles.menu}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.menuTrigger}
        aria-label={`Actions for ${campaignName || "this adjustment"}`}
        aria-haspopup="menu"
        aria-expanded={Boolean(menuPosition)}
        title="Actions"
        onClick={toggleMenu}
      >
        <Icon source={MenuVerticalIcon} />
      </button>
      {menuPosition &&
        createPortal(
          <div
            ref={menuRef}
            className={styles.menuItems}
            role="menu"
            style={{ top: menuPosition.top, left: menuPosition.left }}
          >
            <Link
              className={styles.menuItem}
              role="menuitem"
              to={`/app/history/${job.id}`}
              onClick={closeMenu}
            >
              View details
            </Link>
            <Link
              className={styles.menuItem}
              role="menuitem"
              to={`/app/history/${job.id}?editCampaign=1`}
              onClick={closeMenu}
            >
              {campaignName ? "Rename campaign" : "Name campaign"}
            </Link>
          </div>,
          document.body,
        )}
    </div>
  );
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
                <HistoryActions key={`actions-${job.id}`} job={job} />,
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
