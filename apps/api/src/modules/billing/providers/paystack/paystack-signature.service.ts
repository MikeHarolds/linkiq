import { createHmac, timingSafeEqual } from 'crypto';

import { Injectable } from '@nestjs/common';

/**
 * Verifies the `x-paystack-signature` header on inbound webhooks.
 * Paystack signs with HMAC-SHA512 over the raw JSON request body, hex
 * digest, keyed with the account's own secret key — there is no
 * separate webhook-signing secret the way Stripe or LinkIQ's own
 * outbound webhooks (Sprint 9's WebhookSignatureService) have.
 *
 * Deliberately verifies against the TRUE RAW request bytes, not a
 * `JSON.stringify(parsedBody)` re-serialization the way Paystack's own
 * simplified Node.js example does — re-stringifying a parsed object is
 * not guaranteed byte-identical to what was actually sent (key
 * ordering, whitespace, unicode escaping can all differ), which would
 * make a legitimate webhook fail verification. Callers MUST pass the
 * exact bytes the request arrived with (see main.ts's `rawBody: true`
 * and the Paystack webhook controller, which reads `req.rawBody`).
 */
@Injectable()
export class PaystackSignatureService {
  verify(
    secretKey: string,
    rawBody: Buffer | string,
    signature: string | undefined,
  ): boolean {
    if (!signature) {
      return false;
    }

    const expected = createHmac('sha512', secretKey)
      .update(rawBody)
      .digest('hex');
    const expectedBuf = Buffer.from(expected, 'utf8');
    const actualBuf = Buffer.from(signature, 'utf8');

    if (expectedBuf.length !== actualBuf.length) {
      return false;
    }
    return timingSafeEqual(expectedBuf, actualBuf);
  }
}
