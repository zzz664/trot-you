import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { UiPreview } from '@/components/development/UiPreview';
import { isUiPreviewEnabled } from '@/config/env.server';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function UiPreviewPage() {
  await connection();
  if (!isUiPreviewEnabled()) notFound();
  return <UiPreview />;
}
