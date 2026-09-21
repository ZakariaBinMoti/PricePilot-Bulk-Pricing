import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { processDueScheduledJobs } from "../services/scheduler.server";
import { unauthenticated } from "../shopify.server";

/**
 * Endpoint to trigger evaluation of scheduled sales and auto-reverts.
 * Can be called by periodic cron tasks (e.g. Fly.io Machines, Vercel Cron, Google Cloud Scheduler, or internal timers).
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error("CRON_SECRET is not configured.");
    return Response.json({ error: "Scheduler is not configured" }, { status: 503 });
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const adminFactory = async (shop: string) => {
      const { admin } = await unauthenticated.admin(shop);
      return admin;
    };

    const result = await processDueScheduledJobs(adminFactory);

    return Response.json({
      success: true,
      timestamp: new Date().toISOString(),
      ...result,
    });
  } catch (error) {
    console.error("Scheduler process error:", error);
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
};

export const action = async (args: ActionFunctionArgs) => {
  return loader(args);
};
