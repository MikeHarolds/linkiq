import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/mocks/prisma.mock';

import { AuditService } from './audit.service';

describe('AuditService', () => {
  let prisma: MockPrismaService;
  let service: AuditService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    prisma.auditLog.create.mockResolvedValue({});
    service = new AuditService(prisma as unknown as never);
  });

  it('persists a JSON-safe metadata object unchanged', async () => {
    await service.record({
      action: 'link.created',
      entity: 'Link',
      workspaceId: 'ws-1',
      userId: 'user-1',
      metadata: { shortCode: 'abc123', fields: ['title', 'description'] },
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: { shortCode: 'abc123', fields: ['title', 'description'] },
      }),
    });
  });

  it('does not throw and passes metadata through as undefined when omitted', async () => {
    // Regression coverage for the metadata JSON-typing fix: `metadata`
    // must remain genuinely optional (absent), not silently coerced
    // into an empty object — an empty object is a different, meaningful
    // value from "no metadata was ever provided" and would misrepresent
    // what actually happened for actions that legitimately have none.
    await expect(
      service.record({
        action: 'auth.login_succeeded',
        entity: 'User',
        userId: 'user-1',
      }),
    ).resolves.toBeUndefined();

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ metadata: undefined }),
    });
  });

  it('never coerces omitted metadata into an empty object', async () => {
    await service.record({
      action: 'auth.logout',
      entity: 'User',
      userId: 'user-1',
    });

    const createCall = prisma.auditLog.create.mock.calls[0][0];
    expect(createCall.data.metadata).not.toEqual({});
    expect(createCall.data.metadata).toBeUndefined();
  });

  it('passes through all other fields correctly alongside metadata', async () => {
    await service.record({
      action: 'campaign.archived',
      entity: 'Campaign',
      entityId: 'campaign-1',
      userId: 'user-1',
      workspaceId: 'ws-1',
      metadata: { previousStatus: 'ACTIVE', newStatus: 'ARCHIVED' },
      ipAddress: '127.0.0.1',
      userAgent: 'jest',
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        action: 'campaign.archived',
        entity: 'Campaign',
        entityId: 'campaign-1',
        userId: 'user-1',
        workspaceId: 'ws-1',
        metadata: { previousStatus: 'ACTIVE', newStatus: 'ARCHIVED' },
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
      },
    });
  });
});
