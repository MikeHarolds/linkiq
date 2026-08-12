import { Prisma } from '@prisma/client';

/**
 * Builds a real `Prisma.PrismaClientKnownRequestError` shaped exactly like
 * what `@prisma/client` throws for a unique-constraint violation (code
 * 'P2002') — used across service specs instead of a hand-shaped plain
 * object with a `code` property, so these tests exercise the same
 * `instanceof`/code check `isUniqueConstraintViolation` (see
 * src/common/utils/prisma-errors.ts) actually performs in production.
 */
export function makeUniqueConstraintError(
  target: string[] = ['id'],
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    `Unique constraint failed on the fields: (\`${target.join(',')}\`)`,
    { code: 'P2002', clientVersion: '5.22.0', meta: { target } },
  );
}
