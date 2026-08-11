/**
 * ESLint config for NestJS apps. Extends the shared base config
 * with rules tuned for Nest's decorator-heavy, DI-driven style.
 *
 * Explicitly extends import-rules.js (see that file's comment): apps/api
 * has no other source for eslint-plugin-import the way Next.js apps do
 * via next/core-web-vitals, so it needs the fragment added back
 * directly to keep the exact same import/* linting it always had.
 */
module.exports = {
  root: true,
  extends: [require.resolve('./base.js'), require.resolve('./import-rules.js')],
  parserOptions: {
    project: 'tsconfig.json',
    sourceType: 'module',
  },
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
  },
};
