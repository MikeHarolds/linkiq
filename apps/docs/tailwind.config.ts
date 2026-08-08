import baseConfig from '@linkiq/config/tailwind/base';
import type { Config } from 'tailwindcss';

const config: Config = {
  ...baseConfig,
  content: ['./src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
};

export default config;
