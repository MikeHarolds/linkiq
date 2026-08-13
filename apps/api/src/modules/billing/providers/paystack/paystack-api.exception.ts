/**
 * Thrown by PaystackApiClient for any non-successful outcome: a
 * network error/timeout (status null), a non-2xx HTTP response, or a
 * 2xx response whose envelope itself reports `status: false` (Paystack
 * uses the HTTP status for transport-level problems and this envelope
 * field for business-level ones — both surface here so callers only
 * need to handle one exception type).
 */
export class PaystackApiException extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'PaystackApiException';
  }
}
