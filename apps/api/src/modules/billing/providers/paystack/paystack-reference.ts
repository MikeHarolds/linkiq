import { generateOpaqueToken } from '../../../../common/utils/token';

/**
 * Generates a unique transaction reference for Paystack's
 * `transaction/initialize` call. Paystack requires references to be
 * unique and restricts the charset to alphanumeric plus `-`, `.`, `=`
 * only — notably NOT `_`. `generateOpaqueToken()` (used elsewhere for
 * refresh/reset tokens) already emits pure hex
 * (`randomBytes(32).toString('hex')` — alphanumeric only), so it's safe
 * to reuse directly; only the prefix needs to avoid underscore, unlike
 * this codebase's other `whsec_`/`lk_live_`/`evt_` prefixes.
 */
export function generatePaystackReference(): string {
  return `txn-${generateOpaqueToken()}`;
}
