-- CreateEnum
CREATE TYPE "LandingPageSectionKey" AS ENUM ('HERO', 'STATS', 'FEATURES', 'PRODUCT_SHOWCASE', 'CUSTOM_DOMAINS', 'DEVELOPERS', 'PRICING', 'FAQ', 'CTA');

-- CreateEnum
CREATE TYPE "LandingPageNavPlacement" AS ENUM ('HEADER', 'FOOTER_PRODUCT', 'FOOTER_DEVELOPERS', 'FOOTER_COMPANY');

-- CreateTable
CREATE TABLE "landing_page_sections" (
    "id" UUID NOT NULL,
    "key" "LandingPageSectionKey" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "eyebrow" TEXT,
    "headline" TEXT,
    "description" TEXT,
    "primaryCtaText" TEXT,
    "primaryCtaUrl" TEXT,
    "secondaryCtaText" TEXT,
    "secondaryCtaUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "landing_page_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "landing_page_features" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "landing_page_features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "landing_page_faqs" (
    "id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "landing_page_faqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "landing_page_stats" (
    "id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "sublabel" TEXT,
    "icon" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "landing_page_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "landing_page_nav_items" (
    "id" UUID NOT NULL,
    "placement" "LandingPageNavPlacement" NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "landing_page_nav_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_branding" (
    "id" UUID NOT NULL,
    "siteName" TEXT NOT NULL DEFAULT 'LinkIQ',
    "logoUrl" TEXT,
    "faviconUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_branding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "landing_page_sections_key_key" ON "landing_page_sections"("key");

-- CreateIndex
CREATE INDEX "landing_page_features_isActive_sortOrder_idx" ON "landing_page_features"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "landing_page_faqs_isActive_sortOrder_idx" ON "landing_page_faqs"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "landing_page_stats_isActive_sortOrder_idx" ON "landing_page_stats"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "landing_page_nav_items_placement_isActive_sortOrder_idx" ON "landing_page_nav_items"("placement", "isActive", "sortOrder");
