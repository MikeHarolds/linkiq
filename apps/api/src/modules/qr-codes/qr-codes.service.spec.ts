import { BadRequestException, NotFoundException } from '@nestjs/common';
import { QrFormat } from '@prisma/client';

import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/mocks/prisma.mock';
import type { AuditService } from '../audit/audit.service';
import { PublicUrlService } from '../domains/public-url.service';

import { QrCodesService } from './qr-codes.service';
import type { QrGeneratorService } from './qr-generator.service';

const CTX = { ipAddress: '127.0.0.1', userAgent: 'jest' };
const WORKSPACE_ID = 'ws-1';
const LINK_ID = 'link-1';
const USER_ID = 'user-1';

function makeLink(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: LINK_ID,
    workspaceId: WORKSPACE_ID,
    shortCode: 'abc1234',
    deletedAt: null,
    ...overrides,
  };
}

function makeQrCode(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'qr-1',
    workspaceId: WORKSPACE_ID,
    linkId: LINK_ID,
    name: 'Test QR',
    format: QrFormat.PNG,
    size: 512,
    foregroundColor: '#000000',
    backgroundColor: '#FFFFFF',
    errorCorrectionLevel: 'M',
    margin: 4,
    createdById: USER_ID,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

describe('QrCodesService', () => {
  let prisma: MockPrismaService;
  let audit: { record: jest.Mock };
  let generator: { generatePng: jest.Mock; generateSvg: jest.Mock };
  let service: QrCodesService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    generator = {
      generatePng: jest.fn().mockResolvedValue(Buffer.from('fake-png')),
      generateSvg: jest.fn().mockResolvedValue('<svg>fake</svg>'),
    };
    service = new QrCodesService(
      prisma as unknown as never,
      audit as unknown as AuditService,
      generator as unknown as QrGeneratorService,
      new PublicUrlService(),
    );
  });

  describe('create', () => {
    it('rejects creation when the link does not exist', async () => {
      prisma.link.findUnique.mockResolvedValue(null);

      await expect(
        service.create(WORKSPACE_ID, LINK_ID, USER_ID, { name: 'Test' }, CTX),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.qrCode.create).not.toHaveBeenCalled();
    });

    it('rejects creation when the link belongs to another workspace (404, not 403)', async () => {
      prisma.link.findUnique.mockResolvedValue(
        makeLink({ workspaceId: 'other-ws' }),
      );

      await expect(
        service.create(WORKSPACE_ID, LINK_ID, USER_ID, { name: 'Test' }, CTX),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects creation for a soft-deleted link', async () => {
      prisma.link.findUnique.mockResolvedValue(
        makeLink({ deletedAt: new Date() }),
      );

      await expect(
        service.create(WORKSPACE_ID, LINK_ID, USER_ID, { name: 'Test' }, CTX),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates a QR code with defaults when only name is given', async () => {
      prisma.link.findUnique.mockResolvedValue(makeLink());
      prisma.qrCode.create.mockResolvedValue(makeQrCode());

      const result = await service.create(
        WORKSPACE_ID,
        LINK_ID,
        USER_ID,
        { name: 'Test' },
        CTX,
      );

      expect(result.name).toBe('Test QR');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'qr_code.created' }),
      );
    });

    it('rejects identical foreground/background colors at creation, before hitting the database', async () => {
      prisma.link.findUnique.mockResolvedValue(makeLink());

      await expect(
        service.create(
          WORKSPACE_ID,
          LINK_ID,
          USER_ID,
          {
            name: 'Bad',
            foregroundColor: '#123456',
            backgroundColor: '#123456',
          },
          CTX,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.qrCode.create).not.toHaveBeenCalled();
    });

    it('rejects a foreground color that collides with the DEFAULT background when background is omitted', async () => {
      prisma.link.findUnique.mockResolvedValue(makeLink());

      await expect(
        service.create(
          WORKSPACE_ID,
          LINK_ID,
          USER_ID,
          { name: 'Bad', foregroundColor: '#FFFFFF' },
          CTX,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an out-of-bounds size', async () => {
      prisma.link.findUnique.mockResolvedValue(makeLink());

      await expect(
        service.create(
          WORKSPACE_ID,
          LINK_ID,
          USER_ID,
          { name: 'Huge', size: 999999 },
          CTX,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findByIdOrThrow', () => {
    it('throws NotFoundException for a QR code in another workspace', async () => {
      prisma.qrCode.findUnique.mockResolvedValue(
        makeQrCode({ workspaceId: 'other-ws' }),
      );
      await expect(
        service.findByIdOrThrow(WORKSPACE_ID, 'qr-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for a soft-deleted QR code', async () => {
      prisma.qrCode.findUnique.mockResolvedValue(
        makeQrCode({ deletedAt: new Date() }),
      );
      await expect(
        service.findByIdOrThrow(WORKSPACE_ID, 'qr-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns the QR code when it belongs to the workspace', async () => {
      const qr = makeQrCode();
      prisma.qrCode.findUnique.mockResolvedValue(qr);
      await expect(service.findByIdOrThrow(WORKSPACE_ID, 'qr-1')).resolves.toBe(
        qr,
      );
    });
  });

  describe('update', () => {
    it('rejects an update that would make colors identical', async () => {
      prisma.qrCode.findUnique.mockResolvedValue(
        makeQrCode({ foregroundColor: '#000000', backgroundColor: '#FFFFFF' }),
      );

      await expect(
        service.update(
          WORKSPACE_ID,
          'qr-1',
          USER_ID,
          { backgroundColor: '#000000' },
          CTX,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.qrCode.update).not.toHaveBeenCalled();
    });

    it('allows an update that keeps colors distinct', async () => {
      prisma.qrCode.findUnique.mockResolvedValue(makeQrCode());
      prisma.qrCode.update.mockResolvedValue(makeQrCode({ name: 'Renamed' }));

      const result = await service.update(
        WORKSPACE_ID,
        'qr-1',
        USER_ID,
        { name: 'Renamed' },
        CTX,
      );

      expect(result.name).toBe('Renamed');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'qr_code.updated' }),
      );
    });
  });

  describe('softDelete', () => {
    it('sets deletedAt and audits', async () => {
      prisma.qrCode.findUnique.mockResolvedValue(makeQrCode());
      prisma.qrCode.update.mockResolvedValue(
        makeQrCode({ deletedAt: new Date() }),
      );

      await service.softDelete(WORKSPACE_ID, 'qr-1', USER_ID, CTX);

      expect(prisma.qrCode.update).toHaveBeenCalledWith({
        where: { id: 'qr-1' },
        data: { deletedAt: expect.any(Date) },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'qr_code.deleted' }),
      );
    });
  });

  describe('generateDownload', () => {
    it('encodes the LINK SHORT URL, never the destinationUrl', async () => {
      prisma.qrCode.findUnique.mockResolvedValue(makeQrCode());
      prisma.link.findUnique.mockResolvedValue(
        makeLink({
          shortCode: 'my-code',
          destinationUrl: 'https://totally-different-destination.example',
        }),
      );

      await service.generateDownload(
        WORKSPACE_ID,
        'qr-1',
        USER_ID,
        undefined,
        CTX,
      );

      const [encodedUrl] = generator.generatePng.mock.calls[0];
      expect(encodedUrl).toContain('/my-code');
      expect(encodedUrl).not.toContain('totally-different-destination');
    });

    it('embeds QR attribution UTM parameters in the encoded URL', async () => {
      prisma.qrCode.findUnique.mockResolvedValue(
        makeQrCode({ name: 'Storefront Poster' }),
      );
      prisma.link.findUnique.mockResolvedValue(makeLink());

      await service.generateDownload(
        WORKSPACE_ID,
        'qr-1',
        USER_ID,
        undefined,
        CTX,
      );

      const [encodedUrl] = generator.generatePng.mock.calls[0];
      expect(encodedUrl).toContain('utm_source=qr_code');
      expect(encodedUrl).toContain('utm_medium=qr');
      expect(encodedUrl).toContain('utm_campaign=storefront-poster');
    });

    it('encodes the ACTIVE custom domain instead of the default LinkIQ URL (Sprint 6)', async () => {
      prisma.qrCode.findUnique.mockResolvedValue(makeQrCode());
      prisma.link.findUnique.mockResolvedValue(
        makeLink({
          shortCode: 'branded-code',
          customDomain: { normalizedDomain: 'go.acme.com', status: 'ACTIVE' },
        }),
      );

      await service.generateDownload(
        WORKSPACE_ID,
        'qr-1',
        USER_ID,
        undefined,
        CTX,
      );

      const [encodedUrl] = generator.generatePng.mock.calls[0];
      expect(encodedUrl).toContain('https://go.acme.com/branded-code');
    });

    it('falls back to the default LinkIQ URL when the custom domain is not ACTIVE', async () => {
      prisma.qrCode.findUnique.mockResolvedValue(makeQrCode());
      prisma.link.findUnique.mockResolvedValue(
        makeLink({
          shortCode: 'branded-code',
          customDomain: { normalizedDomain: 'go.acme.com', status: 'DISABLED' },
        }),
      );

      await service.generateDownload(
        WORKSPACE_ID,
        'qr-1',
        USER_ID,
        undefined,
        CTX,
      );

      const [encodedUrl] = generator.generatePng.mock.calls[0];
      expect(encodedUrl).not.toContain('go.acme.com');
      expect(encodedUrl).toContain('/branded-code');
    });

    it('uses the stored format by default', async () => {
      prisma.qrCode.findUnique.mockResolvedValue(
        makeQrCode({ format: QrFormat.SVG }),
      );
      prisma.link.findUnique.mockResolvedValue(makeLink());

      const result = await service.generateDownload(
        WORKSPACE_ID,
        'qr-1',
        USER_ID,
        undefined,
        CTX,
      );

      expect(generator.generateSvg).toHaveBeenCalled();
      expect(generator.generatePng).not.toHaveBeenCalled();
      expect(result.contentType).toBe('image/svg+xml');
    });

    it('honors a format override even when it differs from the stored format', async () => {
      prisma.qrCode.findUnique.mockResolvedValue(
        makeQrCode({ format: QrFormat.PNG }),
      );
      prisma.link.findUnique.mockResolvedValue(makeLink());

      const result = await service.generateDownload(
        WORKSPACE_ID,
        'qr-1',
        USER_ID,
        QrFormat.SVG,
        CTX,
      );

      expect(generator.generateSvg).toHaveBeenCalled();
      expect(result.contentType).toBe('image/svg+xml');
    });

    it('produces a safe, slugified filename', async () => {
      prisma.qrCode.findUnique.mockResolvedValue(
        makeQrCode({ name: 'My Awesome Campaign!! 🎉' }),
      );
      prisma.link.findUnique.mockResolvedValue(makeLink());

      const result = await service.generateDownload(
        WORKSPACE_ID,
        'qr-1',
        USER_ID,
        undefined,
        CTX,
      );

      expect(result.filename).toMatch(/^linkiq-[a-z0-9-]+-qr\.png$/);
      expect(result.filename).not.toContain(' ');
      expect(result.filename).not.toContain('/');
      expect(result.filename).not.toContain('..');
    });

    it('records an audit log entry on download', async () => {
      prisma.qrCode.findUnique.mockResolvedValue(makeQrCode());
      prisma.link.findUnique.mockResolvedValue(makeLink());

      await service.generateDownload(
        WORKSPACE_ID,
        'qr-1',
        USER_ID,
        undefined,
        CTX,
      );

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'qr_code.downloaded' }),
      );
    });

    it('throws if the underlying link is somehow gone', async () => {
      prisma.qrCode.findUnique.mockResolvedValue(makeQrCode());
      prisma.link.findUnique.mockResolvedValue(null);

      await expect(
        service.generateDownload(WORKSPACE_ID, 'qr-1', USER_ID, undefined, CTX),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
