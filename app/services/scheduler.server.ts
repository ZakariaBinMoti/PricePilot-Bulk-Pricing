/**
 * Scheduler Service for PricePilot
 *
 * Manages scheduled promotional campaigns, flash sales, and automated rollbacks.
 * Features:
 *  - Schedule a price adjustment to start at a future date & time.
 *  - Auto-revert prices when the sale ends (at scheduledEndAt).
 *  - Periodic runner to evaluate pending start and pending revert events.
 */

import prisma from "../db.server";
import { executeJob, executeRollback, updateJobStatus } from "./job-manager.server";
import type { AdjustmentRule } from "./price-calculator";
import type { ProductFilters } from "./product-filter.server";
import { serializeJobFilters } from "./job-configuration";

export interface ScheduleOptions {
  shop: string;
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
  const job = await prisma.priceJob.create({
    data: {
      shop: options.shop,
      status: "scheduled",
      adjustmentType: options.rule.adjustmentType,
      adjustmentDirection: options.rule.adjustmentDirection,
      adjustmentValue: options.rule.adjustmentValue,
      roundingMode: options.rule.roundingMode,
      compareAtMode: options.rule.compareAtMode,
      filters: serializeJobFilters(options.filters, options.rule),
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
}> {
  const now = new Date();
  let startedCount = 0;
  let revertedCount = 0;

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
      if (!admin) continue;

      // Mark as active and execute
      await updateJobStatus(job.id, {
        status: "processing",
        scheduleStatus: job.autoRevert ? "sale_active" : "completed",
      });

      await executeJob(job.id, admin, job.shop);

      // Once completed, update schedule status
      await prisma.priceJob.update({
        where: { id: job.id },
        data: {
          scheduleStatus: job.autoRevert && job.scheduledEndAt ? "sale_active" : "completed",
        },
      });

      startedCount++;
    } catch (err) {
      console.error(`Failed to trigger scheduled start for job ${job.id}:`, err);
    }
  }

  // 2. Find jobs active where scheduledEndAt <= now with autoRevert enabled
  const dueToRevert = await prisma.priceJob.findMany({
    where: {
      isScheduled: true,
      autoRevert: true,
      scheduleStatus: "sale_active",
      scheduledEndAt: { lte: now },
    },
  });

  for (const job of dueToRevert) {
    try {
      const admin = await adminFactory(job.shop);
      if (!admin) continue;

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
      console.error(`Failed to trigger auto-revert for job ${job.id}:`, err);
    }
  }

  return { startedCount, revertedCount };
}
