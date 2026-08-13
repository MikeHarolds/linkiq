-- AlterEnum
ALTER TYPE "InvoiceStatus" ADD VALUE 'REFUNDED';

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "failureReason" TEXT;

-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "providerPlanId" TEXT;

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "pastDueSince" TIMESTAMP(3);
