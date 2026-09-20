import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import {
  fetchAllFilteredVariants,
  fetchFilterOptions,
  fetchShopCurrency,
} from "../services/product-filter.server";
import {
  validateFilters,
  type ProductFilters,
} from "../services/product-conditions";
import {
  calculateAdjustedPrice,
  summarizeGuardBreaches,
} from "../services/price-calculator";
import {
  validateSubmission,
  type AdjustmentResponse,
  type AdjustmentSubmission,
} from "../services/adjustment-request";
import { createJob, executeJob } from "../services/job-manager.server";
import { getShopSubscription, PLANS } from "../services/billing.server";
import { AdjustmentEditor } from "../components/adjustment-editor";
import { previewFingerprint as fingerprint } from "../services/preview-fingerprint.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [options, currencyCode, subscription] = await Promise.all([
    fetchFilterOptions(admin),
    fetchShopCurrency(admin),
    getShopSubscription(session.shop, admin),
  ]);
  return { options, currencyCode, isPro: subscription.isPro };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  try {
    const form = await request.formData();
    const intent = form.get("intent");
    const input = JSON.parse(String(form.get("payload") || "{}"));
    const filters: ProductFilters = input.filters;
    if (
      !filters ||
      !Array.isArray(filters.conditions) ||
      !["all", "any"].includes(filters.matchMode ?? "")
    ) {
      return Response.json(
        { errors: ["Choose valid product conditions."] },
        { status: 400 },
      );
    }
    const filterErrors = validateFilters(filters);
    if (filterErrors.length)
      return Response.json({ errors: filterErrors }, { status: 400 });

    if (intent === "preview") {
      const variants = await fetchAllFilteredVariants(admin, filters);
      return Response.json({
        preview: {
          variants,
          fingerprint: fingerprint(variants),
          filtersKey: JSON.stringify(filters),
        },
      } satisfies AdjustmentResponse);
    }
    if (intent !== "apply")
      return Response.json({ errors: ["Unknown action."] }, { status: 400 });

    const submission = input as AdjustmentSubmission;
    const subscription = await getShopSubscription(session.shop, admin);
    const errors = validateSubmission(submission, subscription.isPro);
    if (errors.length) return Response.json({ errors }, { status: 400 });

    // Re-read the catalog before applying. Never silently change the set of
    // variants or base prices the merchant just reviewed.
    const variants = await fetchAllFilteredVariants(admin, filters);
    if (fingerprint(variants) !== submission.previewFingerprint) {
      return Response.json(
        {
          errors: [
            "The matching products or prices changed since your preview. Apply filters again to review the latest prices.",
          ],
        },
        { status: 409 },
      );
    }
    if (!variants.length)
      return Response.json(
        { errors: ["No variants match these conditions."] },
        { status: 400 },
      );
    if (
      !subscription.isPro &&
      variants.length > PLANS.FREE.variantLimit
    ) {
      return Response.json(
        {
          errors: [
            `The Free Starter plan supports up to ${PLANS.FREE.variantLimit} variants per adjustment. Upgrade to Pro to process more variants.`,
          ],
        },
        { status: 403 },
      );
    }
    const calculations = variants.map((variant) =>
      calculateAdjustedPrice(
        variant.price,
        variant.compareAtPrice,
        submission.rule,
      ),
    );
    if (!calculations.some((calculation) => calculation.priceChanged))
      return Response.json(
        { errors: ["This action does not change any prices."] },
        { status: 400 },
      );
    const guards = summarizeGuardBreaches(calculations);
    if (guards.hasBreaches && !subscription.isPro) {
      return Response.json(
        {
          errors: [
            "These prices breach your safeguards. The Free Starter plan cannot bypass safeguard warnings; upgrade to Pro or adjust the rule.",
          ],
        },
        { status: 403 },
      );
    }
    if (guards.hasBreaches && submission.guardBypassed !== true)
      return Response.json(
        {
          errors: [
            "Review the safeguard warnings and confirm the bypass before applying.",
          ],
        },
        { status: 400 },
      );

    const jobId = await createJob({
      shop: session.shop,
      campaignName: submission.campaignName,
      rule: submission.rule,
      filters,
      minPriceFloor: submission.rule.minPriceFloor,
      maxPriceCeiling: submission.rule.maxPriceCeiling,
      guardBypassed: submission.guardBypassed === true,
      guardWarningLogged: guards.hasBreaches ? JSON.stringify(guards) : null,
      isScheduled: Boolean(submission.scheduledStartAt),
      scheduledStartAt: submission.scheduledStartAt
        ? new Date(submission.scheduledStartAt)
        : null,
      scheduledEndAt: submission.scheduledEndAt
        ? new Date(submission.scheduledEndAt)
        : null,
      autoRevert: submission.autoRevert === true,
    });
    if (!submission.scheduledStartAt) {
      executeJob(jobId, admin, session.shop, variants).catch((error) =>
        console.error(`Job ${jobId} failed:`, error),
      );
    }
    return redirect(`/app/history/${jobId}`);
  } catch (error) {
    return Response.json(
      {
        errors: [
          error instanceof Error
            ? error.message
            : "Unable to process the adjustment. Please try again.",
        ],
      },
      { status: 400 },
    );
  }
};

export default function AdjustPage() {
  const data = useLoaderData<typeof loader>();
  const preview = useFetcher<AdjustmentResponse>();
  const apply = useFetcher<AdjustmentResponse>();
  return (
    <AdjustmentEditor
      {...data}
      preview={preview.data?.preview}
      errors={[...(preview.data?.errors ?? []), ...(apply.data?.errors ?? [])]}
      loadingPreview={preview.state !== "idle"}
      applying={apply.state !== "idle"}
      onPreview={(filters) =>
        preview.submit(
          { intent: "preview", payload: JSON.stringify({ filters }) },
          { method: "post" },
        )
      }
      onApply={(submission) =>
        apply.submit(
          { intent: "apply", payload: JSON.stringify(submission) },
          { method: "post" },
        )
      }
    />
  );
}
