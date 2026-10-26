import 'server-only';
import { getAuthConfiguration } from '@/server/auth/configuration';
import { createActorClient } from '@/server/db/client';
import { createLegalDocumentPort } from '@/server/db/legal-documents';
import { readLegalDocument } from '@/server/services/legal-documents/read';

export async function getLegalDocumentPage(input: unknown) {
  const configuration = getAuthConfiguration();
  // Public legal reading must work before login and during onboarding or
  // restriction. Deliberately use no actor cookies, role bypass or service key.
  const port = configuration
    ? createLegalDocumentPort(
        createActorClient(configuration, {
          getAll: () => [],
          setAll: () => {},
        }),
      )
    : null;
  return readLegalDocument(port, input);
}
