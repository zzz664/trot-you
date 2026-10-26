import { LegalDocumentPage } from '@/components/legal-documents/LegalDocumentPage';

export default async function CurrentLegalDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const { kind } = await params;
  const { from } = await searchParams;
  return <LegalDocumentPage kind={kind} from={from} />;
}
