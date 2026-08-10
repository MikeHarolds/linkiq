import { BadRequestException, Injectable } from '@nestjs/common';
import * as QRCode from 'qrcode';

import { validateQrConfig } from './utils/qr-validation';

export interface QrRenderConfig {
  size: number;
  margin: number;
  foregroundColor: string;
  backgroundColor: string;
  errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H';
}

/**
 * Pure rendering layer: given a string to encode (the caller — see
 * QrCodesService — is responsible for making sure that string is always
 * the LinkIQ short URL, never a destinationUrl) and an appearance
 * config, produces PNG bytes or an SVG string. No database access, no
 * knowledge of workspaces or links — this is intentionally the smallest
 * possible seam around the third-party library, so a future swap (a
 * different QR library, or moving generation into a worker if it ever
 * becomes expensive enough to justify one — see docs/architecture/qr-codes.md)
 * touches only this file.
 */
@Injectable()
export class QrGeneratorService {
  private assertValid(config: QrRenderConfig): void {
    const result = validateQrConfig(config);
    if (!result.valid) {
      throw new BadRequestException(
        result.reason ?? 'Invalid QR configuration',
      );
    }
  }

  async generatePng(data: string, config: QrRenderConfig): Promise<Buffer> {
    this.assertValid(config);
    return QRCode.toBuffer(data, {
      type: 'png',
      width: config.size,
      margin: config.margin,
      errorCorrectionLevel: config.errorCorrectionLevel,
      color: { dark: config.foregroundColor, light: config.backgroundColor },
    });
  }

  async generateSvg(data: string, config: QrRenderConfig): Promise<string> {
    this.assertValid(config);
    return QRCode.toString(data, {
      type: 'svg',
      width: config.size,
      margin: config.margin,
      errorCorrectionLevel: config.errorCorrectionLevel,
      color: { dark: config.foregroundColor, light: config.backgroundColor },
    });
  }
}
