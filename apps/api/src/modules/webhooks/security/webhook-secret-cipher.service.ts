import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12; // GCM-recommended nonce size

/**
 * Encrypts/decrypts webhook signing secrets at rest.
 *
 * This is deliberately NOT a hash. An API key only ever needs to be
 * *verified* against a caller-supplied value (hash-and-compare), but a
 * webhook secret must be *used* by LinkIQ itself — repeatedly, forever —
 * to HMAC-sign every future delivery (see WebhookSignatureService). A
 * one-way hash cannot support that, so the secret is stored as
 * AES-256-GCM ciphertext instead, decryptable only with a server-held
 * key (WEBHOOK_SECRET_ENCRYPTION_KEY) that never leaves the API process.
 *
 * The key is derived via SHA-256 from the configured env value so any
 * string length is accepted and reduced to exactly 32 bytes (AES-256's
 * required key size) — the same "arbitrary env string -> fixed-size
 * cryptographic material" shape VISITOR_HASH_SALT already uses elsewhere
 * in this codebase, just for encryption instead of hashing.
 */
@Injectable()
export class WebhookSecretCipherService {
  constructor(private readonly config: ConfigService) {}

  private deriveKey(): Buffer {
    const configured = this.config.get<string>('webhooks.secretEncryptionKey')!;
    return createHash('sha256').update(configured).digest();
  }

  /** Returns `${iv}:${authTag}:${ciphertext}`, each hex-encoded. */
  encrypt(plaintext: string): string {
    const key = this.deriveKey();
    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return [iv, authTag, ciphertext].map((b) => b.toString('hex')).join(':');
  }

  decrypt(stored: string): string {
    const [ivHex, authTagHex, ciphertextHex] = stored.split(':');
    if (!ivHex || !authTagHex || !ciphertextHex) {
      throw new Error('Malformed webhook secret ciphertext');
    }
    const key = this.deriveKey();
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextHex, 'hex')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }
}
