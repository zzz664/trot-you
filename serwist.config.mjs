import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { serwist } from '@serwist/next/config';
import { PWA } from './src/config/pwa.ts';

const config = await serwist({
  swSrc: 'src/worker/sw.ts',
  swDest: 'public/sw.js',
  precachePrerendered: false,
  // Explicit allowlist: no public glob, HTML, RSC, manifests, source maps,
  // uploaded images, signed media, APIs, auth pages or Next prerender output.
  globPatterns: ['.next/static/**/*.js', '.next/static/**/*.css'],
  esbuildOptions: { sourcemap: false, minify: true },
});
const offlineBytes = await readFile(`public${PWA.offlineUrl}`);
const offlineRevision = createHash('sha256').update(offlineBytes).digest('hex');
config.manifestTransforms.push((entries) => {
  if (
    !entries.length ||
    entries.some((entry) => !PWA.staticAssetPattern.test(entry.url))
  ) {
    throw new Error('PWA precache contains a non-public build asset');
  }
  return {
    manifest: [
      ...entries,
      {
        url: PWA.offlineUrl,
        revision: offlineRevision,
        size: offlineBytes.length,
      },
    ],
    warnings: [],
  };
});
export default config;
