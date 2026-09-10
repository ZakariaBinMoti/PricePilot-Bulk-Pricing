/**
 * Job Manager Service
 *
 * Manages price adjustment, scheduling, safeguards, and rollback jobs using the database.
 * Orchestrates the complete price adjustment lifecycle:
 *  1. Fetches matching variants
 *  2. Evaluates adjustments and safeguards
 *  3. Captures snapshot for 1-click rollback
 *  4. Applies updates via Shopify API
 *  5. Logs audit history
 */

import prisma from "../db.server.ts";
import type { ProductFilters, VariantData } from "./product-filter.server";
import { fetchAllFilteredVariants } from "./product-filter.server.ts";
import {
  calculateAdjustedPrice,
  validateRule,
  type AdjustmentRule,
  type PriceCalculationResult,
} from "./price-calculator.ts";
import { executeDirectUpdates, type UpdateItem } from "./bulk-updater.server.ts";
import { captureSnapshot, loadSnapshot, buildRollbackData } from "./snapshot.server.ts";
import { readJobTargets, serializeJobFilters } from "./job-configuration.ts";

export interface CreateJobInput {
  shop: string;
  rule: AdjustmentRule;
  filters: ProductFilters;
  minPriceFloor?: number | null;
  maxPriceCeiling?: number | null;
  guardBypassed?: boolean;
  guardWarningLogged?: string | null;
  isScheduled?: boolean;
  scheduledStartAt?: Date | null;
  scheduledEndAt?: Date | null;
  autoRevert?: boolean;
}

/**
 * Create a new price adjustment job in the database.
 */
export async function createJob(input: CreateJobInput): Promise<string> {
  if (input.isScheduled && (!input.scheduledStartAt || !Number.isFinite(input.scheduledStartAt.getTime()) || input.scheduledStartAt <= new Date())) {
    throw new Error("The scheduled start must still be in the future. Choose a later time.");
  }
  const isScheduled = input.isScheduled && input.scheduledStartAt && input.scheduledStartAt > new Date();

  const job = await prisma.priceJob.create({
    data: {
      shop: input.shop,
      status: isScheduled ? "scheduled" : "pending",
      adjustmentType: input.rule.adjustmentType,
      adjustmentDirection: input.rule.adjustmentDirection,
      adjustmentValue: input.rule.adjustmentValue,
      roundingMode: input.rule.roundingMode,
      compareAtMode: input.rule.compareAtMode,
      filters: serializeJobFilters(input.filters, input.rule),
      minPriceFloor: input.minPriceFloor,
      maxPriceCeiling: input.maxPriceCeiling,
      guardBypassed: input.guardBypassed ?? false,
      guardWarningLogged: input.guardWarningLogged,
      isScheduled: Boolean(isScheduled),
      scheduledStartAt: input.scheduledStartAt,
      scheduledEndAt: input.scheduledEndAt,
      autoRevert: input.autoRevert ?? false,
      scheduleStatus: isScheduled ? "pending_start" : null,
    },
  });

  return job.id;
}

/**
 * Update job status and progress.
 */
export async function updateJobStatus(
  jobId: string,
  updates: {
    status?: string;
    scheduleStatus?: string;
    processedVariants?: number;
    failedVariants?: number;
    totalVariants?: number;
    errorLog?: string | null;
    completedAt?: Date;
  }
): Promise<void> {
  await prisma.priceJob.update({
    where: { id: jobId },
    data: updates,
  });
}

/**
 * Get a job by ID with its snapshots count.
 */
export async function getJob(jobId: string) {
  return prisma.priceJob.findUnique({
    where: { id: jobId },
    include: {
      _count: {
        select: { snapshots: true },
      },
    },
  });
}

/**
 * Get all jobs for a shop, ordered by most recent.
 */
