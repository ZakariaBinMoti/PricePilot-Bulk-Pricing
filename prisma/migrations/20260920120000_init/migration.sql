CREATE SCHEMA IF NOT EXISTS "public";

CREATE TABLE "Session" (
    "id" TEXT NOT NULL, "shop" TEXT NOT NULL, "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false, "scope" TEXT,
    "expires" TIMESTAMP(3), "accessToken" TEXT NOT NULL, "userId" BIGINT,
    "firstName" TEXT, "lastName" TEXT, "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false, "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false, "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT, "refreshTokenExpires" TIMESTAMP(3),
    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL, "shop" TEXT NOT NULL, "plan" TEXT NOT NULL DEFAULT 'FREE',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE', "shopifyChargeId" TEXT,
    "currentPeriodEnd" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PriceJob" (
    "id" TEXT NOT NULL, "shop" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'pending',
    "adjustmentType" TEXT NOT NULL, "adjustmentDirection" TEXT NOT NULL, "adjustmentValue" DOUBLE PRECISION NOT NULL,
    "roundingMode" TEXT NOT NULL DEFAULT 'none', "compareAtMode" TEXT NOT NULL DEFAULT 'set', "filters" TEXT NOT NULL,
    "totalVariants" INTEGER NOT NULL DEFAULT 0, "processedVariants" INTEGER NOT NULL DEFAULT 0,
    "failedVariants" INTEGER NOT NULL DEFAULT 0, "errorLog" TEXT, "isScheduled" BOOLEAN NOT NULL DEFAULT false,
    "scheduledStartAt" TIMESTAMP(3), "scheduledEndAt" TIMESTAMP(3), "autoRevert" BOOLEAN NOT NULL DEFAULT false,
    "scheduleStatus" TEXT, "minPriceFloor" DOUBLE PRECISION, "maxPriceCeiling" DOUBLE PRECISION,
    "guardBypassed" BOOLEAN NOT NULL DEFAULT false, "guardWarningLogged" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3), CONSTRAINT "PriceJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PriceSnapshot" (
    "id" TEXT NOT NULL, "jobId" TEXT NOT NULL, "variantId" TEXT NOT NULL, "variantGid" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL, "variantTitle" TEXT NOT NULL, "originalPrice" TEXT NOT NULL,
    "originalCompareAtPrice" TEXT, "newPrice" TEXT NOT NULL, "newCompareAtPrice" TEXT,
    CONSTRAINT "PriceSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL, "shop" TEXT NOT NULL, "jobId" TEXT, "action" TEXT NOT NULL,
    "performedBy" TEXT, "details" TEXT NOT NULL, "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Subscription_shop_key" ON "Subscription"("shop");
CREATE INDEX "Subscription_shop_idx" ON "Subscription"("shop");
CREATE INDEX "PriceJob_shop_idx" ON "PriceJob"("shop");
CREATE INDEX "PriceJob_status_idx" ON "PriceJob"("status");
CREATE INDEX "PriceJob_isScheduled_idx" ON "PriceJob"("isScheduled");
CREATE INDEX "PriceJob_scheduledStartAt_idx" ON "PriceJob"("scheduledStartAt");
CREATE INDEX "PriceJob_scheduledEndAt_idx" ON "PriceJob"("scheduledEndAt");
CREATE INDEX "PriceJob_createdAt_idx" ON "PriceJob"("createdAt");
CREATE INDEX "PriceSnapshot_jobId_idx" ON "PriceSnapshot"("jobId");
CREATE INDEX "PriceSnapshot_variantId_idx" ON "PriceSnapshot"("variantId");
CREATE INDEX "AuditLog_shop_idx" ON "AuditLog"("shop");
CREATE INDEX "AuditLog_jobId_idx" ON "AuditLog"("jobId");
CREATE INDEX "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");

ALTER TABLE "PriceSnapshot" ADD CONSTRAINT "PriceSnapshot_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "PriceJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "PriceJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
