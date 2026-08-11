/**
 * Shared base ESLint config for all LinkIQ packages/apps.
 * Extended by app-specific configs (nextjs.js, nestjs.js).
 *
 * Deliberately does NOT register eslint-plugin-import itself anymore —
 * see import-rules.js for why, and extend that fragment explicitly in
 * any config that needs it and doesn't already get it from elsewhere
 * (e.g. nestjs.js does; nextjs.js does not, since next/core-web-vitals
 * already provides it).
 */
module.exports = {
  root: false,
  env: {
    es2022: true,
    node: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier',
  ],
  rules: {
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/consistent-type-imports': [
      'warn',
      { prefer: 'type-imports' },
    ],
    'no-console': ['warn', { allow: ['warn', 'error'] }],
  },
  ignorePatterns: [
    'dist',
    'build',
    '.next',
    'node_modules',
    'coverage',
    '*.config.js',
  ],
};
