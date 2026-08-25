import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12; // GCM-recommended nonce size

/**
 * Encrypts/decrypts email-provider secrets (Resend API key, SMTP
 * password) at rest. Byte-for-byte the same shape as
 * WebhookSecretCipherService (see modules/webhooks/security/
 * webhook-secret-cipher.service.ts) — a secret here must be *used*
 * repeatedly by LinkIQ itself to authenticate outbound sends, so a
 * one-way hash cannot substitute for real encryption. Its own,
 * independent env-derived key (EMAIL_SECRET_ENCRYPTION_KEY) — never
 * shared with the webhook cipher's key, so rotating one never affects
 * the other.
 */
@Injectable()
export class EmailSecretCipherService {
  constructor(private readonly config: ConfigService) {}

  private deriveKey(): Buffer {
    const configured = this.config.get<string>('email.secretEncryptionKey')!;
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
      throw new Error('Malformed email secret ciphertext');
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

  /** Non-secret display prefix (e.g. "re_ab12cd34") — safe to show in
   * the admin UI, mirrors WebhookEndpoint.secretPrefix's convention. */
  static derivePrefix(secret: string): string {
    return secret.length <= 8 ? secret : `${secret.slice(0, 8)}…`;
  }
}
