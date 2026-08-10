/**
 * Minimal, hand-rolled deep mock of PrismaService for unit tests. Only
 * mocks the model methods actually exercised by the services under test —
 * extend as new models/methods are needed rather than trying to mock the
 * entire Prisma surface up front.
 */
export function createMockPrismaService() {
  return {
    user: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    organization: {
      create: jest.fn(),
    },
    workspace: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    workspaceMember: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    refreshToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    passwordResetToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    link: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    clickEvent: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    linkDailyStat: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    qrCode: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    $queryRawUnsafe: jest.fn(),
    $queryRaw: jest.fn(),
    // Executes the callback with `this` (the mock itself) standing in for
    // the transactional client — sufficient for unit tests since none of
    // our transaction callbacks rely on genuine isolation semantics.
    $transaction: jest.fn(async function (this: unknown, arg: unknown) {
      if (Array.isArray(arg)) {
        return Promise.all(arg);
      }
      if (typeof arg === 'function') {
        return arg(this);
      }
      return arg;
    }),
  };
}

export type MockPrismaService = ReturnType<typeof createMockPrismaService>;
