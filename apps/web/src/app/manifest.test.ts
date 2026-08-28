import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import manifest from './manifest';

describe('PWA web app manifest', () => {
  const result = manifest();

  it('has the required identity fields', () => {
    expect(result.name).toBe('LinkIQ');
    expect(result.short_name).toBe('LinkIQ');
    expect(result.description).toBe('Turn every link into a growth engine.');
  });

  it('is configured for an installable, portrait, root-scoped app', () => {
    expect(result.display).toBe('standalone');
    expect(result.orientation).toBe('portrait-primary');
    expect(result.start_url).toBe('/');
    expect(result.scope).toBe('/');
  });

  it('uses the LinkIQ brand color and a defined background color', () => {
    expect(result.theme_color).toBe('#F97316');
    expect(result.background_color).toBe('#FFFFFF');
  });

  it('declares no secret values anywhere in the manifest', () => {
    const serialized = JSON.stringify(result).toLowerCase();
    for (const forbidden of ['key', 'secret', 'token', 'password']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  describe('icons', () => {
    it('provides at least the required 192x192 and 512x512 sizes', () => {
      const sizes = (result.icons ?? []).map((icon) => icon.sizes);
      expect(sizes).toContain('192x192');
      expect(sizes).toContain('512x512');
    });

    it('includes a maskable variant for Android adaptive icons', () => {
      const maskable = (result.icons ?? []).find(
        (icon) => icon.purpose === 'maskable',
      );
      expect(maskable).toBeDefined();
      expect(maskable?.sizes).toBe('512x512');
    });

    it('every declared icon file actually exists in public/ with matching PNG dimensions', () => {
      for (const icon of result.icons ?? []) {
        const src = icon.src as string;
        const filePath = join(__dirname, '../../public', src);
        const buffer = readFileSync(filePath);

        // PNG signature, then IHDR chunk: width/height are the first 8
        // bytes of IHDR's data, at fixed offsets 16-23 regardless of
        // file size — no image library needed to check this.
        expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
        const width = buffer.readUInt32BE(16);
        const height = buffer.readUInt32BE(20);
        const [expectedW, expectedH] = (icon.sizes as string)
          .split('x')
          .map(Number);
        expect(width).toBe(expectedW);
        expect(height).toBe(expectedH);
      }
    });
  });
});
