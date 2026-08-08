module.exports = {
  extends: [require.resolve('@linkiq/config/eslint/nestjs')],
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
};
