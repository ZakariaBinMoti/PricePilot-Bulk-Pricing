/**
 * Scheduler Service for PricePilot
 *
 * Manages scheduled promotional campaigns, flash sales, and automated rollbacks.
 * Features:
 *  - Schedule a price adjustment to start at a future date & time.
 *  - Auto-revert prices when the sale ends (at scheduledEndAt).
 *  - Periodic runner to evaluate pending start and pending revert events.
 */

import prisma from "../db.server.ts";
import {
  executeJob,
  executeRollback,
  resolveCampaignName,
} from "./job-manager.server.ts";
import type { AdjustmentRule } from "./price-calculator";
import type { ProductFilters } from "./product-filter.server";
import { serializeJobFilters } from "./job-configuration.ts";
import { getShopSubscription } from "./billing.server.ts";

export interface ScheduleOptions {
  shop: string;
  campaignName?: string;
  rule: AdjustmentRule;
  filters: ProductFilters;
  scheduledStartAt: Date;
  scheduledEndAt?: Date | null;
  autoRevert?: boolean;
  minPriceFloor?: number | null;
  maxPriceCeiling?: number | null;
  guardBypassed?: boolean;
}

/**
 * Schedule a future price adjustment job.
 */
export async function schedulePriceAdjustment(options: ScheduleOptions): Promise<string> {
  const campaignName = await resolveCampaignName(
    options.shop,
    options.campaignName,
  );
  const job = await prisma.priceJob.create({
    data: {
      shop: options.shop,
      status: "scheduled",
      adjustmentType: options.rule.adjustmentType,
      adjustmentDirection: options.rule.adjustmentDirection,
      adjustmentValue: options.rule.adjustmentValue,
      roundingMode: options.rule.roundingMode,
      compareAtMode: options.rule.compareAtMode,
      filters: serializeJobFilters(options.filters, options.rule, campaignName),
      isScheduled: true,
      scheduledStartAt: options.scheduledStartAt,
      scheduledEndAt: options.scheduledEndAt,
      autoRevert: options.autoRevert ?? false,
      scheduleStatus: "pending_start",
      minPriceFloor: options.minPriceFloor,
      maxPriceCeiling: options.maxPriceCeiling,
      guardBypassed: options.guardBypassed ?? false,
    },
  });

  await prisma.auditLog.create({
    data: {
      shop: options.shop,
      jobId: job.id,
      action: "sale_scheduled",
      details: JSON.stringify({
        startAt: options.scheduledStartAt,
        endAt: options.scheduledEndAt,
        autoRevert: options.autoRevert,
        rule: options.rule,
      }),
    },
  });

  return job.id;
}

/**
 * Cancel a scheduled job before it starts or cancel its auto-revert.
 */
export async function cancelScheduledJob(jobId: string, shop: string): Promise<void> {
  const job = await prisma.priceJob.findUnique({
    where: { id: jobId },
  });

  if (!job || job.shop !== shop) {
    throw new Error("Scheduled job not found or unauthorized.");
  }

  await prisma.priceJob.update({
    where: { id: jobId },
    data: {
      status: job.status === "scheduled" ? "cancelled" : job.status,
      scheduleStatus: "cancelled",
      autoRevert: false,
    },
  });

  await prisma.auditLog.create({
    data: {
      shop,
      jobId,
      action: "schedule_cancelled",
      details: JSON.stringify({ previousStatus: job.status }),
    },
  });
}

/**
 * Check and process all due scheduled jobs.
 * This can be triggered by a cron webhook, app loading, or background worker.
 */
