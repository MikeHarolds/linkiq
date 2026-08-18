-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "homepageOrder" INTEGER,
ADD COLUMN     "isFeaturedOnHomepage" BOOLEAN NOT NULL DEFAULT false;
