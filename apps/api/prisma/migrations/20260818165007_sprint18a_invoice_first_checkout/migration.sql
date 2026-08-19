-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InvoiceStatus" ADD VALUE 'PENDING';
ALTER TYPE "InvoiceStatus" ADD VALUE 'FAILED';

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "targetPlanId" UUID;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_targetPlanId_fkey" FOREIGN KEY ("targetPlanId") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

