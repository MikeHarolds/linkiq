import { BadRequestException } from '@nestjs/common';

import { QrGeneratorService } from './qr-generator.service';

describe('QrGeneratorService', () => {
  let service: QrGeneratorService;

  beforeEach(() => {
    service = new QrGeneratorService();
  });

  const validConfig = {
    size: 256,
    margin: 4,
    foregroundColor: '#000000',
    backgroundColor: '#FFFFFF',
    errorCorrectionLevel: 'M' as const,
  };

  describe('generatePng', () => {
    it('produces a real PNG buffer', async () => {
      const buffer = await service.generatePng(
        'https://linkiq.example/abc123',
        validConfig,
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
      // PNG magic bytes: 89 50 4E 47
      expect(buffer.subarray(0, 4).toString('hex')).toBe('89504e47');
    });

    it('rejects an invalid config before attempting generation', async () => {
      await expect(
        service.generatePng('https://linkiq.example/abc123', {
          ...validConfig,
          foregroundColor: '#FFFFFF',
          backgroundColor: '#FFFFFF',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an oversized dimension', async () => {
      await expect(
        service.generatePng('https://linkiq.example/abc123', {
          ...validConfig,
          size: 100000,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('generateSvg', () => {
    it('produces valid SVG markup', async () => {
      const svg = await service.generateSvg(
        'https://linkiq.example/abc123',
        validConfig,
      );
      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
    });

    it('rejects an invalid config before attempting generation', async () => {
      await expect(
        service.generateSvg('https://linkiq.example/abc123', {
          ...validConfig,
          size: -5,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  it('produces different output for different error correction levels (proves the option is actually applied)', async () => {
    const longUrl = `https://linkiq.example/${'a'.repeat(100)}`;
    const low = await service.generatePng(longUrl, {
      ...validConfig,
      errorCorrectionLevel: 'L',
    });
    const high = await service.generatePng(longUrl, {
      ...validConfig,
      errorCorrectionLevel: 'H',
    });
    // Higher error correction embeds more redundancy data, which for a
    // sufficiently long payload changes the required QR version (module
    // grid size) and therefore the encoded output — not asserting exact
    // bytes (fragile), just that the option demonstrably does something.
    expect(low.equals(high)).toBe(false);
  });
});
