const appUrl = process.env.SHOPIFY_APP_URL;
const secret = process.env.CRON_SECRET;
if (!appUrl || !secret) {
  throw new Error("SHOPIFY_APP_URL and CRON_SECRET are required for the scheduler.");
}

const response = await fetch(new URL("/api/scheduler", appUrl), {
  headers: { authorization: `Bearer ${secret}` },
  signal: AbortSignal.timeout(10 * 60 * 1000),
});
const result = await response.json();
console.log(JSON.stringify(result));
if (!response.ok || !result.success || result.failedCount > 0) {
  process.exitCode = 1;
}
