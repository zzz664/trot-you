'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  LEGAL_DOCUMENT_KINDS,
  type LegalDocumentSource,
} from '@/config/legal-documents';
import { legalDocumentPath } from '@/config/routes';

export function LegalDocumentLinks({
  from = 'start',
}: {
  from?: LegalDocumentSource;
}) {
  const t = useTranslations('legalDocuments');
  return (
    <nav className="onboarding-stack" aria-label={t('navigation')}>
      {LEGAL_DOCUMENT_KINDS.map((kind) => (
        <Link
          key={kind}
          href={legalDocumentPath(kind, undefined, from)}
          prefetch={false}
          className="ui-button ui-button--secondary"
        >
          {t(kind)}
        </Link>
      ))}
    </nav>
  );
}
