import { BadRequestException } from '@nestjs/common';

/** Duck-typed subset of Express.Multer.File — deliberately not
 * depending on @types/multer (not an existing project dependency) for
 * the handful of fields this module actually reads. */
export interface UploadedFileLike {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

export const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2MB
export const MAX_FAVICON_BYTES = 512 * 1024; // 512KB

const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico']);

/**
 * Sniffs the actual file bytes rather than trusting the client-supplied
 * `mimetype`/filename extension (both fully spoofable by whoever sends
 * the multipart request) — this is the real security boundary that
 * rejects a renamed executable or any other non-image upload. Returns
 * null for anything it doesn't recognize as one of the supported
 * formats.
 */
export function detectImageMimeType(buffer: Buffer): string | null {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (buffer.length >= 4 && buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 && buffer[3] === 0x00) {
    return 'image/x-icon';
  }
  // SVG is text, not binary magic bytes — sniff the leading characters
  // instead, after trimming any BOM/whitespace.
  const head = buffer.toString('utf8', 0, Math.min(buffer.length, 512)).trimStart();
  if (head.startsWith('<?xml') || head.startsWith('<svg')) {
    return 'image/svg+xml';
  }
  return null;
}

/** SVGs are XML, which means they can carry <script> tags or
 * event-handler attributes that execute when the file is rendered
 * inline or navigated to directly — a real, well-known XSS vector for
 * "just an image upload" features. Reject any SVG containing either. */
function containsSvgScriptRisk(buffer: Buffer): boolean {
  const text = buffer.toString('utf8').toLowerCase();
  return text.includes('<script') || /\son\w+\s*=/.test(text);
}

export function validateUploadedImage(file: UploadedFileLike, maxBytes: number): void {
  if (!file || file.size === 0) {
    throw new BadRequestException('No file was uploaded');
  }
  if (file.size > maxBytes) {
    throw new BadRequestException(`File is too large — maximum ${Math.floor(maxBytes / 1024)}KB`);
  }

  const ext = file.originalname.slice(file.originalname.lastIndexOf('.')).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new BadRequestException('Unsupported file type — use PNG, JPEG, WEBP, SVG, or ICO');
  }

  const detected = detectImageMimeType(file.buffer);
  if (!detected) {
    throw new BadRequestException('The file does not appear to be a valid image');
  }

  if (detected === 'image/svg+xml' && containsSvgScriptRisk(file.buffer)) {
    throw new BadRequestException('SVG files with embedded scripts are not allowed');
  }
}
