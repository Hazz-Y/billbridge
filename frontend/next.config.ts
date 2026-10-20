import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Static export for Netlify: this app has no API routes, no dynamic segments, no next/headers —
  // every page is a client component fetching the backend directly, so a plain static site works.
  // Set STATIC_EXPORT=1 only for that build; `next dev` / `next start` (used by `make demo`) stay SSR.
  ...(process.env['STATIC_EXPORT'] === '1' ? { output: 'export' as const, images: { unoptimized: true } } : {}),
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
