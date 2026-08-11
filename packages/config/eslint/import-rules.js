/**
 * eslint-plugin-import registration + rules, factored out of base.js.
 *
 * Why this exists as its own file (Windows plugin-resolution fix):
 *
 * `eslint-config-next` (via `next/core-web-vitals`) already depends on
 * and registers `eslint-plugin-import` itself, internally. Our own
 * `nextjs.js` config used to ALSO extend `plugin:import/recommended`
 * directly through `base.js` — meaning the "import" plugin name ended
 * up registered by two independent resolution paths within the same
 * effective config: one starting from this config package's own
 * directory, one starting from inside `eslint-config-next`'s directory.
 *
 * In an npm workspace, both paths resolve to the exact same physical
 * `eslint-plugin-import` install (there is only one — see `npm ls
 * eslint-plugin-import`). On Windows, Node's module resolution can
 * return two path strings that differ only in casing (e.g.
 * `C:\LinkIQ\node_modules\...` vs `C:\linkiq\node_modules\...`) for
 * that identical file, because the OS is case-preserving but
 * case-insensitive, while ESLint's own plugin-uniqueness check (in
 * `@eslint/eslintrc`) compares the two resolved path strings literally,
 * with no case-normalization. Two differently-cased strings pointing at
 * the same file are treated as two different plugin instances, which
 * is exactly the "couldn't determine the plugin 'import' uniquely"
 * error — it is a real ambiguity from ESLint's point of view even
 * though there is genuinely only one package on disk.
 *
 * The fix is structural, not a workaround: stop registering the
 * "import" plugin twice in the first place. `nextjs.js` now relies
 * solely on the copy `next/core-web-vitals` already provides (see that
 * file's own `rules` block for how `import/order` is preserved without
 * re-extending this fragment). Every OTHER consumer — apps/api
 * (nestjs.js), the shared packages, and the repo-root fallback config —
 * has no second source for this plugin, so they explicitly extend this
 * fragment and get the exact same plugin + rules they always had.
 */
module.exports = {
  plugins: ['import'],
  extends: ['plugin:import/recommended', 'plugin:import/typescript'],
  settings: {
    'import/resolver': {
      typescript: {
        alwaysTryTypes: true,
      },
    },
  },
  rules: {
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
