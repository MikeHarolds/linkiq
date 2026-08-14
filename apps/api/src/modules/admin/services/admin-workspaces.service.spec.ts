import { NotFoundException } from '@nestjs/common';

import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../../test/mocks/prisma.mock';
import type { ApiKeysService } from '../../api-keys/api-keys.service';
import type { AuditService } from '../../audit/audit.service';
import type { BillingUsageService } from '../../billing/billing-usage.service';
import type { DomainsService } from '../../domains/domains.service';
import type { WebhooksService } from '../../webhooks/webhooks.service';

import { AdminWorkspacesService } from './admin-workspaces.service';

describe('AdminWorkspacesService', () => {
  let prisma: MockPrismaService;
  let billingUsage: { getUsage: jest.Mock };
  let domains: DomainsService;
  let apiKeys: { findAll: jest.Mock };
  let webhooks: { findAll: jest.Mock };
  let audit: { list: jest.Mock };
  let service: AdminWorkspacesService;

  const baseWorkspace = {
    id: 'ws1',
    name: 'Acme',
    slug: 'acme',
    createdAt: new Date(),
    organization: {
      name: 'Acme Org',
      owner: {
        id: 'owner1',
        email: 'owner@acme.com',
        firstName: 'Owner',
        lastName: 'One',
      },
    },
    subscription: {
      status: 'ACTIVE',
      plan: { name: 'Starter', slug: 'starter' },
    },
    _count: { members: 1, links: 0, customDomains: 0 },
    members: [],
    customDomains: [],
  };

  beforeEach(() => {
    prisma = createMockPrismaService();
    billingUsage = { getUsage: jest.fn().mockResolvedValue([]) };
    domains = {} as DomainsService;
    apiKeys = { findAll: jest.fn().mockResolvedValue([]) };
    webhooks = { findAll: jest.fn().mockResolvedValue([]) };
    audit = {
      list: jest.fn().mockResolvedValue({ items: [], pagination: {} }),
    };

    service = new AdminWorkspacesService(
      prisma as unknown as never,
      billingUsage as unknown as BillingUsageService,
      domains,
      apiKeys as unknown as ApiKeysService,
      webhooks as unknown as WebhooksService,
      audit as unknown as AuditService,
    );
  });

  describe('getDetail', () => {
    it('throws NotFoundException for a missing workspace', async () => {
      prisma.workspace.findUnique.mockResolvedValue(null);
      await expect(service.getDetail('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('delegates usage/API-keys/webhooks/audit to the existing customer-facing services, never raw queries', async () => {
      prisma.workspace.findUnique.mockResolvedValue(baseWorkspace);

      await service.getDetail('ws1');

      expect(billingUsage.getUsage).toHaveBeenCalledWith('ws1');
      expect(apiKeys.findAll).toHaveBeenCalledWith('ws1');
      expect(webhooks.findAll).toHaveBeenCalledWith('ws1');
      expect(audit.list).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: 'ws1' }),
      );
    });

    it('derives ACTIVE/EXPIRED/REVOKED api key status the same way the customer-facing controller does', async () => {
      prisma.workspace.findUnique.mockResolvedValue(baseWorkspace);
      const future = new Date(Date.now() + 86_400_000);
      const past = new Date(Date.now() - 86_400_000);
      apiKeys.findAll.mockResolvedValue([
        { id: 'k1', prefix: 'lk_live_aaa', revokedAt: null, expiresAt: null },
        { id: 'k2', prefix: 'lk_live_bbb', revokedAt: null, expiresAt: past },
        {
          id: 'k3',
          prefix: 'lk_live_ccc',
          revokedAt: new Date(),
          expiresAt: future,
        },
      ]);

      const detail = await service.getDetail('ws1');

      expect(detail.apiKeys.map((k) => k.status)).toEqual([
        'ACTIVE',
        'EXPIRED',
        'REVOKED',
      ]);
      // Never a raw secret/hash field on the returned shape.
      for (const key of detail.apiKeys) {
        expect(key).not.toHaveProperty('hashedKey');
      }
    });
  });

  describe('list', () => {
    it('paginates workspaces and maps organization/owner/subscription context', async () => {
      prisma.workspace.findMany.mockResolvedValue([baseWorkspace]);
      prisma.workspace.count.mockResolvedValue(1);

      const result = await service.list({ page: 1, pageSize: 20 } as never);

      expect(result.items).toEqual([
        expect.objectContaining({
          id: 'ws1',
          organizationName: 'Acme Org',
          planSlug: 'starter',
          subscriptionStatus: 'ACTIVE',
        }),
      ]);
      expect(result.pagination.totalItems).toBe(1);
    });
  });
});
