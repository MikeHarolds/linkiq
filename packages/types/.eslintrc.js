module.exports = {
  extends: [
    require.resolve('@linkiq/config/eslint/base'),
    require.resolve('@linkiq/config/eslint/import-rules'),
  ],
  parserOptions: {
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
  },
};
