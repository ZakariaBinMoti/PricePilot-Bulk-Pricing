/**
 * Snapshot Service
 *
 * Captures and restores price snapshots for rollback capability.
 * Every adjustment automatically captures a full snapshot of all
 * affected variant prices before modification.
 */

import prisma from "../db.server.ts";
import type { VariantData } from "./product-filter.server";
import type { PriceCalculationResult } from "./price-calculator";

export interface SnapshotEntry {
  jobId: string;
  variantId: string;
  variantGid: string;
  productTitle: string;
  variantTitle: string;
  originalPrice: string;
  originalCompareAtPrice: string | null;
  newPrice: string;
  newCompareAtPrice: string | null;
}

/**
 * Capture a snapshot of all variant prices before an adjustment.
 * Uses batch insert for performance with large catalogs.
 */
export async function captureSnapshot(
  jobId: string,
  variants: VariantData[],
  calculations: PriceCalculationResult[]
): Promise<number> {
  if (variants.length !== calculations.length) {
    throw new Error("Variants and calculations arrays must have the same length.");
  }

  const entries: SnapshotEntry[] = variants.map((variant, index) => ({
    jobId,
    variantId: variant.numericId,
    variantGid: variant.id,
    productTitle: variant.productTitle,
    variantTitle: variant.title,
    originalPrice: calculations[index].originalPrice,
    originalCompareAtPrice: calculations[index].originalCompareAtPrice,
    newPrice: calculations[index].newPrice,
    newCompareAtPrice: calculations[index].newCompareAtPrice,
  }));

  // Batch insert in chunks of 500 for performance
  const BATCH_SIZE = 500;
  let totalInserted = 0;

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    await prisma.priceSnapshot.createMany({
      data: batch,
    });
    totalInserted += batch.length;
  }

  return totalInserted;
}

/**
 * Load all snapshot entries for a given job.
 * Returns the data needed to execute a rollback.
 */
export async function loadSnapshot(
  jobId: string
): Promise<SnapshotEntry[]> {
  const snapshots = await prisma.priceSnapshot.findMany({
    where: { jobId },
    orderBy: { variantId: "asc" },
  });

  return snapshots.map((s) => ({
    jobId: s.jobId,
    variantId: s.variantId,
    variantGid: s.variantGid,
    productTitle: s.productTitle,
    variantTitle: s.variantTitle,
    originalPrice: s.originalPrice,
    originalCompareAtPrice: s.originalCompareAtPrice,
    newPrice: s.newPrice,
    newCompareAtPrice: s.newCompareAtPrice,
  }));
}

/**
 * Build rollback data from a snapshot.
 * Returns variant data formatted for the bulk updater
 * (swapping new ↔ original prices).
 */
export function buildRollbackData(snapshots: SnapshotEntry[]): Array<{
  variantGid: string;
  restorePrice: string;
  restoreCompareAtPrice: string | null;
}> {
  return snapshots.map((s) => ({
    variantGid: s.variantGid,
    restorePrice: s.originalPrice,
    restoreCompareAtPrice: s.originalCompareAtPrice,
  }));
}

/**
 * Check if a job has a snapshot (i.e., is eligible for rollback).
 */
export async function hasSnapshot(jobId: string): Promise<boolean> {
  const count = await prisma.priceSnapshot.count({
    where: { jobId },
  });
  return count > 0;
}

/**
 * Get snapshot statistics for a job.
 */
export async function getSnapshotStats(jobId: string): Promise<{
  totalVariants: number;
  averageOriginalPrice: number;
  averageNewPrice: number;
  totalPriceDifference: number;
}> {
  const snapshots = await prisma.priceSnapshot.findMany({
    where: { jobId },
    select: {
      originalPrice: true,
      newPrice: true,
    },
  });

  if (snapshots.length === 0) {
    return {
      totalVariants: 0,
      averageOriginalPrice: 0,
      averageNewPrice: 0,
      totalPriceDifference: 0,
    };
  }

  let totalOriginal = 0;
  let totalNew = 0;

  for (const s of snapshots) {
    totalOriginal += parseFloat(s.originalPrice);
    totalNew += parseFloat(s.newPrice);
  }

  return {
    totalVariants: snapshots.length,
    averageOriginalPrice: totalOriginal / snapshots.length,
    averageNewPrice: totalNew / snapshots.length,
    totalPriceDifference: totalNew - totalOriginal,
  };
}

/**
 * Delete snapshots for a specific job (cleanup).
 */
export async function deleteSnapshot(jobId: string): Promise<number> {
  const result = await prisma.priceSnapshot.deleteMany({
    where: { jobId },
  });
  return result.count;
}
