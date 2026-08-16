# Roles & Permissions Architecture

Sprint 15 introduces a platform-level product-entitlement system —
`PlatformRole` and `PermissionKey` — and wires it to the subscription
lifecycle so a user's entitlement tracks the plan they're actually paying
for, automatically, without ever touching `GlobalRole` or `WorkspaceRole`.

## 1. Three independent axes

LinkIQ now has three separate authorization concepts. They are **never**
interchangeable, and none of them is a special case of another:

```
User
 ├── globalRole        Platform administration — SUPER_ADMIN or USER.
 │                      Enforced by SuperAdminGuard. Unchanged this
 │                      sprint. Never influenced by platformRole or any
 │                      subscription.
 │
 ├── platformRole       Product entitlement — what features this user's
 │                      own account can use, independent of any one
 │                      workspace. New this sprint. Enforced by
 │                      PlatformPermissionsGuard / @RequirePermission().
 │
 └── workspace          Per-workspace collaboration role — OWNER / ADMIN /
     memberships         MEMBER / VIEWER. Enforced by WorkspaceRolesGuard /
                          @Roles(). Unchanged this sprint.
```

A workspace `ADMIN` is not a platform administrator. A `PlatformRole`
can never grant `SUPER_ADMIN` — they are different tables entirely
(`PlatformRole` has no relationship to the `GlobalRole` enum). A
subscription can never grant `SUPER_ADMIN` either, for the same reason.
`SuperAdminGuard` and `WorkspaceRolesGuard` are untouched — both new
guards this sprint are purely additive.

## 2. Data model

```
PlatformRole
  id, name, slug (unique, immutable), description
  isSystem   — true for the 4 seeded roles; blocks hard-delete
  isActive   — an inactive role stops granting its permissions
               immediately, even to a user still assigned it
  permissions -> RolePermission[]
  users      -> User[]           (User.platformRoleId)
  plans      -> Plan[]           (Plan.platformRoleId)

RolePermission
  id, platformRoleId, permission (PermissionKey enum)
  -- one row per (role, permission) pair. Mirrors PlanLimit's own
     key/value-against-a-fixed-enum shape rather than a third
     Permission lookup table — there's nothing to store about a
     permission beyond its key.

User (additive columns)
  platformRoleId        String? -> PlatformRole
  roleAssignmentSource   SUBSCRIPTION | ADMIN_ASSIGNED | SYSTEM_DEFAULT | null

Plan (additive column)
  platformRoleId  String? -> PlatformRole
  -- optional: an internal/custom plan can have no role, in which case
     subscribing to it never changes anyone's platformRole.
```

`PermissionKey` is a fixed Prisma enum (25 keys — `LINKS_VIEW` ...
`BILLING_MANAGE`), never an admin-creatable free-text field. Every key
corresponds to a module that genuinely exists in LinkIQ (Links,
Analytics, Domains, QR Codes, Campaigns, API Keys, Webhooks, Billing).

## 3. Seeded system roles

Four system roles, each a strict permission superset of the tier below
it, each attached to its corresponding `Plan`:

| Role              | Slug                | Permissions                                                   | Plan         |
| ----------------- | ------------------- | ------------------------------------------------------------- | ------------ |
| Free User         | `free-user`         | 16                                                            | free         |
| Starter User      | `starter-user`      | 21 (+domains create/delete, API create, webhooks create/edit) | starter      |
| Professional User | `professional-user` | 24 (+API revoke, webhooks delete, advanced analytics)         | professional |
| Business User     | `business-user`     | 25 (+billing manage)                                          | business     |

No `ENTERPRISE_USER` role: Enterprise is contract-priced, not
purchasable through automated checkout (see `docs/architecture/
paystack-integration.md`) — its `Plan.platformRoleId` is deliberately
left null.

`admin@linkiq.com` owns no workspace (see `seedAdminUser` — it never
creates one), so it resolves to `free-user`/`SYSTEM_DEFAULT` — a
harmless display fallback. Its actual admin-console access comes
entirely from `globalRole = SUPER_ADMIN`, never from this.

## 4. Role resolution — the single source of truth

`RoleResolutionService` (`apps/api/src/modules/roles/role-resolution
.service.ts`) is the **only** place in the codebase that ever writes
`User.platformRoleId`/`roleAssignmentSource`. Nothing else — not the
Paystack webhook processor, not `SubscriptionsService`, not any
controller — writes those columns directly.

```
resolveEffectiveRole(userId):
  1. If roleAssignmentSource == ADMIN_ASSIGNED → return the stored
     role as-is. Subscription events never reach this branch.
  2. Otherwise, resolve from subscriptions:
     - Find every workspace this user OWNS (WorkspaceMember.role ==
       OWNER — not membership; a workspace ADMIN/MEMBER/VIEWER's own
       platformRole is never derived from a workspace they don't own).
     - For each, is its subscription *effectively* active right now
       (TRIALING/ACTIVE/PAST_DUE via the existing getEffectiveStatus —
       the same lazy, no-cron derivation LinkStatus/CampaignStatus/
       SubscriptionStatus already use)?
     - Among the effectively-active ones whose Plan has an active
       platformRoleId, pick the highest PlanTier.
     - Found → SUBSCRIPTION. Not found → the seeded free-user role,
       SYSTEM_DEFAULT.
```

