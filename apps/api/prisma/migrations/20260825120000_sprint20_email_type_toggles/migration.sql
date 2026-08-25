-- AlterTable
ALTER TABLE "email_configuration"
  ADD COLUMN "welcomeEmailsEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "verificationEmailsEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "passwordResetEmailsEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "reportEmailsEnabled" BOOLEAN NOT NULL DEFAULT true;
