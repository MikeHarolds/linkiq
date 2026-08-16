-- CreateEnum
CREATE TYPE "PermissionKey" AS ENUM ('LINKS_VIEW', 'LINKS_CREATE', 'LINKS_EDIT', 'LINKS_DELETE', 'ANALYTICS_VIEW', 'ANALYTICS_ADVANCED', 'DOMAINS_VIEW', 'DOMAINS_CREATE', 'DOMAINS_DELETE', 'QR_CODES_VIEW', 'QR_CODES_CREATE', 'QR_CODES_DELETE', 'CAMPAIGNS_VIEW', 'CAMPAIGNS_CREATE', 'CAMPAIGNS_EDIT', 'CAMPAIGNS_DELETE', 'API_VIEW', 'API_CREATE', 'API_REVOKE', 'WEBHOOKS_VIEW', 'WEBHOOKS_CREATE', 'WEBHOOKS_EDIT', 'WEBHOOKS_DELETE', 'BILLING_VIEW', 'BILLING_MANAGE');

-- CreateEnum
CREATE TYPE "RoleAssignmentSource" AS ENUM ('SUBSCRIPTION', 'ADMIN_ASSIGNED', 'SYSTEM_DEFAULT');

-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "platformRoleId" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "platformRoleId" UUID,
ADD COLUMN     "roleAssignmentSource" "RoleAssignmentSource";

-- CreateTable
CREATE TABLE "platform_roles" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" UUID NOT NULL,
    "platformRoleId" UUID NOT NULL,
    "permission" "PermissionKey" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_roles_slug_key" ON "platform_roles"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_platformRoleId_permission_key" ON "role_permissions"("platformRoleId", "permission");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_platformRoleId_fkey" FOREIGN KEY ("platformRoleId") REFERENCES "platform_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plans" ADD CONSTRAINT "plans_platformRoleId_fkey" FOREIGN KEY ("platformRoleId") REFERENCES "platform_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_platformRoleId_fkey" FOREIGN KEY ("platformRoleId") REFERENCES "platform_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
