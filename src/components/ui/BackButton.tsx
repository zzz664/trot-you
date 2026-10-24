'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { routes, type AppRoute } from '@/config/routes';
import { IconButton } from './IconButton';

type BackButtonProps = { fallbackHref?: AppRoute };

export function BackButton({ fallbackHref = routes.home }: BackButtonProps) {
  const router = useRouter();
  const t = useTranslations('ui');
  // Browsers cannot prove a history entry is in this app. Until navigation is
  // tracked explicitly, always replace with the caller's known parent route.
  return (
    <IconButton
      label={t('back')}
      icon="←"
      variant="secondary"
      onClick={() => router.replace(fallbackHref)}
    />
  );
}
