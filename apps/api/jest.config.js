/**
 * Unit test config. Targets *.spec.ts colocated with source under src/.
 * Unit tests mock PrismaService (see test/mocks/prisma.mock.ts) so they
 * exercise real business logic (hashing, validation, RBAC hierarchy,
 * enumeration-prevention behavior) without a live database.
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      { tsconfig: '<rootDir>/../tsconfig.spec.json' },
    ],
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coveragePathIgnorePatterns: ['\\.module\\.ts$', 'main\\.ts$'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
};
