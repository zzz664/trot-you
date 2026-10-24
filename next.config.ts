import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const config: NextConfig = {
  poweredByHeader: false,
  // Preserve Node package-relative WASM loading; include the local parser binary.
  serverExternalPackages: ['mediainfo.js'],
  outputFileTracingIncludes: {
    '/api/media/*': ['./node_modules/mediainfo.js/dist/MediaInfoModule.wasm'],
  },
  // Keep development-only tooling from obscuring actual UI/CI screenshots.
  devIndicators: false,
  reactStrictMode: true,
  // Authorization callbacks contain single-use provider query tokens. Never
  // print incoming URLs, server arguments or browser logs in development/CI.
  logging: false,
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
          { key: 'Service-Worker-Allowed', value: '/' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          {
            key: 'Content-Security-Policy',
            value: "default-src 'none'; script-src 'self'; connect-src 'self'",
          },
        ],
      },
      {
        source: '/offline.html',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
          {
            key: 'Content-Security-Policy',
            value:
              "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ];
  },
};

export default createNextIntlPlugin()(config);
