// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { clearFictionalDiscovery } from '../e2e/authenticated/discovery-fixtures';

const mocked = vi.hoisted(() => ({
  exec: vi.fn(),
  create: vi.fn(),
  from: vi.fn(),
  remove: vi.fn(),
  operations: [] as string[],
}));
vi.mock('node:child_process', () => ({ execFileSync: mocked.exec }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocked.create }));
beforeEach(() => {
  vi.clearAllMocks();
  mocked.operations.length = 0;
  for (const key of ['CI', 'GITHUB_ACTIONS', 'AUTH_LOCAL_E2E'])
    vi.stubEnv(key, 'true');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('AUTH_TEST_SERVICE_KEY', 'fictional-local-fixture-key');
  vi.stubEnv('DOCKER_HOST', '');
  vi.stubEnv('DOCKER_CONTEXT', '');
  mocked.exec.mockImplementation(
    (_command: string, args: string[], options?: { input?: string }) => {
      if (args.at(-1) === 'show') return 'default\n';
      if (args.includes('inspect')) return 'unix:///var/run/docker.sock\n';
      const sql = options?.input ?? '';
      mocked.operations.push(sql.startsWith('select') ? 'verify' : 'detach');
      return sql.startsWith('select') ? '0\n' : '';
    },
  );
  mocked.create.mockReturnValue({ storage: { from: mocked.from } });
  mocked.from.mockReturnValue({ remove: mocked.remove });
  mocked.remove.mockImplementation(async () => {
    mocked.operations.push('storage-api');
    return { error: null };
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('isolated discovery fixture teardown', () => {
  it('commits application FK cleanup before deleting only its three exact paths through Storage', async () => {
    await clearFictionalDiscovery();
    expect(mocked.operations).toEqual(['detach', 'storage-api', 'verify']);
    expect(mocked.create).toHaveBeenCalledWith(
      'http://127.0.0.1:54321',
      'fictional-local-fixture-key',
      expect.objectContaining({
        auth: { persistSession: false, autoRefreshToken: false },
      }),
    );
    expect(mocked.from).toHaveBeenCalledWith('message-media');
    expect(mocked.remove).toHaveBeenCalledWith([
      'a1200000-0000-4000-8000-000000000001/a1300000-0000-4000-8000-000000000002/a1500000-0000-4000-8000-000000000002.jpg',
      'a1200000-0000-4000-8000-000000000001/a1300000-0000-4000-8000-000000000003/a1500000-0000-4000-8000-000000000003.mp3',
      'a1200000-0000-4000-8000-000000000001/a1300000-0000-4000-8000-000000000004/a1500000-0000-4000-8000-000000000004.mp4',
    ]);
    const sql = mocked.exec.mock.calls
      .map((call) => call[2]?.input ?? '')
      .join('\n');
    expect(sql).toContain('delete from public.message_media');
    expect(sql).toContain('delete from public.messages');
    expect(sql).not.toMatch(/delete\s+from\s+storage\./i);
    expect(sql).not.toMatch(
      /disable\s+trigger|session_replication_role|allow_delete_query/i,
    );
  });
  it.each([
    'CI',
    'GITHUB_ACTIONS',
    'AUTH_LOCAL_E2E',
    'NEXT_PUBLIC_SUPABASE_URL',
  ])(
    'refuses nonlocal/inactive fixture environment %s before Storage access',
    async (key) => {
      vi.stubEnv(key, 'wrong');
      await expect(clearFictionalDiscovery()).rejects.toThrow();
      expect(mocked.create).not.toHaveBeenCalled();
      expect(mocked.remove).not.toHaveBeenCalled();
    },
  );
  it.each(['return', 'throw'])(
    'sanitizes %s Storage failure while leaving application FKs detached',
    async (mode) => {
      if (mode === 'throw')
        mocked.remove.mockRejectedValue(
          new Error('private-key-provider-detail'),
        );
      else
        mocked.remove.mockResolvedValue({
          error: { message: 'private-key-provider-detail' },
        });
      await expect(clearFictionalDiscovery()).rejects.toThrow(
        'Local Storage fixture cleanup failed.',
      );
      expect(mocked.operations).toEqual(['detach']);
    },
  );
  it('verifies persisted Storage metadata removal rather than treating an API response as proof', async () => {
    mocked.exec.mockImplementation(
      (_cmd: string, args: string[], options?: { input?: string }) => {
        if (args.at(-1) === 'show') return 'default';
        if (args.includes('inspect')) return 'unix:///var/run/docker.sock';
        return options?.input?.startsWith('select') ? '1' : '';
      },
    );
    await expect(clearFictionalDiscovery()).rejects.toThrow(
      'Local Storage fixture metadata still exists after API cleanup.',
    );
  });
  it('awaits teardown and always removes policy configuration without bypassing Storage protection', () => {
    const source = readFileSync(
      new URL('../e2e/authenticated/artist-discovery.spec.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain('await clearFictionalDiscovery()');
    expect(source).toMatch(/finally\s*\{\s*disableFictionalPolicy\(\)/);
    const helper = readFileSync(
      new URL('../e2e/authenticated/discovery-fixtures.ts', import.meta.url),
      'utf8',
    );
    expect(helper).not.toMatch(
      /delete\s+from\s+storage\.|disable\s+trigger|session_replication_role|allow_delete_query/i,
    );
  });
});
