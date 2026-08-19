-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "periodEnd" TIMESTAMP(3),
ADD COLUMN     "periodStart" TIMESTAMP(3),
ALTER COLUMN "currency" SET DEFAULT 'NGN';

-- AlterTable
ALTER TABLE "plans" ALTER COLUMN "currency" SET DEFAULT 'NGN';

-- AlterTable
ALTER TABLE "subscriptions" ALTER COLUMN "currency" SET DEFAULT 'NGN';

