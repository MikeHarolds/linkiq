/**
 * ESLint config for Next.js apps. Extends the shared base config
 * plus Next's core-web-vitals rule set.
 */
module.exports = {
  root: true,
  extends: [require.resolve('./base.js'), 'next/core-web-vitals'],
  ignorePatterns: ['next-env.d.ts'],
  rules: {
    'react/jsx-key': 'error',
  },
};
