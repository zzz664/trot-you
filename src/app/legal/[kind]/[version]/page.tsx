import { LegalDocumentPage } from '@/components/legal-documents/LegalDocumentPage';

export default async function ExactLegalDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string; version: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const { kind, version } = await params;
  const { from } = await searchParams;
  return <LegalDocumentPage kind={kind} version={version} from={from} />;
}
