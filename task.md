# PricePilot ‑ Bulk Pricing — Task Tracker

## App Details
- **Name**: PricePilot ‑ Bulk Pricing
- **Pricing**: Freemium ($14.99/mo Pro with 7-day free trial via Shopify Billing API)
- **Framework**: Shopify CLI + React Router (v7) + Polaris UI + Prisma ORM

---

## Phase 1: Project Scaffolding & Auth
- [x] Check prerequisites (Node.js v22.23.2, npm 11.6.0, Shopify CLI 4.6.1)
- [x] Scaffold Shopify app structure based on official React Router template
- [x] Configure `shopify.app.toml` (Name: "PricePilot ‑ Bulk Pricing", scopes, webhooks, GDPR endpoints)
- [x] Design & create Prisma schema (`Session`, `PriceJob`, `PriceSnapshot`, `AuditLog`, `Subscription`)
- [x] Run npm install with peer resolution
- [x] Generate Prisma client & sync SQLite database

## Phase 2: Core Business Logic & Pricing Engine
- [x] Pure price calculator (`app/services/price-calculator.ts`):
  - [x] Percentage adjustments (`+10%`, `-25%`)
  - [x] Fixed dollar adjustments (`+$5`, `-$10`)
  - [x] Compare-at synchronization (`set` for PDP strikethrough badges, `clear`, `unchanged`)
  - [x] Psychological rounding engine (`.99`, `.95`, `.00`, `nearest_10`)
  - [x] Absolute system safety clamp ($0.01 minimum)
- [x] Price Floor & Ceiling Safeguards:
  - [x] Minimum price floor check
  - [x] Maximum price ceiling check
  - [x] Breach detection & warning summarizer
- [x] Product filter service (`app/services/product-filter.server.ts`):
  - [x] GraphQL query builder with collection, tags, title, type, vendor, status
  - [x] Preview sampling & total product count
- [x] Bulk updater service (`app/services/bulk-updater.server.ts`):
  - [x] Direct mutation for small batches
  - [x] Bulk operations API setup with JSONL for high-volume catalogs
- [x] Snapshot service (`app/services/snapshot.server.ts`):
  - [x] Pre-update snapshot capture (batch inserts)
  - [x] Reversal & rollback builder
- [x] Job manager service (`app/services/job-manager.server.ts`):
  - [x] Full orchestration (fetch → calculate → snapshot → apply → audit log)
  - [x] Rollback execution
  - [x] Dashboard statistics

## Phase 3: Scheduling & Freemium Billing
- [x] Freemium Billing service (`app/services/billing.server.ts`):
  - [x] Free Starter plan (up to 50 variants, manual rollback, standard history)
  - [x] PricePilot Pro ($14.99/mo, 7-day free trial, unlimited variants, scheduling, auto-revert)
  - [x] Official Shopify GraphQL `appSubscriptionCreate` mutation
- [x] Scheduling engine (`app/services/scheduler.server.ts`):
  - [x] Future scheduled sale start (`scheduledStartAt`)
  - [x] Automatic price revert when sale ends (`scheduledEndAt` + `autoRevert`)
  - [x] Scheduled sale cancellation
  - [x] Due jobs processor for cron/background execution
- [x] Scheduler API endpoint (`app/routes/api.scheduler.tsx`)

## Phase 4: Frontend Pages & Polaris UI
- [x] App layout (`app/routes/app.tsx`) with Shopify App Bridge `NavMenu`
- [x] Dashboard (`app/routes/app._index.tsx`):
  - [x] PricePilot branding
  - [x] Subscription tier indicator & upgrade link
  - [x] Upcoming scheduled sales view
  - [x] Quick action buttons
  - [x] Recent activity table
- [x] Price Adjustment page (`app/routes/app.adjust.tsx`):
  - [x] Step 1: Catalog targeting (Collections, Tags, Keyword, Type, Vendor, Status)
  - [x] Step 2: Adjustment rule (Direction, Type, Value)
  - [x] Step 3: Compare-at synchronization & psychological rounding
  - [x] Step 4: Price Floor & Ceiling Safeguards with warning toggle
  - [x] Step 5: Sale Scheduling (Start & Auto-Revert) with Pro badge
  - [x] Live Preview table with safeguard breach flags
  - [x] Confirmation modal with required bypass checkbox for safeguard breaches
- [x] Audit History page (`app/routes/app.history.tsx`):
  - [x] Paginated table with features badges (Scheduled, Guards)
  - [x] Status badges (`completed`, `scheduled`, `rolled_back`, `failed`)
- [x] Job Detail page (`app/routes/app.history.$jobId.tsx`):
  - [x] Full job statistics and filter breakdown
  - [x] Price Safeguards summary & bypass indicator
  - [x] Scheduling details & cancel scheduled sale action
  - [x] Pre-update snapshot diff table
  - [x] 1-Click Rollback with confirmation modal
- [x] Plans & Billing page (`app/routes/app.billing.tsx`):
  - [x] Free vs Pro comparison cards
  - [x] Upgrade with 7-day free trial button
- [x] Landing / Login page (`app/routes/_index/route.tsx`)
- [x] Job Status Polling API (`app/routes/api.job-status.tsx`)

## Phase 5: Webhooks & GDPR Compliance
- [x] Webhook route (`app/routes/webhooks.tsx`):
  - [x] `app/uninstalled` — purge session, jobs, snapshots, audit logs
  - [x] `app/scopes_update`
  - [x] GDPR `customers/data_request` (200 OK)
  - [x] GDPR `customers/redact` (200 OK)
  - [x] GDPR `shop/redact` (purge shop data)
  - [x] Configured in `shopify.app.toml`

## Phase 6: Security Hardening
- [x] Shopify OAuth 2.0 via `@shopify/shopify-app-react-router`
- [x] HMAC signature verification on all incoming webhooks
- [x] Scoped permissions (`read_products,write_products` only)
- [x] Environment variable isolation (.env in .gitignore)
- [x] Price safeguards & validation to prevent catastrophic pricing errors

## Phase 7: Verification & Build
- [x] Unit test suite (`npm test`) — 12/12 passing tests
- [x] TypeScript validation (`npx tsc --noEmit`) — zero errors
- [x] Production bundle build (`npm run build`) — complete client & server SSR bundles
- [x] Production Dockerfile ready
