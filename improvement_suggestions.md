# PricePilot Improvement Roadmap

This document collects recommended improvements for PricePilot after the current bulk-pricing workflow. The work is ordered by practical impact so it can be used as a future implementation backlog.

## Product goals

Future improvements should strengthen four parts of the product:

1. Help merchants repeat common pricing work faster.
2. Increase confidence before and after a catalog update.
3. Make failures understandable and recoverable.
4. Support very large Shopify catalogs reliably.

## Priority 1: Merchant workflow

### Saved campaign templates

Allow merchants to save a complete adjustment configuration, including:

- Campaign name
- All/any matching mode and conditions
- Main Price and Compare-at Price targets
- Price action and rounding
- Floor and ceiling safeguards
- Scheduling and auto-revert settings

Templates could include common presets such as Weekend Sale, Clearance, Supplier Increase, BFCM, and Compare-at Synchronization.

### Duplicate and rerun adjustments

Add **Duplicate adjustment** to the history action menu. It should open the adjustment page with the old configuration prefilled, but it must require a new catalog preview and confirmation before execution.

Do not reuse the old preview fingerprint or original matched-variant list because catalog data may have changed.

### History search, filtering, and sorting

Add controls above the history table for:

- Campaign-name search
- Status filter
- Standard versus scheduled jobs
- Date range
- Sort by creation date, campaign name, status, or affected variants

Make campaign names clickable so they open the job details page.

### Contextual history actions

Recommended three-dot menu options:

- View details
- Duplicate adjustment
- Rename campaign
- Export CSV
- Retry failed variants, only when failures exist
- Cancel schedule, only while a campaign is scheduled

Keep rollback on the details page because it is destructive and should be accompanied by snapshot information and confirmation.

## Priority 2: Preview confidence

### Adjustment summary

Show a clear summary before confirmation:

- Variants matched
- Variants that will change
- Variants that remain unchanged
- Main Price changes
- Compare-at-only changes
- Prices increasing versus decreasing
- Minimum, maximum, and average current/proposed prices
- Total catalog price difference

### Compare-at price validation

Warn when a proposed Compare-at Price is less than or equal to Main Price. Shopify may accept some inconsistent data, but it would not produce the expected storefront sale presentation.

### Currency-aware safeguards

Display the shop currency beside floor, ceiling, fixed-price, and fixed-amount inputs. Do not hard-code the dollar symbol in merchant-facing screens.

### Better confirmation language

The confirmation screen should summarize the exact scope and action in plain language, for example:

> Decrease Main Price by 20% for 1,248 variants matching all three conditions. Compare-at Price will remain unchanged.

For scheduled work, show the merchant's local time zone and the resulting execution time.

## Priority 3: Reliability and recovery

### Partial failure handling

Record errors at variant level and distinguish among:

- Completed
- Completed with failures
- Failed before processing
- Cancelled
- Rolled back

Allow merchants to retry only failed variants after reviewing Shopify's error for each one.

### Idempotent execution

Give each job and update batch an idempotency strategy so retries cannot apply the same price calculation twice. Persist batch progress before acknowledging completion.

### Durable worker queue

Move long-running execution out of request handlers into a durable worker queue. The worker should support:

- Retries with exponential backoff
- Per-shop concurrency limits
- Rate-limit awareness
- Priority levels by plan
- Crash recovery
- Progress heartbeats
- Dead-letter handling for exhausted retries

### Scheduler reliability

Use a durable scheduled-job mechanism with repeated safe polling. Scheduled execution and auto-revert should be idempotent, observable, and safe if the scheduler is invoked more than once.

### Rollback safety

Before rollback, explain whether a product's price has changed since the original adjustment. Consider offering:

- Force restore snapshot values
- Skip externally changed variants
- Review conflicts before restoring

## Priority 4: Large-catalog architecture

### Scalable preview pipeline

Replace full catalog scanning in the request lifecycle with one of these approaches:

- Shopify Bulk Query ingestion followed by local condition matching
- An indexed catalog mirror kept current through webhooks
- A hybrid approach using Shopify search filters first and local matching only for unsupported conditions

Preview pagination should operate on persisted or indexed results rather than holding the complete match set in one request.

### Bulk Operations execution

Complete the JSONL upload and Bulk Operations dispatch path for large jobs. Track Shopify operation IDs, poll or consume completion events, download error output, and reconcile per-variant results into the job record.

### Catalog synchronization

If an indexed catalog is introduced, handle product and variant create/update/delete events, app reinstallations, missed webhooks, and periodic full reconciliation.

## Priority 5: Reporting and notifications

### CSV audit export

Allow merchants to export:

- Product and variant identifiers
- Campaign and rule
- Original and proposed prices
- Final applied prices
- Per-variant status and error
- Timestamps

### Notifications

Provide in-app and optional email notifications when:

- A scheduled campaign starts
- A job completes
- A job completes with failures
- A job fails
- An auto-revert completes or fails

### Audit attribution

Where Shopify identity information is available and permitted, show who created, started, cancelled, renamed, or rolled back a campaign.

## Priority 6: Plans and growth

### Free-plan experience

Consider allowing unlimited preview while retaining the 50-variant apply limit. Merchants can understand the app's value and verify a rule before upgrading.

### Annual billing

Offer monthly and discounted annual Pro subscriptions. Clearly explain billing, trial behavior, cancellation, and feature access.

### High-volume plan

Consider a higher tier for large catalogs that includes priority workers, longer audit retention, larger exports, and enhanced support.

### Onboarding

Add a short onboarding checklist:

1. Create or choose a campaign preset.
2. Add product conditions.
3. Preview affected variants.
4. Review safeguards.
5. Run or schedule the campaign.

Include an example campaign that does not execute until the merchant confirms it.

## Quality and accessibility

- Add browser tests for the full embedded-app workflow.
- Test keyboard navigation, focus order, screen-reader labels, and color contrast.
- Test narrow Shopify Admin iframe widths and horizontal table scrolling.
- Add tests for daylight-saving transitions and merchant time zones.
- Add contract tests for Shopify GraphQL payloads and API-version changes.
- Add structured logs, error monitoring, queue metrics, and scheduler alerts.
- Verify the app with a realistic large development-store catalog.

## Recommended implementation order

1. Duplicate and rerun adjustments.
2. History search, filters, and sorting.
3. Preview summaries and Compare-at validation.
4. Partial failure reporting and retry.
5. Durable worker and scheduler architecture.
6. Bulk Query preview and Bulk Operations execution.
7. CSV exports and notifications.
8. Saved templates, onboarding, and additional plans.

## Definition of release readiness

Before calling the app production-ready, verify that:

- Immediate, scheduled, auto-revert, and rollback flows work in a live Shopify development store.
- No stale preview can be executed.
- Duplicate scheduler calls cannot execute a job twice.
- Partial failures are visible and recoverable.
- The app survives server restarts during long-running jobs.
- Billing upgrades, declines, cancellations, and expired trials are handled correctly.
- Mandatory Shopify webhooks and privacy requirements are configured and tested.
- The app has merchant-facing support, privacy, and terms pages.
- Monitoring can identify failed jobs before a merchant reports them.