export async function getJobsForShop(
  shop: string,
  page: number = 1,
  pageSize: number = 20
) {
  const [jobs, total] = await Promise.all([
    prisma.priceJob.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        _count: {
          select: { snapshots: true },
        },
      },
    }),
    prisma.priceJob.count({ where: { shop } }),
  ]);

  return {
    jobs,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * Execute a price adjustment job.
 */
export async function executeJob(
  jobId: string,
  admin: any,
  shop: string,
  preparedVariants?: VariantData[]
): Promise<void> {
  try {
    // Mark as processing
    await updateJobStatus(jobId, { status: "processing" });

    // Load job details
    const job = await getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    if (job.shop !== shop) throw new Error("Unauthorized job.");

    const filters: ProductFilters = JSON.parse(job.filters);
    const rule: AdjustmentRule = {
      adjustmentType: job.adjustmentType as any,
      adjustmentDirection: job.adjustmentDirection as any,
      adjustmentValue: job.adjustmentValue,
      roundingMode: job.roundingMode as any,
      compareAtMode: job.compareAtMode as any,
      minPriceFloor: job.minPriceFloor,
      maxPriceCeiling: job.maxPriceCeiling,
      priceTargets: readJobTargets(job.filters),
    };
    const ruleErrors = validateRule(rule);
    if (ruleErrors.length) throw new Error(ruleErrors.join(" "));

    // Step 1: Fetch all matching variants
    const variants = preparedVariants ?? await fetchAllFilteredVariants(admin, filters);

    if (variants.length === 0) {
      await updateJobStatus(jobId, {
        status: "completed",
        totalVariants: 0,
        processedVariants: 0,
        completedAt: new Date(),
      });
      await createAuditLog(shop, jobId, "adjustment_applied", {
        message: "No matching variants found",
        variantsAffected: 0,
      });
      return;
    }

    await updateJobStatus(jobId, { totalVariants: variants.length });

    // Step 2: Calculate new prices for all variants with Safeguard checks
    const calculations: PriceCalculationResult[] = variants.map((v) =>
      calculateAdjustedPrice(v.price, v.compareAtPrice, rule)
    );
    if (!job.guardBypassed && calculations.some((calculation) => calculation.guardBreached)) {
      throw new Error("Prices breach the configured safeguards. Review the preview and confirm the bypass before applying.");
    }

    // Capture and update only changed variants, including compare-at-only edits.
    const updateItems: UpdateItem[] = [];
    for (let i = 0; i < variants.length; i++) {
      if (calculations[i].priceChanged) {
        updateItems.push({
          variant: variants[i],
          calculation: calculations[i],
        });
      }
    }

    await captureSnapshot(jobId, updateItems.map((item) => item.variant), updateItems.map((item) => item.calculation));
    await updateJobStatus(jobId, { totalVariants: updateItems.length });

    // Step 5: Execute updates
    const result = await executeDirectUpdates(admin, updateItems, (processed) => {
      updateJobStatus(jobId, { processedVariants: processed }).catch(() => {});
    });

    // Step 6: Update job status
    const finalStatus = result.success ? "completed" : "failed";
    await updateJobStatus(jobId, {
      status: finalStatus,
      scheduleStatus: job.isScheduled && job.autoRevert ? "sale_active" : undefined,
      processedVariants: result.updatedCount,
      failedVariants: result.failedCount,
      errorLog: result.errors.length > 0 ? JSON.stringify(result.errors) : null,
      completedAt: new Date(),
    });

    // Step 7: Create audit log
    await createAuditLog(shop, jobId, "adjustment_applied", {
      rule,
      filters,
      guards: {
        floor: job.minPriceFloor,
        ceiling: job.maxPriceCeiling,
        bypassed: job.guardBypassed,
      },
      isScheduled: job.isScheduled,
      variantsAffected: updateItems.length,
      updatedCount: result.updatedCount,
      failedCount: result.failedCount,
      errors: result.errors.length > 0 ? result.errors : undefined,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    await updateJobStatus(jobId, {
      status: "failed",
      errorLog: JSON.stringify([{ message: errorMessage }]),
      completedAt: new Date(),
    });

    await createAuditLog(shop, jobId, "adjustment_failed", {
      error: errorMessage,
    });

    throw error;
  }
}

/**
 * Execute a rollback for a previously completed job.
 */
export async function executeRollback(
  jobId: string,
  admin: any,
  shop: string
): Promise<void> {
  try {
    const job = await getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    if (job.status === "rolled_back") throw new Error("Job already rolled back");

    const snapshots = await loadSnapshot(jobId);
    if (snapshots.length === 0) throw new Error("No snapshot found for this job");

    const rollbackData = buildRollbackData(snapshots);

    const updateItems: UpdateItem[] = rollbackData.map((rd) => {
      const snapshot = snapshots.find((s) => s.variantGid === rd.variantGid)!;
      return {
        variant: {
          id: rd.variantGid,
          numericId: snapshot.variantId,
          price: "",
          compareAtPrice: null,
          title: snapshot.variantTitle,
          productTitle: snapshot.productTitle,
          productId: "",
          sku: null,
          inventoryQuantity: null,
        },
        calculation: {
          originalPrice: snapshot.newPrice,
          originalCompareAtPrice: snapshot.newCompareAtPrice,
          newPrice: rd.restorePrice,
          newCompareAtPrice: rd.restoreCompareAtPrice,
          priceChanged: true,
          guardBreached: false,
          guardBreachType: null,
          guardWarningMessage: null,
        },
      };
    });

    const VARIANT_PRODUCT_QUERY = `#graphql
      query GetVariantProduct($id: ID!) {
        productVariant(id: $id) {
          id
          product {
            id
          }
        }
      }
    `;

    const variantProductMap = new Map<string, string>();
    for (const item of updateItems) {
      if (!variantProductMap.has(item.variant.id)) {
        try {
          const response = await admin.graphql(VARIANT_PRODUCT_QUERY, {
            variables: { id: item.variant.id },
          });
          const data = await response.json();
          const productId = data.data?.productVariant?.product?.id;
          if (productId) {
            variantProductMap.set(item.variant.id, productId);
          }
        } catch (e) {
          console.error(`Failed to fetch product for variant ${item.variant.id}:`, e);
        }
        await new Promise((r) => setTimeout(r, 50));
      }
    }

    for (const item of updateItems) {
      item.variant.productId = variantProductMap.get(item.variant.id) || "";
    }

    const validItems = updateItems.filter((i) => i.variant.productId);
    const result = await executeDirectUpdates(admin, validItems);

    await updateJobStatus(jobId, {
      status: "rolled_back",
      scheduleStatus: "completed",
    });

    await createAuditLog(shop, jobId, "adjustment_rolled_back", {
      variantsRestored: result.updatedCount,
      failedCount: result.failedCount,
      errors: result.errors.length > 0 ? result.errors : undefined,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    await createAuditLog(shop, jobId, "adjustment_failed", {
      action: "rollback",
      error: errorMessage,
    });
    throw error;
  }
}

/**
 * Create an audit log entry.
 */
async function createAuditLog(
  shop: string,
  jobId: string | null,
  action: string,
  details: Record<string, any>
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      shop,
      jobId,
      action,
      details: JSON.stringify(details),
      timestamp: new Date(),
    },
  });
}

/**
 * Get audit logs for a shop.
 */
export async function getAuditLogs(
  shop: string,
  page: number = 1,
  pageSize: number = 20
) {
  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where: { shop },
      orderBy: { timestamp: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where: { shop } }),
  ]);

  return {
    logs,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * Get dashboard stats for a shop.
 */
export async function getDashboardStats(shop: string) {
  const [totalJobs, completedJobs, totalVariantsUpdated, recentJobs, scheduledJobs] =
    await Promise.all([
      prisma.priceJob.count({ where: { shop } }),
      prisma.priceJob.count({ where: { shop, status: "completed" } }),
      prisma.priceSnapshot.count({
        where: {
          job: { shop },
        },
      }),
      prisma.priceJob.findMany({
        where: { shop },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: {
          _count: {
            select: { snapshots: true },
          },
        },
      }),
      prisma.priceJob.findMany({
        where: {
          shop,
          isScheduled: true,
          status: "scheduled",
        },
        orderBy: { scheduledStartAt: "asc" },
      }),
    ]);

  const activeJobs = await prisma.priceJob.findMany({
    where: {
      shop,
      status: { in: ["pending", "processing"] },
    },
  });

  return {
    totalJobs,
    completedJobs,
    totalVariantsUpdated,
    activeJobs,
    recentJobs,
    scheduledJobs,
  };
}
