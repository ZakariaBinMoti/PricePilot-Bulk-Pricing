import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getJob } from "../services/job-manager.server";

/**
 * API endpoint for polling job status.
 * Used by the frontend for real-time progress updates on active jobs.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");

  if (!jobId) {
    return Response.json({ error: "Job ID required" }, { status: 400 });
  }

  const job = await getJob(jobId);

  if (!job) {
    return Response.json({ error: "Job not found" }, { status: 404 });
  }

  if (job.shop !== session.shop) {
    return Response.json({ error: "Unauthorized" }, { status: 403 });
  }

  return Response.json({
    id: job.id,
    status: job.status,
    totalVariants: job.totalVariants,
    processedVariants: job.processedVariants,
    failedVariants: job.failedVariants,
    progress:
      job.totalVariants > 0
        ? Math.round((job.processedVariants / job.totalVariants) * 100)
        : 0,
    completedAt: job.completedAt,
  });
};
