'use client';

import Link from 'next/link';
import { useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { BackButton } from '@/components/ui/BackButton';
import { Button } from '@/components/ui/Button';
import { Loading } from '@/components/ui/Loading';
import {
  LEGAL_DOCUMENT_ERRORS,
  LEGAL_DOCUMENT_RETURN_PATHS,
  type LegalDocumentResult,
  type LegalDocumentSource,
} from '@/config/legal-documents';
import { legalDocumentPath } from '@/config/routes';
import { LegalDocumentLinks } from './LegalDocumentLinks';
import styles from './legal-documents.module.css';

export function LegalDocumentScreen({
  result,
  exact,
  from,
}: {
  result: LegalDocumentResult;
  exact: boolean;
  from: LegalDocumentSource;
}) {
  const t = useTranslations('legalDocuments');
  const ui = useTranslations('ui');
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  function refresh() {
    if (!refreshing) startRefresh(() => router.refresh());
  }
  useEffect(() => {
    // Browser Back/Forward and BFCache restoration must re-read current
    // pointers. This is a public read only, never a consent mutation.
    const refresh = () => startRefresh(() => router.refresh());
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) refresh();
    };
    window.addEventListener('popstate', refresh);
    window.addEventListener('pageshow', restore);
    return () => {
      window.removeEventListener('popstate', refresh);
      window.removeEventListener('pageshow', restore);
    };
  }, [router]);
  return (
    <main className={`app-shell onboarding-stack ${styles.document}`}>
      <nav aria-label={t('returnNavigation')}>
        <BackButton fallbackHref={LEGAL_DOCUMENT_RETURN_PATHS[from]} />
      </nav>
      {refreshing && <Loading />}
      {result.ok ? (
        <article aria-busy={refreshing || undefined}>
          <header className="onboarding-stack">
            <p>{t(result.document.kind)}</p>
            <h1>{result.document.title}</h1>
            <p>{t(exact ? 'exactDescription' : 'currentDescription')}</p>
            <p className="ui-hint">
              {t('version', { version: result.document.version })}
            </p>
            <p className="ui-hint">
              {t('publishedAt')}{' '}
              <time dateTime={result.document.publishedAt}>
                {result.document.publishedAt}
              </time>
            </p>
          </header>
          <div className={styles.body}>{result.document.body}</div>
          <Link
            href={legalDocumentPath(
              result.document.kind,
              exact ? undefined : result.document.version,
              from,
            )}
            prefetch={false}
            className="ui-button ui-button--secondary"
          >
            {t(exact ? 'current' : 'openVersion')}
          </Link>
        </article>
      ) : (
        <>
          <h1>{t('title')}</h1>
          <p role="alert">{t(LEGAL_DOCUMENT_ERRORS[result.code])}</p>
        </>
      )}
      <Button variant="secondary" isLoading={refreshing} onClick={refresh}>
        {refreshing ? ui('retrying') : result.ok ? t('refresh') : ui('retry')}
      </Button>
      <p className="ui-hint">{t('readOnly')}</p>
      <LegalDocumentLinks from={from} />
    </main>
  );
}
