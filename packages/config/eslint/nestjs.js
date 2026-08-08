/**
 * ESLint config for NestJS apps. Extends the shared base config
 * with rules tuned for Nest's decorator-heavy, DI-driven style.
 */
module.exports = {
  root: true,
  extends: [require.resolve('./base.js')],
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
