/**
 * ESLint config for Next.js apps. Extends the shared base config
 * plus Next's core-web-vitals rule set.
 *
 * Deliberately does NOT extend import-rules.js (see that file's
 * comment for the full explanation): next/core-web-vitals already
 * registers eslint-plugin-import itself, so also extending our own
 * fragment here would register the same plugin twice, from two
 * different resolution paths — the exact cause of ESLint's "couldn't
 * determine the plugin 'import' uniquely" error on Windows. The
 * `import/order` rule below still works with no separate registration:
 * by the time this file's own `rules` block is evaluated, the "import"
 * plugin is already available (from next/core-web-vitals), so naming
 * one of its rules here doesn't need — and must not have — a second
 * `plugins`/`extends` declaration alongside it.
 */
module.exports = {
  root: true,
  extends: [require.resolve('./base.js'), 'next/core-web-vitals'],
  ignorePatterns: ['next-env.d.ts'],
  rules: {
    'react/jsx-key': 'error',
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
  },
};
