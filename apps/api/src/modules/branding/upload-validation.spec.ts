import { BadRequestException } from '@nestjs/common';

import {
  detectImageMimeType,
  MAX_FAVICON_BYTES,
  MAX_LOGO_BYTES,
  validateUploadedImage,
  type UploadedFileLike,
} from './upload-validation';

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const WEBP_HEADER = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from('WEBP', 'ascii'),
]);
const ICO_HEADER = Buffer.from([0x00, 0x00, 0x01, 0x00, 0, 0, 0, 0]);

function makeFile(overrides: Partial<UploadedFileLike> = {}): UploadedFileLike {
  return {
    buffer: PNG_HEADER,
    originalname: 'logo.png',
    mimetype: 'image/png',
    size: PNG_HEADER.length,
    ...overrides,
  };
}

describe('detectImageMimeType', () => {
  it('recognizes a PNG by magic bytes', () => {
    expect(detectImageMimeType(PNG_HEADER)).toBe('image/png');
  });

  it('recognizes a JPEG by magic bytes', () => {
    expect(detectImageMimeType(JPEG_HEADER)).toBe('image/jpeg');
  });

  it('recognizes a WEBP by its RIFF/WEBP container markers', () => {
    expect(detectImageMimeType(WEBP_HEADER)).toBe('image/webp');
  });

  it('recognizes an ICO by magic bytes', () => {
    expect(detectImageMimeType(ICO_HEADER)).toBe('image/x-icon');
  });

  it('recognizes an SVG by its leading XML/svg tag', () => {
    expect(detectImageMimeType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe('image/svg+xml');
  });

  it('returns null for a renamed executable pretending to be an image', () => {
    // MZ header — the actual magic bytes of a Windows PE executable,
    // regardless of what extension/mimetype the client claims.
    const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    expect(detectImageMimeType(exe)).toBeNull();
  });

  it('returns null for arbitrary text content', () => {
    expect(detectImageMimeType(Buffer.from('just some plain text'))).toBeNull();
  });
});

describe('validateUploadedImage', () => {
  it('accepts a valid PNG within the size limit', () => {
    expect(() => validateUploadedImage(makeFile(), MAX_LOGO_BYTES)).not.toThrow();
  });

  it('rejects an empty upload', () => {
    expect(() => validateUploadedImage(makeFile({ size: 0 }), MAX_LOGO_BYTES)).toThrow(BadRequestException);
  });

  it('rejects a file exceeding the byte limit', () => {
    expect(() => validateUploadedImage(makeFile({ size: MAX_FAVICON_BYTES + 1 }), MAX_FAVICON_BYTES)).toThrow(
      BadRequestException,
    );
  });

  it('rejects a disallowed file extension even with a valid-looking image mimetype claim', () => {
    expect(() =>
      validateUploadedImage(makeFile({ originalname: 'logo.exe', mimetype: 'image/png' }), MAX_LOGO_BYTES),
    ).toThrow(BadRequestException);
  });

  it('rejects a file whose extension is allowed but whose bytes are not actually an image (renamed executable)', () => {
    const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    expect(() =>
      validateUploadedImage(makeFile({ originalname: 'logo.png', buffer: exe, size: exe.length }), MAX_LOGO_BYTES),
    ).toThrow(BadRequestException);
  });

  it('rejects an SVG containing a <script> tag', () => {
    const malicious = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(() =>
      validateUploadedImage(
        makeFile({ originalname: 'logo.svg', buffer: malicious, size: malicious.length }),
        MAX_LOGO_BYTES,
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects an SVG containing an inline event-handler attribute', () => {
    const malicious = Buffer.from('<svg onload="alert(1)" xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(() =>
      validateUploadedImage(
        makeFile({ originalname: 'logo.svg', buffer: malicious, size: malicious.length }),
        MAX_LOGO_BYTES,
      ),
    ).toThrow(BadRequestException);
  });

  it('accepts a clean SVG with no script content', () => {
    const clean = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>');
    expect(() =>
      validateUploadedImage(makeFile({ originalname: 'logo.svg', buffer: clean, size: clean.length }), MAX_LOGO_BYTES),
    ).not.toThrow();
  });
});