**Why "highest tier among owned workspaces," not a "primary
workspace":** a User can own more than one workspace (`WorkspacesService
.create()` lets any user spin up additional ones) and there is no
"primary workspace" concept anywhere in the existing schema. Highest
tier wins so owning even one Business-tier workspace never leaves a
user under-entitled because an older Free workspace happened to be
found first.

`syncStoredRole(userId)` calls the above and **writes only if the
result differs from what's stored** — idempotent by construction, so
repeated Paystack webhook delivery (already deduplicated at the
`BillingEvent` layer) can never produce duplicate audit rows or
redundant writes even without that outer guard.

### Call sites

`syncStoredRole()` is called, for every `OWNER` of the affected
workspace, from:

- `SubscriptionsService.subscribe() / changePlan() / cancel() /
reactivate()` — after each direct-apply success path.
- `PaystackWebhookProcessor`'s four state-changing handlers
  (`charge.success`, `subscription.create`, `subscription.disable`,
  `invoice.payment_failed`) — after each.
- `AuthService.register()` — once, right after the registration
  transaction commits (a fresh user's owned workspace already has its
  default FREE subscription, which now resolves to `free-user`).

Calling it unconditionally after every mutation is safe and correct
even when nothing should change: cancelling a subscription only sets a
future `cancelAt` (access continues per the existing "cancel at period
end" semantics — see `billing.md`), so `getEffectiveStatus` still
reports the subscription as active and resolution is a no-op until
that date actually passes and something calls resolution again.

## 5. Manual overrides

A Super Admin can assign a role directly (`POST /admin/users/:id/
assign-role`) — this sets `roleAssignmentSource = ADMIN_ASSIGNED`,
which `resolveEffectiveRole` then treats as sticky: no subscription
event, upgrade, downgrade, cancellation, or webhook ever overwrites it.
`POST /admin/users/:id/remove-role-override` clears it and immediately
re-resolves from the user's current subscription state (or the
`free-user` fallback).

## 6. Known lazy-resolution gap

Like `getEffectiveStatus` itself, resolution is **read-time derived**,
not eagerly corrected by a background job. If nothing ever triggers a
sync again after a subscription silently ages past a boundary (e.g. a
trial expiring with zero further user action and zero webhook), the
stored `platformRoleId` can lag until the next real trigger. This is
the same class of staleness the existing `Subscription.status` column
already tolerates — documented here rather than solved with new cron
infrastructure this sprint didn't ask for.

## 7. Authorization enforcement

`PlatformPermissionsGuard` + `@RequirePermission(key)`
(`apps/api/src/modules/roles/guards/platform-permissions.guard.ts`)
mirrors `WorkspaceRolesGuard`/`@Roles()`'s exact shape: a Reflector-read
metadata guard that's a no-op on any route without the decorator.
`SUPER_ADMIN` always passes, unconditionally. Otherwise the guard
checks `request.user.platformPermissions` — populated by `JwtStrategy
.validate()`'s existing per-request DB lookup (the same one that
already re-checks `isActive`/`globalRole` on every request), not a
second query and never encoded in the JWT payload itself (a large or
stale permission set has no business living in a token that isn't
re-validated until it expires).

Deliberately **not** retrofitted onto existing workspace-resource
controllers (Links/Analytics/Domains/etc.): those are already correctly
authorized by `WorkspaceRolesGuard` against the _workspace's_ plan
limits (`PlanLimitKey` / `BillingUsageService`), a different axis from
one _user's own_ personal platform entitlement. Layering
`@RequirePermission` onto them would check the acting user's own
subscription rather than the workspace being acted on — semantically
wrong for a collaborative, multi-workspace product. The guard is
demonstrated end-to-end instead on `GET /users/me/features/
advanced-analytics` (gated by `ANALYTICS_ADVANCED`) and proven via a
full e2e 401/403/200 matrix.

## 8. API surface

- `GET/POST/PATCH/DELETE /admin/roles[/:id]` — SUPER_ADMIN only.
- `POST /admin/users/:id/assign-role`, `POST /admin/users/:id/
remove-role-override` — SUPER_ADMIN only.
- `GET /users/me/entitlement` — self-service, any authenticated user;
  returns their own resolved role, source, and permissions.
- `POST /admin/plans`, `PATCH /admin/plans/:id` — extended with an
  optional `platformRoleId`, validated to reference an existing,
  active role (never SUPER_ADMIN-capable, by construction).

## 9. Audit logging

Every mutation goes through the existing `AuditService.record()`:
`admin.role_created/_updated/_activated/_deactivated/_archived`,
`admin.user_role_assigned`, `admin.user_role_override_removed`,
`role.subscription_role_assigned`, `role.fallback_applied`. Never logs
a permission list beyond the role's own key/slug — no secrets involved.
