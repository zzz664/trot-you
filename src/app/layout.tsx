import type { Metadata, Viewport } from 'next';
import { getTranslations } from 'next-intl/server';
import { NextIntlClientProvider } from 'next-intl';
import { PwaRegistration } from '@/components/pwa/PwaRegistration';
import { InstallPromptCapture } from '@/components/onboarding/InstallPromptCapture';
import { PWA } from '@/config/pwa';
import { designTokens } from '@/config/design-tokens';
import { DialogRoot } from '@/components/ui/DialogRoot';
import type { ReactNode } from 'react';
import { APP_LOCALE } from '@/config/constants';
import { getPublicEnv } from '@/config/env';
import { getDesignTokenCss } from '@/lib/design-tokens';
import { getServerFontScale } from '@/server/onboarding/page';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('metadata');
  return {
    title: t('title'),
    applicationName: t('title'),
    appleWebApp: {
      capable: true,
      statusBarStyle: 'default',
      title: t('title'),
    },
    icons: { apple: PWA.appleIcon, icon: PWA.icon192 },
    description: t('description'),
    metadataBase: new URL(getPublicEnv().NEXT_PUBLIC_APP_URL),
  };
}

export const viewport: Viewport = {
  themeColor: designTokens.base['--color-accent'],
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const fontScale = await getServerFontScale();
  return (
    <html lang={APP_LOCALE} data-font-scale={fontScale}>
      <head>
        <style>{getDesignTokenCss()}</style>
      </head>
      <body>
        <PwaRegistration />
        <InstallPromptCapture />
        <NextIntlClientProvider>
          <DialogRoot>{children}</DialogRoot>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
