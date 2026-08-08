/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // Workspace packages ship TypeScript source directly (no build step),
  // so Next must transpile them itself.
  transpilePackages: ['@linkiq/ui', '@linkiq/utils', '@linkiq/types'],
};

module.exports = nextConfig;
