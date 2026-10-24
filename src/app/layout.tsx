import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { APP_LOCALE, FONT_SCALE_COOKIE } from '@/config/constants';
import { getPublicEnv } from '@/config/env';
import { getDesignTokenCss, resolveFontScale } from '@/lib/design-tokens';
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
  const fontScale = resolveFontScale(
    (await cookies()).get(FONT_SCALE_COOKIE)?.value,
  );
  return (
    <html lang={APP_LOCALE} data-font-scale={fontScale}>
      <head>
        <style>{getDesignTokenCss()}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
