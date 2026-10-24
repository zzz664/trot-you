import type { MetadataRoute } from 'next';
import { APP_LOCALE } from '@/config/constants';
import { designTokens } from '@/config/design-tokens';
import { PWA } from '@/config/pwa';
import { routes } from '@/config/routes';
import messages from '@/messages/ko.json';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: routes.home,
    name: messages.metadata.title,
    short_name: messages.metadata.title,
    description: messages.metadata.description,
    lang: APP_LOCALE,
    start_url: routes.home,
    scope: PWA.scope,
    display: 'standalone',
    background_color: designTokens.base['--color-background'],
    theme_color: designTokens.base['--color-accent'],
    icons: [
      { src: PWA.icon192, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: PWA.icon512, sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: PWA.icon512,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
