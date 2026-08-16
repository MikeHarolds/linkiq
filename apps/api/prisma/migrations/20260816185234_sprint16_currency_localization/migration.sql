-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "exchangeRate" DECIMAL(18,8),
ADD COLUMN     "exchangeRateAsOf" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "amount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'USD';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "preferredCurrencyId" UUID;

-- CreateTable
CREATE TABLE "currencies" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "numericCode" TEXT,
    "decimalPlaces" INTEGER NOT NULL DEFAULT 2,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currency_country_mappings" (
    "id" UUID NOT NULL,
    "countryCode" TEXT NOT NULL,
    "countryName" TEXT NOT NULL,
    "currencyId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "currency_country_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currency_settings" (
    "id" UUID NOT NULL,
    "defaultCurrencyId" UUID NOT NULL,
    "fallbackCurrencyId" UUID NOT NULL,
    "autoDetectEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "currency_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_prices" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "currencyId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "isConverted" BOOLEAN NOT NULL DEFAULT false,
    "exchangeRate" DECIMAL(18,8),
    "exchangeRateAsOf" TIMESTAMP(3),
    "providerPlanId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "currencies_code_key" ON "currencies"("code");

-- CreateIndex
CREATE INDEX "currencies_isActive_idx" ON "currencies"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "currency_country_mappings_countryCode_key" ON "currency_country_mappings"("countryCode");

-- CreateIndex
CREATE INDEX "currency_country_mappings_currencyId_idx" ON "currency_country_mappings"("currencyId");

-- CreateIndex
CREATE INDEX "plan_prices_currencyId_idx" ON "plan_prices"("currencyId");

-- CreateIndex
CREATE UNIQUE INDEX "plan_prices_planId_currencyId_key" ON "plan_prices"("planId", "currencyId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_preferredCurrencyId_fkey" FOREIGN KEY ("preferredCurrencyId") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "currency_country_mappings" ADD CONSTRAINT "currency_country_mappings_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "currency_settings" ADD CONSTRAINT "currency_settings_defaultCurrencyId_fkey" FOREIGN KEY ("defaultCurrencyId") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "currency_settings" ADD CONSTRAINT "currency_settings_fallbackCurrencyId_fkey" FOREIGN KEY ("fallbackCurrencyId") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_prices" ADD CONSTRAINT "plan_prices_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_prices" ADD CONSTRAINT "plan_prices_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sprint 16 data backfill — every subscription that existed before this
-- migration keeps the currency/amount its current plan already had at
-- migration time (Subscription.currency/amount are a snapshot, not an
-- FK, so this is a plain text/int copy, not schema-dependent on the new
-- currency catalogue existing yet). Going forward every write site
-- (SubscriptionsService, PaystackWebhookProcessor) sets these
-- explicitly instead of relying on this one-time backfill.
UPDATE "subscriptions" s
SET "currency" = p."currency",
    "amount" = p."priceAmount"
FROM "plans" p
WHERE s."planId" = p."id";
