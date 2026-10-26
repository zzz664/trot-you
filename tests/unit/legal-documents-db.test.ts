import { expect, it, vi } from 'vitest';
import type { ActorClient } from '@/server/db/client';
import { createLegalDocumentPort } from '@/server/db/legal-documents';

const row = {
  kind: 'terms',
  version: 'abcd0000-0000-4000-8000-000000000001',
  title: 'Test',
  body: 'Fixture only',
  approved_at: '2026-10-01T00:00:00Z',
  published_at: '2026-10-01T00:00:00Z',
};
function setup(data: unknown = row, error: unknown = null) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  const from = vi.fn().mockReturnValue(query);
  return {
    from,
    query,
    port: createLegalDocumentPort({ from } as unknown as ActorClient),
  };
}
it('reads only the current-pointer public view without date ordering or private I/O', async () => {
  const { from, query, port } = setup();
  expect(await port.read({ kind: 'terms' })).toEqual({
    kind: row.kind,
    version: row.version,
    title: row.title,
    body: row.body,
    approvedAt: row.approved_at,
    publishedAt: row.published_at,
  });
  expect(from).toHaveBeenCalledExactlyOnceWith(
    'current_onboarding_policy_documents',
  );
  expect(query.select).toHaveBeenCalledExactlyOnceWith(
    'kind,version,title,body,approved_at,published_at',
  );
  expect(query.eq).toHaveBeenCalledExactlyOnceWith('kind', 'terms');
  expect(query.maybeSingle).toHaveBeenCalledTimes(1);
});
it('exact read constrains both kind and version on approved immutable projection', async () => {
  const { from, query, port } = setup();
  await port.read({ kind: 'privacy', version: row.version });
  expect(from).toHaveBeenCalledExactlyOnceWith('onboarding_policy_documents');
  expect(query.eq.mock.calls).toEqual([
    ['kind', 'privacy'],
    ['version', row.version],
  ]);
});
it('preserves absence and hides database details on a failed read', async () => {
  expect(await setup(null).port.read({ kind: 'terms' })).toBeNull();
  await expect(
    setup(row, { message: 'private credentials' }).port.read({ kind: 'terms' }),
  ).rejects.toThrow('LEGAL_DOCUMENT_READ_UNAVAILABLE');
});
