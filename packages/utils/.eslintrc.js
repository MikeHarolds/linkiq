module.exports = {
  extends: [require.resolve('@linkiq/config/eslint/base')],
  parserOptions: {
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
  },
};
