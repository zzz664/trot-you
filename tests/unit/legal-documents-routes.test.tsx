import { beforeEach, expect, it, vi } from 'vitest';
import CurrentPage from '@/app/legal/[kind]/page';
import ExactPage from '@/app/legal/[kind]/[version]/page';
import { LegalDocumentPage } from '@/components/legal-documents/LegalDocumentPage';

const mock = vi.hoisted(() => ({ connection: vi.fn(), read: vi.fn() }));
vi.mock('next/server', () => ({ connection: mock.connection }));
vi.mock('@/server/legal-documents/page', () => ({
  getLegalDocumentPage: mock.read,
}));
beforeEach(() => {
  vi.clearAllMocks();
  mock.read.mockResolvedValue({ ok: false, code: 'NOT_FOUND' });
});
it('current route awaits request params and never injects an inferred version', async () => {
  const page = await CurrentPage({
    params: Promise.resolve({ kind: 'terms' }),
    searchParams: Promise.resolve({ from: 'account' }),
  });
  expect(page.type).toBe(LegalDocumentPage);
  expect(page.props).toEqual({ kind: 'terms', from: 'account' });
});
it('exact route retains the literal requested version for validation and safe source parsing', async () => {
  const page = await ExactPage({
    params: Promise.resolve({ kind: 'privacy', version: 'invalid-version' }),
    searchParams: Promise.resolve({
      from: ['onboarding', 'https://outside.invalid'],
    }),
  });
  expect(page.type).toBe(LegalDocumentPage);
  expect(page.props).toEqual({
    kind: 'privacy',
    version: 'invalid-version',
    from: ['onboarding', 'https://outside.invalid'],
  });
});
it('shared server boundary waits for a request and preserves invalid exact inputs as failures', async () => {
  const page = await LegalDocumentPage({
    kind: 'terms',
    version: '',
    from: '__proto__',
  });
  expect(mock.connection).toHaveBeenCalledTimes(1);
  expect(mock.connection.mock.invocationCallOrder[0]).toBeLessThan(
    mock.read.mock.invocationCallOrder[0]!,
  );
  expect(mock.read).toHaveBeenCalledExactlyOnceWith({
    kind: 'terms',
    version: '',
  });
  expect(page.props).toEqual({
    result: { ok: false, code: 'NOT_FOUND' },
    exact: true,
    from: 'start',
  });
});
