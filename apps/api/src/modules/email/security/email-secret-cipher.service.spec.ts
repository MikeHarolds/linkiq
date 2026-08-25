import type { ConfigService } from '@nestjs/config';

import { EmailSecretCipherService } from './email-secret-cipher.service';

function makeService(key = 'test-encryption-key'): EmailSecretCipherService {
  const config = {
    get: jest.fn().mockReturnValue(key),
  } as unknown as ConfigService;
  return new EmailSecretCipherService(config);
}

describe('EmailSecretCipherService', () => {
  it('round-trips plaintext through encrypt/decrypt', () => {
    const cipher = makeService();
    const ciphertext = cipher.encrypt('re_super_secret_key');
    expect(cipher.decrypt(ciphertext)).toBe('re_super_secret_key');
  });

  it('produces a different ciphertext on every call (random IV)', () => {
    const cipher = makeService();
    const a = cipher.encrypt('same-plaintext');
    const b = cipher.encrypt('same-plaintext');
    expect(a).not.toBe(b);
  });

  it('fails to decrypt with the wrong key', () => {
    const encrypted = makeService('key-a').encrypt('secret');
    expect(() => makeService('key-b').decrypt(encrypted)).toThrow();
  });

  it('rejects tampered ciphertext (auth tag mismatch)', () => {
    const cipher = makeService();
    const [iv, authTag, ciphertext] = cipher.encrypt('secret').split(':');
    const tampered = [iv, authTag, `${ciphertext!.slice(0, -2)}ff`].join(':');
    expect(() => cipher.decrypt(tampered)).toThrow();
  });

  it('rejects malformed stored values', () => {
    const cipher = makeService();
    expect(() => cipher.decrypt('not-a-valid-ciphertext')).toThrow(
      'Malformed email secret ciphertext',
    );
  });

  describe('derivePrefix', () => {
    it('truncates long secrets to a safe display prefix', () => {
      expect(EmailSecretCipherService.derivePrefix('re_1234567890abcdef')).toBe(
        're_12345…',
      );
    });

    it('returns short secrets unchanged', () => {
      expect(EmailSecretCipherService.derivePrefix('short')).toBe('short');
    });
  });
});
