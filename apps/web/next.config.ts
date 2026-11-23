import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // packages/shared থেকে সরাসরি TS import হয় — Next-কে transpile করতে বলতে হবে
  transpilePackages: ['@shop/shared'],
  reactStrictMode: true,
};

export default nextConfig;
