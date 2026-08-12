import { Prisma } from '@prisma/client';

import { isUniqueConstraintViolation } from './prisma-errors';

/** Mirrors exactly what @prisma/client throws for a unique-constraint
 * violation — constructed the same way Prisma constructs it internally,
 * not a hand-shaped plain object, so this test would have caught the
 * real ('23505' vs 'P2002') bug this helper was written to fix. */
function makeUniqueConstraintError(target: string[] = ['email']) {
  return new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`' + target.join(',') + '`)',
    { code: 'P2002', clientVersion: '5.22.0', meta: { target } },
  );
}

function makePrismaErrorWithCode(code: string) {
  return new Prisma.PrismaClientKnownRequestError('Some other Prisma error', {
    code,
    clientVersion: '5.22.0',
  });
}

describe('isUniqueConstraintViolation', () => {
  it('returns true for a real Prisma unique-constraint violation (P2002)', () => {
    expect(isUniqueConstraintViolation(makeUniqueConstraintError())).toBe(
      true,
    );
  });

  it('returns false for a different real Prisma error code', () => {
    // P2025 = "record not found" — a different, unrelated Prisma error.
    expect(isUniqueConstraintViolation(makePrismaErrorWithCode('P2025'))).toBe(
      false,
    );
  });

  it('returns false for the raw Postgres unique_violation code alone (23505) — never actually thrown by @prisma/client', () => {
    expect(
      isUniqueConstraintViolation(
        Object.assign(new Error('duplicate key'), { code: '23505' }),
      ),
    ).toBe(false);
  });

  it('returns false for a plain object shaped like an error but not a real PrismaClientKnownRequestError', () => {
    expect(isUniqueConstraintViolation({ code: 'P2002' })).toBe(false);
  });

  it('returns false for a generic Error', () => {
    expect(isUniqueConstraintViolation(new Error('boom'))).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isUniqueConstraintViolation(null)).toBe(false);
    expect(isUniqueConstraintViolation(undefined)).toBe(false);
  });
});
