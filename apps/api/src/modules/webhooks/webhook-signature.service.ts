import { createHmac, timingSafeEqual } from 'crypto';

import { Injectable } from '@nestjs/common';

const SIGNATURE_PREFIX = 'sha256=';

/**
 * HMAC-SHA256 request signing for outbound webhook deliveries — Node's
 * built-in `crypto.createHmac`, no invented cryptography. The signed
 * string is `${timestamp}.${rawBody}` (§15/§16 of the Sprint 9 spec):
 * including the timestamp in the signed material is what makes replay
 * protection possible on the receiving end — a receiver that also
 * checks the timestamp is recent cannot be fooled by a captured,
 * otherwise-validly-signed request replayed later. See
 * docs/architecture/webhooks.md and docs/api/webhooks.md for the
 * documented tolerance window recommendation.
 *
 * LinkIQ itself only ever signs (it's the sender) — `verify()` exists as
 * the exact reference implementation documented for developers building
 * a receiver, and is exercised directly by this service's own unit
 * tests to prove sign/verify are consistent.
 */
@Injectable()
export class WebhookSignatureService {
  sign(secret: string, timestamp: number, rawBody: string): string {
    const signedContent = `${timestamp}.${rawBody}`;
    const digest = createHmac('sha256', secret)
      .update(signedContent)
      .digest('hex');
    return `${SIGNATURE_PREFIX}${digest}`;
  }

  /** Constant-time comparison — never a plain `===` on secret-derived
   * material, even though LinkIQ itself never calls this in production. */
  verify(
    secret: string,
    timestamp: number,
    rawBody: string,
    signature: string,
  ): boolean {
    const expected = this.sign(secret, timestamp, rawBody);
    const expectedBuf = Buffer.from(expected);
    const actualBuf = Buffer.from(signature);
    if (expectedBuf.length !== actualBuf.length) {
      return false;
    }
    return timingSafeEqual(expectedBuf, actualBuf);
  }
}
