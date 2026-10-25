'use client';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ADMIN_ARTISTS } from '@/config/admin-artists';
import styles from './admin-artists.module.css';
export function AdminArtistPagination({
  page,
  hasMore,
  previous,
  next,
  onNavigate,
}: {
  page: number;
  hasMore: boolean;
  previous: string;
  next: string;
  onNavigate: () => void;
}) {
  const t = useTranslations('adminArtists');
  return (
    <nav className={styles.stack} aria-label={t('detailPagination')}>
      <p>{t('pageIndicator', { page })}</p>
      <div className={styles.actions}>
        {page > 1 && (
          <Link
            href={previous}
            prefetch={false}
            onNavigate={onNavigate}
            className="ui-button ui-button--secondary"
          >
            {t('previousPage')}
          </Link>
        )}
        {hasMore && page < ADMIN_ARTISTS.maxPage && (
          <Link
            href={next}
            prefetch={false}
            onNavigate={onNavigate}
            className="ui-button ui-button--secondary"
          >
            {t('nextPage')}
          </Link>
        )}
      </div>
    </nav>
  );
}
