import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DomainStatus } from '@prisma/client';

import { makeUniqueConstraintError } from '../../../test/mocks/prisma-error.mock';
import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/mocks/prisma.mock';
import type { RequestContext } from '../../common/decorators/request-context.decorator';
import type { AuditService } from '../audit/audit.service';
import type { BillingUsageService } from '../billing/billing-usage.service';

import type { DomainCacheService } from './domain-cache.service';
import type { DomainResolverService } from './domain-resolver.service';
import { DomainsService } from './domains.service';
import type { DomainVerificationProvider } from './verification/domain-verification.provider';

const CTX: RequestContext = { ipAddress: '127.0.0.1', userAgent: 'jest' };
const WORKSPACE_ID = 'ws-1';
const USER_ID = 'user-1';

function makeDomain(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'dom-1',
    workspaceId: WORKSPACE_ID,
    domain: 'go.acme.com',
    normalizedDomain: 'go.acme.com',
    status: DomainStatus.PENDING,
    verificationToken: 'linkiq-verify-abc',
    verificationCheckedAt: null,
    verifiedAt: null,
    isPrimary: false,
    createdById: USER_ID,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

describe('DomainsService', () => {
  let prisma: MockPrismaService;
  let audit: { record: jest.Mock };
  let cache: { invalidate: jest.Mock };
  let resolver: { isDefaultHost: jest.Mock };
  let verificationProvider: { check: jest.Mock };
  let billingUsage: { assertCanUse: jest.Mock };
  let service: DomainsService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    cache = { invalidate: jest.fn().mockResolvedValue(undefined) };
    resolver = { isDefaultHost: jest.fn().mockReturnValue(false) };
    verificationProvider = { check: jest.fn() };
    billingUsage = { assertCanUse: jest.fn().mockResolvedValue(undefined) };
    service = new DomainsService(
      prisma as unknown as never,
      audit as unknown as AuditService,
      cache as unknown as DomainCacheService,
      resolver as unknown as DomainResolverService,
      verificationProvider as unknown as DomainVerificationProvider,
      billingUsage as unknown as BillingUsageService,
    );
  });

  describe('create', () => {
    it('rejects creation when the workspace has reached its custom domain limit', async () => {
      billingUsage.assertCanUse.mockRejectedValue(new Error('PLAN_LIMIT_REACHED'));

      await expect(
        service.create(WORKSPACE_ID, USER_ID, { domain: 'go.acme.com' }, CTX),
      ).rejects.toThrow('PLAN_LIMIT_REACHED');
      expect(prisma.customDomain.create).not.toHaveBeenCalled();
    });

    it('rejects an invalid domain before touching the database', async () => {
      await expect(
        service.create(WORKSPACE_ID, USER_ID, { domain: 'not a domain' }, CTX),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.customDomain.create).not.toHaveBeenCalled();
    });

    it('rejects a hostname reserved for the default LinkIQ host', async () => {
      resolver.isDefaultHost.mockReturnValue(true);
      await expect(
        service.create(
          WORKSPACE_ID,
          USER_ID,
          { domain: 'app.linkiq.com' },
          CTX,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.customDomain.create).not.toHaveBeenCalled();
    });

    it('creates a PENDING domain and records an audit event', async () => {
      prisma.customDomain.create.mockResolvedValue(makeDomain());

      const result = await service.create(
        WORKSPACE_ID,
        USER_ID,
        { domain: 'go.acme.com' },
        CTX,
      );

      expect(result.status).toBe(DomainStatus.PENDING);
      expect(prisma.customDomain.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            workspaceId: WORKSPACE_ID,
            normalizedDomain: 'go.acme.com',
          }),
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'domain.created' }),
      );
    });

    it('translates a unique-constraint violation into a 409', async () => {
      prisma.customDomain.create.mockRejectedValue(makeUniqueConstraintError());
      await expect(
        service.create(WORKSPACE_ID, USER_ID, { domain: 'go.acme.com' }, CTX),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findByIdOrThrow — workspace isolation', () => {
    it('throws NotFoundException when the domain does not exist', async () => {
      prisma.customDomain.findUnique.mockResolvedValue(null);
      await expect(
        service.findByIdOrThrow(WORKSPACE_ID, 'missing'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for a domain in another workspace', async () => {
      prisma.customDomain.findUnique.mockResolvedValue(
        makeDomain({ workspaceId: 'other-ws' }),
      );
      await expect(
        service.findByIdOrThrow(WORKSPACE_ID, 'dom-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for a soft-deleted domain', async () => {
      prisma.customDomain.findUnique.mockResolvedValue(
        makeDomain({ deletedAt: new Date() }),
      );
      await expect(
        service.findByIdOrThrow(WORKSPACE_ID, 'dom-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findSelectableOrThrow', () => {
    it('rejects a PENDING domain', async () => {
      prisma.customDomain.findUnique.mockResolvedValue(
        makeDomain({ status: DomainStatus.PENDING }),
      );
      await expect(
        service.findSelectableOrThrow(WORKSPACE_ID, 'dom-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a VERIFIED domain', async () => {
      prisma.customDomain.findUnique.mockResolvedValue(
        makeDomain({ status: DomainStatus.VERIFIED }),
      );
      await expect(
        service.findSelectableOrThrow(WORKSPACE_ID, 'dom-1'),
      ).resolves.toMatchObject({ status: DomainStatus.VERIFIED });
    });

    it('accepts an ACTIVE domain', async () => {
      prisma.customDomain.findUnique.mockResolvedValue(
        makeDomain({ status: DomainStatus.ACTIVE }),
      );
      await expect(
        service.findSelectableOrThrow(WORKSPACE_ID, 'dom-1'),
      ).resolves.toMatchObject({ status: DomainStatus.ACTIVE });
    });
  });

  describe('update', () => {
    it('is a no-op when domain is not provided', async () => {
      const existing = makeDomain();
      prisma.customDomain.findUnique.mockResolvedValue(existing);
      const result = await service.update(
        WORKSPACE_ID,
        'dom-1',
        USER_ID,
        {},
        CTX,
      );
      expect(result).toBe(existing);
      expect(prisma.customDomain.update).not.toHaveBeenCalled();
    });

    it('rejects changing the hostname once verification has succeeded', async () => {
      prisma.customDomain.findUnique.mockResolvedValue(
        makeDomain({ status: DomainStatus.VERIFIED }),
      );
      await expect(
        service.update(
          WORKSPACE_ID,
          'dom-1',
          USER_ID,
          { domain: 'other.acme.com' },
          CTX,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows changing the hostname while PENDING and resets verification', async () => {
      prisma.customDomain.findUnique.mockResolvedValue(
        makeDomain({ status: DomainStatus.PENDING }),
      );
      prisma.customDomain.update.mockResolvedValue(
        makeDomain({
          domain: 'other.acme.com',
          normalizedDomain: 'other.acme.com',
        }),
      );

      await service.update(
        WORKSPACE_ID,
        'dom-1',
        USER_ID,
        { domain: 'other.acme.com' },
        CTX,
      );

      expect(prisma.customDomain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            normalizedDomain: 'other.acme.com',
            status: DomainStatus.PENDING,
            verifiedAt: null,
          }),
        }),
      );
    });

    it('allows changing the hostname while FAILED', async () => {
      prisma.customDomain.findUnique.mockResolvedValue(
        makeDomain({ status: DomainStatus.FAILED }),
      );
      prisma.customDomain.update.mockResolvedValue(makeDomain());

      await expect(
        service.update(
          WORKSPACE_ID,
          'dom-1',
          USER_ID,
          { domain: 'other.acme.com' },
          CTX,
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('verify', () => {
    it('marks the domain VERIFIED and sets verifiedAt on success', async () => {
      const existing = makeDomain();
      prisma.customDomain.findUnique.mockResolvedValue(existing);
      verificationProvider.check.mockResolvedValue(true);
      prisma.customDomain.update.mockResolvedValue(
        makeDomain({ status: DomainStatus.VERIFIED, verifiedAt: new Date() }),
      );

      const result = await service.verify(WORKSPACE_ID, 'dom-1', USER_ID, CTX);

      expect(verificationProvider.check).toHaveBeenCalledWith(
        'go.acme.com',
        'linkiq-verify-abc',
      );
      expect(result.status).toBe(DomainStatus.VERIFIED);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'domain.verified' }),
      );
    });

    it('marks the domain FAILED when the TXT record is not found', async () => {
      const existing = makeDomain();
      prisma.customDomain.findUnique.mockResolvedValue(existing);
      verificationProvider.check.mockResolvedValue(false);
      prisma.customDomain.update.mockResolvedValue(
        makeDomain({ status: DomainStatus.FAILED }),
      );

      const result = await service.verify(WORKSPACE_ID, 'dom-1', USER_ID, CTX);

      expect(result.status).toBe(DomainStatus.FAILED);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'domain.verification_failed' }),
      );
    });

    it('never reports VERIFIED merely because the endpoint was called', async () => {
      prisma.customDomain.findUnique.mockResolvedValue(makeDomain());
      verificationProvider.check.mockResolvedValue(false);
      prisma.customDomain.update.mockImplementation(({ data }) =>
        Promise.resolve(makeDomain(data)),
      );

      const result = await service.verify(WORKSPACE_ID, 'dom-1', USER_ID, CTX);
      expect(result.status).not.toBe(DomainStatus.VERIFIED);
    });
  });

  describe('activate', () => {
    it('activates a VERIFIED domain', async () => {
      prisma.customDomain.findUnique.mockResolvedValue(
        makeDomain({ status: DomainStatus.VERIFIED }),
      );
      prisma.customDomain.update.mockResolvedValue(
        makeDomain({ status: DomainStatus.ACTIVE }),
      );

      const result = await service.activate(
        WORKSPACE_ID,
        'dom-1',
        USER_ID,
        CTX,
      );
      expect(result.status).toBe(DomainStatus.ACTIVE);
    });

    it('re-activates a DISABLED domain', async () => {
      prisma.customDomain.findUnique.mockResolvedValue(
        makeDomain({ status: DomainStatus.DISABLED }),
      );
      prisma.customDomain.update.mockResolvedValue(
        makeDomain({ status: DomainStatus.ACTIVE }),
      );

      await expect(
        service.activate(WORKSPACE_ID, 'dom-1', USER_ID, CTX),
      ).resolves.toMatchObject({ status: DomainStatus.ACTIVE });
    });

    it('rejects activating a PENDING domain', async () => {
      prisma.customDomain.findUnique.mockResolvedValue(
        makeDomain({ status: DomainStatus.PENDING }),
      );
      await expect(
        service.activate(WORKSPACE_ID, 'dom-1', USER_ID, CTX),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('disable', () => {
    it('disables an ACTIVE domain and clears isPrimary', async () => {
      prisma.customDomain.findUnique.mockResolvedValue(
        makeDomain({ status: DomainStatus.ACTIVE, isPrimary: true }),
      );
      prisma.customDomain.update.mockResolvedValue(
        makeDomain({ status: DomainStatus.DISABLED, isPrimary: false }),
      );

      await service.disable(WORKSPACE_ID, 'dom-1', USER_ID, CTX);

      expect(prisma.customDomain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: DomainStatus.DISABLED, isPrimary: false },
        }),
      );
    });

    it('rejects disabling a non-ACTIVE domain', async () => {
      prisma.customDomain.findUnique.mockResolvedValue(
        makeDomain({ status: DomainStatus.VERIFIED }),
      );
      await expect(
        service.disable(WORKSPACE_ID, 'dom-1', USER_ID, CTX),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('setPrimary', () => {
    it('rejects a domain that is not verified/active', async () => {
      prisma.customDomain.findUnique.mockResolvedValue(
        makeDomain({ status: DomainStatus.PENDING }),
      );
      await expect(
        service.setPrimary(WORKSPACE_ID, 'dom-1', USER_ID, CTX),
      ).rejects.toThrow(BadRequestException);
    });

    it('unsets the previous primary before setting the new one', async () => {
      prisma.customDomain.findUnique.mockResolvedValue(
        makeDomain({ status: DomainStatus.ACTIVE }),
      );
      prisma.customDomain.update.mockResolvedValue(
        makeDomain({ status: DomainStatus.ACTIVE, isPrimary: true }),
      );

      await service.setPrimary(WORKSPACE_ID, 'dom-1', USER_ID, CTX);

      expect(prisma.customDomain.updateMany).toHaveBeenCalledWith({
        where: {
          workspaceId: WORKSPACE_ID,
          isPrimary: true,
          id: { not: 'dom-1' },
        },
        data: { isPrimary: false },
      });
      expect(prisma.customDomain.update).toHaveBeenCalledWith({
        where: { id: 'dom-1' },
        data: { isPrimary: true },
      });
    });
  });

  describe('softDelete', () => {
    it("soft-deletes the domain and nulls out its links' customDomainId", async () => {
      prisma.customDomain.findUnique.mockResolvedValue(makeDomain());
      prisma.customDomain.update.mockResolvedValue(
        makeDomain({ deletedAt: new Date() }),
      );
      prisma.link.updateMany.mockResolvedValue({ count: 2 });

      await service.softDelete(WORKSPACE_ID, 'dom-1', USER_ID, CTX);

      expect(prisma.customDomain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isPrimary: false }),
        }),
      );
      expect(prisma.link.updateMany).toHaveBeenCalledWith({
        where: { customDomainId: 'dom-1' },
        data: { customDomainId: null },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'domain.deleted' }),
      );
    });
  });
});
