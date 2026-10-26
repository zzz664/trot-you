import { expect, it, vi } from 'vitest';
import { readLegalDocument } from '@/server/services/legal-documents/read';
import { legalDocumentSource } from '@/config/legal-documents';
import { legalDocumentPath, routes } from '@/config/routes';

const document = {
  kind: 'terms',
  version: 'abcd0000-0000-4000-8000-000000000001',
  title: '  Fictional test document  ',
  body: '  <script>not executed</script>\nText is unchanged.  ',
  approvedAt: '2026-10-01T00:00:00+00:00',
  publishedAt: '2026-10-02T00:00:00+00:00',
};
const now = Date.parse('2026-10-26T00:00:00Z');
it('reads the current pointer without inventing a version or rewriting immutable text', async () => {
  const port = { read: vi.fn().mockResolvedValue(document) };
  expect(await readLegalDocument(port, { kind: 'terms' }, now)).toEqual({
    ok: true,
    document,
  });
  expect(port.read).toHaveBeenCalledExactlyOnceWith({ kind: 'terms' });
});
it('validates and normalizes an exact UUID without falling back to current', async () => {
  const port = { read: vi.fn().mockResolvedValue(document) };
  expect(
    await readLegalDocument(
      port,
      { kind: 'terms', version: document.version.toUpperCase() },
      now,
    ),
  ).toEqual({ ok: true, document });
  expect(port.read).toHaveBeenCalledExactlyOnceWith({
    kind: 'terms',
    version: document.version,
  });
});
it.each([
  { kind: 'analytics' },
  { kind: '../privacy' },
  { kind: 'terms', version: '' },
  { kind: 'terms', version: 'not-a-version' },
  { kind: 'terms', latest: true },
])('rejects invalid selectors without I/O %#', async (input) => {
  const port = { read: vi.fn() };
  expect(await readLegalDocument(port, input, now)).toEqual({
    ok: false,
    code: 'NOT_FOUND',
  });
  expect(port.read).not.toHaveBeenCalled();
});
it('distinguishes unconfigured transport, unset current pointer and missing exact version', async () => {
  const port = { read: vi.fn().mockResolvedValue(null) };
  expect(await readLegalDocument(null, { kind: 'terms' }, now)).toEqual({
    ok: false,
    code: 'UNCONFIGURED',
  });
  expect(await readLegalDocument(port, { kind: 'terms' }, now)).toEqual({
    ok: false,
    code: 'NOT_CONFIGURED',
  });
  expect(
    await readLegalDocument(
      port,
      { kind: 'terms', version: document.version },
      now,
    ),
  ).toEqual({ ok: false, code: 'NOT_FOUND' });
});
it.each([
  { ...document, kind: 'privacy' },
  { ...document, body: ' \n ' },
  { ...document, approvedAt: null },
  { ...document, publishedAt: null },
  { ...document, approvedAt: '2026-11-01T00:00:00Z' },
  { ...document, publishedAt: '2026-11-01T00:00:00Z' },
  { ...document, publishedAt: '2026-09-01T00:00:00Z' },
  { ...document, privateDraft: 'never disclose' },
])('fails closed inconsistent public projection %#', async (value) => {
  expect(
    await readLegalDocument(
      { read: async () => value },
      { kind: 'terms' },
      now,
    ),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
it('never substitutes another version and never returns transport error details', async () => {
  expect(
    await readLegalDocument(
      { read: async () => document },
      { kind: 'terms', version: 'abcd0000-0000-4000-8000-000000000002' },
      now,
    ),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  expect(
    await readLegalDocument(
      {
        read: async () => {
          throw new Error('private SQL and credentials');
        },
      },
      { kind: 'terms' },
      now,
    ),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
it('centralizes exact paths and allowlists return navigation without external redirects', () => {
  expect(legalDocumentPath('terms')).toBe(routes.legalTerms);
  expect(legalDocumentPath('privacy', document.version, 'onboarding')).toBe(
    `${routes.legalPrivacy}/${document.version}?from=onboarding`,
  );
  expect(legalDocumentPath('terms', '../private')).toBe(
    `${routes.legalTerms}/..%2Fprivate`,
  );
  for (const input of [
    'https://outside.invalid',
    '__proto__',
    ['onboarding'],
    undefined,
  ])
    expect(legalDocumentSource(input)).toBe('start');
  expect(legalDocumentSource('account')).toBe('account');
  expect(legalDocumentSource('onboarding')).toBe('onboarding');
});
