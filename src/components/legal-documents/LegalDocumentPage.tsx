import { connection } from 'next/server';
import { legalDocumentSource } from '@/config/legal-documents';
import { getLegalDocumentPage } from '@/server/legal-documents/page';
import { LegalDocumentScreen } from './LegalDocumentScreen';

export async function LegalDocumentPage({
  kind,
  version,
  from,
}: {
  kind: string;
  version?: string;
  from?: string | string[] | undefined;
}) {
  // Current-pointer reads must not be frozen during a production build.
  await connection();
  const result = await getLegalDocumentPage({
    kind,
    ...(version !== undefined ? { version } : {}),
  });
  const source = legalDocumentSource(from);
  return (
    <LegalDocumentScreen
      key={`${kind}:${version ?? ''}:${source}`}
      result={result}
      exact={version !== undefined}
      from={source}
    />
  );
}
