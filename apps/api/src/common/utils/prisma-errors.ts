import { Prisma } from '@prisma/client';

/**
 * True for a unique-constraint violation on a `create`/`update` — checked
 * instead of a pre-existence lookup so callers can avoid a TOCTOU race
 * under concurrent requests for the same unique value (a link's
 * shortCode, a campaign name, a custom domain, ...).
 *
 * Checks Prisma's own error class and its own error code ('P2002') —
 * confirmed against a real Postgres instance to be what `@prisma/client`
 * actually throws for a unique-constraint violation. Every call site in
 * this codebase previously checked the raw Postgres code ('23505')
 * instead, which a real `PrismaClientKnownRequestError` never carries —
 * that mismatch meant a genuine duplicate-key race in production/e2e
 * fell through to an uncaught 500 instead of the intended 409, in every
 * one of those call sites, and only ever "worked" against the hand-rolled
 * unit-test mocks that had been shaped to match the (incorrect) check.
 * See prisma-errors.spec.ts, which regression-tests this against a real
 * `Prisma.PrismaClientKnownRequestError` instance rather than a plain
 * object with a `code` property.
 */
export function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