export async function processDueScheduledJobs(adminFactory: (shop: string) => Promise<any>): Promise<{
  startedCount: number;
  revertedCount: number;
  failedCount: number;
}> {
  const now = new Date();
  let startedCount = 0;
  let revertedCount = 0;
  let failedCount = 0;

  // An interrupted adjustment cannot be replayed safely: a percentage edit
  // might already have reached Shopify. Surface it for manual inspection.
  const staleBefore = new Date(now.getTime() - 30 * 60 * 1000);
  const staleProcessing = await prisma.priceJob.updateMany({
    where: { status: "processing", updatedAt: { lt: staleBefore } },
    data: {
      status: "failed",
      errorLog: JSON.stringify([{ message: "Worker stopped during an update. Inspect Shopify prices before retrying or rolling back." }]),
    },
  });
  failedCount += staleProcessing.count;
  await prisma.priceJob.updateMany({
    where: { status: "completed", scheduleStatus: "reverting", updatedAt: { lt: staleBefore } },
    data: { scheduleStatus: "sale_active" },
  });

  // Immediate jobs are also picked up by the cron runner if the web process
  // stopped after creating the job but before it could start execution.
  const pendingJobs = await prisma.priceJob.findMany({
    where: { isScheduled: false, status: "pending" },
    take: 20,
    orderBy: { createdAt: "asc" },
  });
  for (const job of pendingJobs) {
    try {
      const admin = await adminFactory(job.shop);
      if (!admin) throw new Error("No Admin API client available.");
      const executed = await executeJob(job.id, admin, job.shop);
      if (executed === true) startedCount++;
      else if (executed === false) failedCount++;
    } catch (error) {
      failedCount++;
      console.error(`Failed to process pending job ${job.id}:`, error);
    }
  }

  // 1. Find jobs waiting to start where scheduledStartAt <= now
  const dueToStart = await prisma.priceJob.findMany({
    where: {
      isScheduled: true,
      status: "scheduled",
      scheduleStatus: "pending_start",
      scheduledStartAt: { lte: now },
    },
  });

  for (const job of dueToStart) {
    try {
      const admin = await adminFactory(job.shop);
      if (!admin) throw new Error("No Admin API client available.");
      const subscription = await getShopSubscription(job.shop, admin);
      if (!subscription.isPro) {
        await prisma.priceJob.updateMany({
          where: { id: job.id, shop: job.shop, status: "scheduled" },
          data: { status: "cancelled", scheduleStatus: "cancelled" },
        });
        continue;
      }
      const executed = await executeJob(job.id, admin, job.shop);
      if (executed === true) startedCount++;
      else if (executed === false) failedCount++;
    } catch (err) {
      failedCount++;
      console.error(`Failed to trigger scheduled start for job ${job.id}:`, err);
    }
  }

  // 2. Find jobs active where scheduledEndAt <= now with autoRevert enabled
  const dueToRevert = await prisma.priceJob.findMany({
    where: {
      isScheduled: true,
      autoRevert: true,
      status: "completed",
      scheduleStatus: "sale_active",
      scheduledEndAt: { lte: now },
    },
  });

  for (const job of dueToRevert) {
    try {
      const claim = await prisma.priceJob.updateMany({
        where: { id: job.id, shop: job.shop, status: "completed", scheduleStatus: "sale_active" },
        data: { scheduleStatus: "reverting" },
      });
      if (claim.count === 0) continue;
      const admin = await adminFactory(job.shop);
      if (!admin) throw new Error("No Admin API client available.");

      await executeRollback(job.id, admin, job.shop);

      await prisma.priceJob.update({
        where: { id: job.id },
        data: {
          scheduleStatus: "completed",
        },
      });

      await prisma.auditLog.create({
        data: {
          shop: job.shop,
          jobId: job.id,
          action: "sale_auto_reverted",
          details: JSON.stringify({ revertedAt: now }),
        },
      });

      revertedCount++;
    } catch (err) {
      failedCount++;
      // Restoring snapshot values is idempotent; a later cron run can retry.
      await prisma.priceJob.updateMany({
        where: { id: job.id, scheduleStatus: "reverting" },
        data: { scheduleStatus: "sale_active" },
      });
      console.error(`Failed to trigger auto-revert for job ${job.id}:`, err);
    }
  }

  return { startedCount, revertedCount, failedCount };
}
