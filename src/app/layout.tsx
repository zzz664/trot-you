import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { NextIntlClientProvider } from 'next-intl';
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
    description: t('description'),
    metadataBase: new URL(getPublicEnv().NEXT_PUBLIC_APP_URL),
  };
}

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
        <NextIntlClientProvider>
          <DialogRoot>{children}</DialogRoot>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
