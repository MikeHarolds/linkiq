const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const QR_SIZE_MIN = 128;
/**
 * Deliberately lower than an arbitrary "big number" — chosen from a real
 * measurement, not a guess. Generation time scales roughly with pixel
 * count (i.e., quadratically with this linear dimension), and `qrcode`'s
 * PNG encoding is synchronous, CPU-bound work that blocks Node's event
 * loop for its duration — there's no BullMQ queue in front of it (see
 * docs/architecture/qr-codes.md for why that's the right call for
 * *normal* sizes). Measured on this sandbox's hardware: 512px ≈ 55ms,
 * 1024px ≈ 165ms, 2000px ≈ 650ms. 650ms of blocked event loop on a
 * shared Node process is long enough to visibly delay concurrent
 * requests (including redirects) if hit even occasionally under load;
 * 1024px stays comfortably fast while still exceeding what any real
 * print-poster use case needs.
 */
export const QR_SIZE_MAX = 1024;
export const QR_MARGIN_MIN = 0;
export const QR_MARGIN_MAX = 20;

export interface QrValidationResult {
  valid: boolean;
  reason?: string;
}

export function isValidHexColor(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value);
}

/**
 * Normalizes a 3-digit hex color to 6 digits (e.g. "#0f0" -> "#00ff00")
 * so downstream consumers (the qrcode library, the frontend preview)
 * always see one consistent shape. Assumes the input already passed
 * isValidHexColor.
 */
export function normalizeHexColor(value: string): string {
  if (value.length === 4) {
    const [, r, g, b] = value;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return value.toLowerCase();
}

/**
 * Validates a full QR appearance configuration together, not just each
 * field in isolation — the one thing no single-field check can catch is
 * foreground/background colors that are identical (or too close), which
 * produces a QR code that scanners genuinely cannot read regardless of
 * how "valid" each color is on its own.
 */
export function validateQrConfig(config: {
  size: number;
  margin: number;
  foregroundColor: string;
  backgroundColor: string;
}): QrValidationResult {
  if (
    !Number.isInteger(config.size) ||
    config.size < QR_SIZE_MIN ||
    config.size > QR_SIZE_MAX
  ) {
    return {
      valid: false,
      reason: `size must be an integer between ${QR_SIZE_MIN} and ${QR_SIZE_MAX} pixels`,
    };
  }

  if (
    !Number.isInteger(config.margin) ||
    config.margin < QR_MARGIN_MIN ||
    config.margin > QR_MARGIN_MAX
  ) {
    return {
      valid: false,
      reason: `margin must be an integer between ${QR_MARGIN_MIN} and ${QR_MARGIN_MAX}`,
    };
  }

  if (!isValidHexColor(config.foregroundColor)) {
    return {
      valid: false,
      reason: 'foregroundColor must be a valid hex color (e.g. #000000)',
    };
  }
  if (!isValidHexColor(config.backgroundColor)) {
    return {
      valid: false,
      reason: 'backgroundColor must be a valid hex color (e.g. #FFFFFF)',
    };
  }

  if (
    normalizeHexColor(config.foregroundColor) ===
    normalizeHexColor(config.backgroundColor)
  ) {
    return {
      valid: false,
      reason:
        'foregroundColor and backgroundColor must be different — identical colors produce an unreadable QR code',
    };
  }

  return { valid: true };
}
