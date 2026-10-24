/** Public-only PWA resources. Never add application documents or API paths here. */
export const PWA = {
  workerUrl: '/sw.js',
  scope: '/',
  offlineUrl: '/offline.html',
  manifestUrl: '/manifest.webmanifest',
  icon192: '/icons/trot-you-192.png',
  icon512: '/icons/trot-you-512.png',
  appleIcon: '/icons/trot-you-180.png',
  cachePrefix: 'trot-you-public-',
  cacheName: 'trot-you-public-v1',
  staticPrefix: '/_next/static/',
  apiPrefix: '/api/',
  nextPrefix: '/_next/',
  successStatus: 200,
  staticAssetPattern:
    /^\/_next\/static\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:js|css)$/,
  privateRequestHeaders: [
    'authorization',
    'rsc',
    'next-router-state-tree',
    'next-router-prefetch',
    'next-action',
    'range',
  ],
} as const;
