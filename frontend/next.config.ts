import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@billbridge/shared'],
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  // @billbridge/shared uses NodeNext-style `./x.js` specifiers for `.ts` sources.
  webpack: (config) => {
    config.resolve.extensionAlias = { ...(config.resolve.extensionAlias ?? {}), '.js': ['.ts', '.tsx', '.js'] };
    return config;
  },
  turbopack: { resolveExtensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'] },
};

export default nextConfig;
