/**
 * Shared base ESLint config for all LinkIQ packages/apps.
 * Extended by app-specific configs (nextjs.js, nestjs.js).
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
  plugins: ['@typescript-eslint', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'prettier',
  ],
  settings: {
    'import/resolver': {
      typescript: {
        alwaysTryTypes: true,
      },
    },
  },
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
    'import/order': [
      'warn',
      {
        groups: [
          'builtin',
          'external',
          'internal',
          'parent',
          'sibling',
          'index',
        ],
        'newlines-between': 'always',
        alphabetize: { order: 'asc', caseInsensitive: true },
      },
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
