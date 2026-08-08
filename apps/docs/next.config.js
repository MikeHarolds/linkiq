/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  transpilePackages: ['@linkiq/ui', '@linkiq/utils'],
};

module.exports = nextConfig;
