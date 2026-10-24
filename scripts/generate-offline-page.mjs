import { readFile, writeFile } from 'node:fs/promises';
import { designTokens } from '../src/config/design-tokens.ts';
import { PWA } from '../src/config/pwa.ts';

const messages = JSON.parse(await readFile('src/messages/ko.json', 'utf8'));
const copy = messages.pwaOffline;
const escape = (value) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const tokens = Object.entries({
  ...designTokens.base,
  ...designTokens.scales.xlarge,
})
  .map(([name, value]) => `${name}:${value}`)
  .join(';');
// The only cached HTML is this generated, unpersonalized, script-free document.
await writeFile(
  `public${PWA.offlineUrl}`,
  `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escape(copy.title)}</title><style>:root{${tokens}}*{box-sizing:border-box}body{margin:0;padding:1.5rem;background:var(--color-background);color:var(--color-text);font:var(--fs-body)/var(--line-body) system-ui,sans-serif;word-break:keep-all;overflow-wrap:anywhere}main{max-width:var(--content-max);margin:3rem auto}h1{font-size:var(--fs-title);line-height:var(--line-title)}a{display:block;min-height:var(--touch-min);padding:1rem;border-radius:var(--radius-control);background:var(--color-accent);color:var(--color-on-accent);font-size:var(--fs-button);text-align:center}a:focus-visible{outline:var(--focus-width) solid var(--color-text);outline-offset:var(--focus-offset)}small{display:block;margin-top:2rem;font-size:var(--fs-caption);color:var(--color-muted)}</style></head><body><main><h1>${escape(copy.title)}</h1><p>${escape(copy.description)}</p><a href="/">${escape(copy.retry)}</a><small>${escape(copy.privacy)}</small></main></body></html>\n`,
);
