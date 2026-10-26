import 'server-only';
import type { ActorClient } from './client';
import type { LegalDocumentPort } from '@/server/services/legal-documents/read';

export function createLegalDocumentPort(
  client: ActorClient,
): LegalDocumentPort {
  return {
    async read({ kind, version }) {
      // Both projections already exclude unapproved/unpublished/future text.
      // Never inspect private policy/draft tables or infer current by ordering.
      const query = client
        .from(
          version
            ? 'onboarding_policy_documents'
            : 'current_onboarding_policy_documents',
        )
        .select('kind,version,title,body,approved_at,published_at')
        .eq('kind', kind);
      const { data, error } = await (
        version ? query.eq('version', version) : query
      ).maybeSingle();
      if (error) throw new Error('LEGAL_DOCUMENT_READ_UNAVAILABLE');
      if (!data) return null;
      return {
        kind: data.kind,
        version: data.version,
        title: data.title,
        body: data.body,
        approvedAt: data.approved_at,
        publishedAt: data.published_at,
      };
    },
  };
}
