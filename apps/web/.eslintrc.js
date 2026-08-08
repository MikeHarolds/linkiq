const path = require('path');

module.exports = {
  extends: [require.resolve('@linkiq/config/eslint/nextjs')],
  parserOptions: {
    tsconfigRootDir: __dirname,
  },
  settings: {
    'import/resolver': {
      typescript: {
        project: path.join(__dirname, 'tsconfig.json'),
      },
    },
  },
};
