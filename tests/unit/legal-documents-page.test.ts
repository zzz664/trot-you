import { beforeEach, expect, it, vi } from 'vitest';
import { getLegalDocumentPage } from '@/server/legal-documents/page';

const mock = vi.hoisted(() => ({
  config: vi.fn(),
  client: vi.fn(),
  port: vi.fn(),
  read: vi.fn(),
}));
vi.mock('@/server/auth/configuration', () => ({
  getAuthConfiguration: mock.config,
}));
vi.mock('@/server/db/client', () => ({ createActorClient: mock.client }));
vi.mock('@/server/db/legal-documents', () => ({
  createLegalDocumentPort: mock.port,
}));
vi.mock('@/server/services/legal-documents/read', () => ({
  readLegalDocument: mock.read,
}));
beforeEach(() => {
  vi.clearAllMocks();
  mock.read.mockResolvedValue({ ok: false, code: 'NOT_CONFIGURED' });
});
it('unconfigured environment delegates explicit missing configuration without opening I/O', async () => {
  mock.config.mockReturnValue(null);
  await getLegalDocumentPage({ kind: 'terms' });
  expect(mock.read).toHaveBeenCalledExactlyOnceWith(null, { kind: 'terms' });
  expect(mock.client).not.toHaveBeenCalled();
});
it('public reader uses anonymous cookies and no session, service role, or private account data', async () => {
  const configuration = {
    appOrigin: 'https://fixture.invalid',
    supabaseUrl: 'https://fixture.supabase.invalid',
    publicKey: 'public-fixture',
  };
  const client = {};
  const port = {};
  mock.config.mockReturnValue(configuration);
  mock.client.mockReturnValue(client);
  mock.port.mockReturnValue(port);
  expect(await getLegalDocumentPage({ kind: 'privacy' })).toEqual({
    ok: false,
    code: 'NOT_CONFIGURED',
  });
  expect(mock.client).toHaveBeenCalledExactlyOnceWith(configuration, {
    getAll: expect.any(Function),
    setAll: expect.any(Function),
  });
  expect(mock.client.mock.calls[0]![1].getAll()).toEqual([]);
  expect(mock.client.mock.calls[0]![1].setAll()).toBeUndefined();
  expect(mock.port).toHaveBeenCalledExactlyOnceWith(client);
  expect(mock.read).toHaveBeenCalledExactlyOnceWith(port, { kind: 'privacy' });
});
