import {
  isValidHexColor,
  normalizeHexColor,
  QR_MARGIN_MAX,
  QR_MARGIN_MIN,
  QR_SIZE_MAX,
  QR_SIZE_MIN,
  validateQrConfig,
} from './qr-validation';

describe('isValidHexColor', () => {
  it('accepts 6-digit hex colors', () => {
    expect(isValidHexColor('#000000')).toBe(true);
    expect(isValidHexColor('#FFFFFF')).toBe(true);
    expect(isValidHexColor('#a1b2c3')).toBe(true);
  });

  it('accepts 3-digit hex colors', () => {
    expect(isValidHexColor('#fff')).toBe(true);
    expect(isValidHexColor('#000')).toBe(true);
  });

  it('rejects malformed colors', () => {
    expect(isValidHexColor('not-a-color')).toBe(false);
    expect(isValidHexColor('#gggggg')).toBe(false);
    expect(isValidHexColor('#12345')).toBe(false);
    expect(isValidHexColor('000000')).toBe(false); // missing #
    expect(isValidHexColor('#1234567')).toBe(false);
    expect(isValidHexColor('')).toBe(false);
  });

  it('rejects non-color injection attempts', () => {
    expect(isValidHexColor('red; DROP TABLE qr_codes;')).toBe(false);
    expect(isValidHexColor('<script>alert(1)</script>')).toBe(false);
    expect(isValidHexColor('rgb(0,0,0)')).toBe(false);
  });
});

describe('normalizeHexColor', () => {
  it('expands a 3-digit hex to 6 digits', () => {
    expect(normalizeHexColor('#0f0')).toBe('#00ff00');
    expect(normalizeHexColor('#abc')).toBe('#aabbcc');
  });

  it('lowercases a 6-digit hex', () => {
    expect(normalizeHexColor('#ABCDEF')).toBe('#abcdef');
  });
});

describe('validateQrConfig', () => {
  const base = {
    size: 512,
    margin: 4,
    foregroundColor: '#000000',
    backgroundColor: '#FFFFFF',
  };

  it('accepts a valid default-shaped config', () => {
    expect(validateQrConfig(base)).toEqual({ valid: true });
  });

  it('rejects size below the minimum', () => {
    const result = validateQrConfig({ ...base, size: QR_SIZE_MIN - 1 });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/size/i);
  });

  it('rejects size above the maximum (prevents resource-exhaustion via huge images)', () => {
    const result = validateQrConfig({ ...base, size: QR_SIZE_MAX + 1 });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/size/i);
  });

  it('rejects a non-integer size', () => {
    expect(validateQrConfig({ ...base, size: 512.5 }).valid).toBe(false);
  });

  it('rejects margin outside bounds', () => {
    expect(validateQrConfig({ ...base, margin: QR_MARGIN_MIN - 1 }).valid).toBe(
      false,
    );
    expect(validateQrConfig({ ...base, margin: QR_MARGIN_MAX + 1 }).valid).toBe(
      false,
    );
  });

  it('rejects an invalid foreground color', () => {
    const result = validateQrConfig({
      ...base,
      foregroundColor: 'not-a-color',
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/foregroundColor/);
  });

  it('rejects an invalid background color', () => {
    const result = validateQrConfig({
      ...base,
      backgroundColor: 'not-a-color',
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/backgroundColor/);
  });

  it('rejects identical foreground/background colors — the case no single-field check catches', () => {
    const result = validateQrConfig({
      ...base,
      foregroundColor: '#123456',
      backgroundColor: '#123456',
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/different/i);
  });

  it('rejects colors that are identical only after case/shorthand normalization', () => {
    const result = validateQrConfig({
      ...base,
      foregroundColor: '#ABC',
      backgroundColor: '#aabbcc',
    });
    expect(result.valid).toBe(false);
  });

  it('accepts boundary values (min and max) as valid', () => {
    expect(validateQrConfig({ ...base, size: QR_SIZE_MIN }).valid).toBe(true);
    expect(validateQrConfig({ ...base, size: QR_SIZE_MAX }).valid).toBe(true);
    expect(validateQrConfig({ ...base, margin: QR_MARGIN_MIN }).valid).toBe(
      true,
    );
    expect(validateQrConfig({ ...base, margin: QR_MARGIN_MAX }).valid).toBe(
      true,
    );
  });
});
