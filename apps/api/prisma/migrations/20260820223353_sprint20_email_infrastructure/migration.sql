-- Sprint 20 — Email, Verification & Analytics Reporting
-- Purely additive: 6 new enums, 5 new tables, FKs to the existing `users`
-- table only. No existing table or column is altered.

-- CreateEnum
CREATE TYPE "EmailProviderKind" AS ENUM ('RESEND', 'SMTP');

-- CreateEnum
CREATE TYPE "SmtpEncryptionMode" AS ENUM ('NONE', 'TLS', 'SSL');

-- CreateEnum
CREATE TYPE "EmailLogType" AS ENUM ('VERIFICATION', 'WELCOME', 'PASSWORD_RESET', 'DAILY_REPORT', 'WEEKLY_REPORT', 'TEST');

-- CreateEnum
CREATE TYPE "EmailLogStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ReportFrequency" AS ENUM ('DAILY', 'WEEKLY');

-- CreateEnum
CREATE TYPE "ReportDay" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_configuration" (
    "id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "provider" "EmailProviderKind" NOT NULL DEFAULT 'RESEND',
    "fromName" TEXT NOT NULL DEFAULT 'LinkIQ',
    "fromEmail" TEXT NOT NULL DEFAULT '',
    "resendApiKeyPrefix" TEXT,
    "resendApiKeyCiphertext" TEXT,
    "smtpHost" TEXT,
    "smtpPort" INTEGER,
    "smtpUsername" TEXT,
    "smtpPasswordCiphertext" TEXT,
    "smtpEncryptionMode" "SmtpEncryptionMode" NOT NULL DEFAULT 'TLS',
    "requireEmailVerification" BOOLEAN NOT NULL DEFAULT true,
    "lastSuccessfulSendAt" TIMESTAMP(3),
    "lastFailedSendAt" TIMESTAMP(3),
    "lastConnectionTestAt" TIMESTAMP(3),
    "lastConnectionTestOk" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_configuration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_logs" (
    "id" UUID NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "recipientUserId" UUID,
    "type" "EmailLogType" NOT NULL,
    "provider" "EmailProviderKind",
    "status" "EmailLogStatus" NOT NULL DEFAULT 'QUEUED',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "metadata" JSONB,
    "referenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_report_preferences" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "emailReportsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "frequency" "ReportFrequency" NOT NULL DEFAULT 'WEEKLY',
    "reportDay" "ReportDay" NOT NULL DEFAULT 'MONDAY',
    "reportHourUtc" INTEGER NOT NULL DEFAULT 9,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_report_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_report_runs" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "frequency" "ReportFrequency" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "emailLogId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_report_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokens_tokenHash_key" ON "email_verification_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "email_verification_tokens_userId_idx" ON "email_verification_tokens"("userId");

-- CreateIndex
CREATE INDEX "email_logs_status_idx" ON "email_logs"("status");

-- CreateIndex
CREATE INDEX "email_logs_createdAt_idx" ON "email_logs"("createdAt");

-- CreateIndex
CREATE INDEX "email_logs_recipientEmail_idx" ON "email_logs"("recipientEmail");

-- CreateIndex
CREATE INDEX "email_logs_type_idx" ON "email_logs"("type");

-- CreateIndex
CREATE UNIQUE INDEX "user_report_preferences_userId_key" ON "user_report_preferences"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "email_report_runs_userId_frequency_periodStart_key" ON "email_report_runs"("userId", "frequency", "periodStart");

-- AddForeignKey
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_report_preferences" ADD CONSTRAINT "user_report_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_report_runs" ADD CONSTRAINT "email_report_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_report_runs" ADD CONSTRAINT "email_report_runs_emailLogId_fkey" FOREIGN KEY ("emailLogId") REFERENCES "email_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
