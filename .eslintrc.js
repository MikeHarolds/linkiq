/**
 * Root fallback ESLint config. Every app and package has its own
 * .eslintrc.js extending @linkiq/config/eslint/*, which takes precedence.
 * This root config only applies to files that don't live inside one of
 * those workspaces (root-level config files, shared config source, etc.).
 */
module.exports = {
  root: true,
  extends: [
    require.resolve('@linkiq/config/eslint/base'),
    require.resolve('@linkiq/config/eslint/import-rules'),
  ],
  env: {
    node: true,
  },
  overrides: [
    {
      files: ['*.js'],
      parserOptions: {
        project: null,
      },
    },
  ],
  ignorePatterns: [
    'apps/*/next-env.d.ts',
    '**/dist/**',
    '**/.next/**',
    '**/coverage/**',
  ],
};
