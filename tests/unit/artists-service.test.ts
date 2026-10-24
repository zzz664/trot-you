// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  ARTIST_MAX_PAGE,
  ARTIST_PAGE_SIZE,
  ARTIST_SLUG_MAX_LENGTH,
} from '@/config/artists';
import { routes } from '@/config/routes';
import {
  artistPageNumber,
  listArtists,
  readArtistInterest,
  readArtistPreview,
  selectArtist,
  type ArtistCatalogPort,
  type ArtistInterestPort,
  type ArtistPreviewPort,
  type RawArtistPreview,
} from '@/server/services/artists/discovery';

const actor = 'a1100000-0000-4000-8000-000000000001';
const artist = { slug: 'fictional-star', name: '허구 가수', description: null };
const interest = {
  selectedSlug: artist.slug,
  selectedName: artist.name,
  selectedAt: '2026-10-24T00:00:00Z',
};
const preview: RawArtistPreview = {
  artist,
  callName: '별님',
  messages: [
    {
      id: actor,
      kind: 'photo',
      template: '{이름} 안녕하세요, {이름}!',
      sentAt: '2026-10-24T00:00:00Z',
      media: [{ kind: 'photo', availability: 'unavailable' }],
    },
  ],
};
const catalogPort = (): ArtistCatalogPort => ({
  list: vi.fn().mockResolvedValue({ ok: true, data: [] }),
});
const interestPort = (): ArtistInterestPort => ({
  read: vi.fn().mockResolvedValue({ ok: true, data: interest }),
  select: vi.fn().mockResolvedValue({ ok: true, data: null }),
});
const previewPort = (): ArtistPreviewPort => ({
  read: vi.fn().mockResolvedValue({ ok: true, data: preview }),
});

describe('public artist catalog pagination', () => {
  it.each([
    [undefined, 1],
    ['1', 1],
    ['2', 2],
    [String(ARTIST_MAX_PAGE), ARTIST_MAX_PAGE],
  ])('accepts canonical page %s', (input, output) =>
    expect(artistPageNumber(input)).toBe(output),
  );
  it.each([
    null,
    0,
    1,
    '',
    '0',
    '-1',
    '01',
    '1.5',
    '1e2',
    ' 1',
    '1 ',
    ['1'],
    'Infinity',
    '9007199254740992',
    String(ARTIST_MAX_PAGE + 1),
  ])('rejects noncanonical or unbounded page %j', async (input) => {
    const port = catalogPort();
    expect(artistPageNumber(input)).toBeNull();
    expect(await listArtists(port, input)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(port.list).not.toHaveBeenCalled();
  });
  it('uses one bounded lookahead row without exposing it or any private state', async () => {
    const port = catalogPort();
    const rows = Array.from({ length: ARTIST_PAGE_SIZE + 1 }, (_, index) => ({
      ...artist,
      slug: `fixture-${index}`,
    }));
    vi.mocked(port.list).mockResolvedValue({ ok: true, data: rows });
    expect(await listArtists(port, '2')).toEqual({
      ok: true,
      data: {
        artists: rows.slice(0, ARTIST_PAGE_SIZE),
        page: 2,
        hasNext: true,
        selectedSlug: null,
        selectedName: null,
        onboarding: false,
      },
    });
    expect(port.list).toHaveBeenCalledExactlyOnceWith(
      ARTIST_PAGE_SIZE,
      ARTIST_PAGE_SIZE + 1,
    );
  });
  it('represents empty pages and exact-size final pages honestly', async () => {
    const port = catalogPort();
    expect(await listArtists(port, undefined)).toMatchObject({
      ok: true,
      data: { artists: [], hasNext: false, page: 1 },
    });
    vi.mocked(port.list).mockResolvedValue({
      ok: true,
      data: Array.from({ length: ARTIST_PAGE_SIZE }, () => artist),
    });
    expect(await listArtists(port, '1')).toMatchObject({
      ok: true,
      data: { hasNext: false },
    });
  });
  it('never invents a catalog after a database error or exception', async () => {
    const port = catalogPort();
    vi.mocked(port.list).mockResolvedValue({
      ok: false,
      code: 'SETUP_NOT_READY',
    });
    expect(await listArtists(port, undefined)).toEqual({
      ok: false,
      code: 'SETUP_NOT_READY',
    });
    vi.mocked(port.list).mockRejectedValue(new Error('private query detail'));
    expect(await listArtists(port, undefined)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
});

describe('durable interest, not subscription creation', () => {
  it('returns actor-scoped persisted choice and current readiness failures', async () => {
    const port = interestPort();
    expect(await readArtistInterest(port)).toEqual({
      ok: true,
      data: interest,
    });
    vi.mocked(port.read).mockResolvedValue({
      ok: false,
      code: 'PROFILE_REQUIRED',
    });
    expect(await readArtistInterest(port)).toEqual({
      ok: false,
      code: 'PROFILE_REQUIRED',
    });
    vi.mocked(port.read).mockRejectedValue(new Error('secret'));
    expect(await readArtistInterest(port)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it.each([
    null,
    {},
    { slug: '' },
    { slug: '../admin' },
    { slug: 'Upper' },
    { slug: 'a'.repeat(ARTIST_SLUG_MAX_LENGTH + 1) },
    { slug: artist.slug, actorId: actor },
    { slug: artist.slug, subscribed: true },
    { slug: artist.slug, skip: true },
  ])(
    'rejects malformed, forged actor or fake paid-access input %j',
    async (input) => {
      const port = interestPort();
      expect(await selectArtist(port, input)).toEqual({
        ok: false,
        code: 'INVALID_INPUT',
      });
      expect(port.select).not.toHaveBeenCalled();
    },
  );
  it('advances only to pending install after committed interest selection', async () => {
    const port = interestPort();
    expect(await selectArtist(port, { slug: artist.slug })).toEqual({
      ok: true,
      next: routes.onboardingInstall,
    });
    expect(port.select).toHaveBeenCalledExactlyOnceWith(artist.slug);
    expect(port.read).not.toHaveBeenCalled();
  });
  it.each([
    'PROFILE_REQUIRED',
    'NOT_FOUND',
    'FORBIDDEN',
    'SETUP_NOT_READY',
  ] as const)(
    'preserves %s and never fabricates selection success',
    async (code) => {
      const port = interestPort();
      vi.mocked(port.select).mockResolvedValue({ ok: false, code });
      expect(await selectArtist(port, { slug: artist.slug })).toEqual({
        ok: false,
        code,
      });
    },
  );
  it('makes uncertain transport failure retryable without claiming no commit', async () => {
    const port = interestPort();
    vi.mocked(port.select).mockRejectedValue(new Error('timeout'));
    expect(await selectArtist(port, { slug: artist.slug })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
});

describe('server-only personalized preview projection', () => {
  it('uses the verified actor and produces text, unavailable media, and no raw identity/path metadata', async () => {
    const port = previewPort();
    vi.mocked(port.read).mockResolvedValue({
      ok: true,
      data: {
        ...preview,
        privateSecret: 'hidden',
        artist: { ...artist, contractId: 'hidden' },
        messages: [
          {
            ...preview.messages[0]!,
            authorId: 'hidden',
            media: [
              {
                kind: 'photo',
                availability: 'unavailable',
                path: 'private/object',
                url: 'https://unknown.invalid/private',
              },
            ],
          },
        ],
      },
    } as unknown as { ok: true; data: RawArtistPreview });
    const result = await readArtistPreview(port, actor, artist.slug);
    expect(port.read).toHaveBeenCalledExactlyOnceWith(actor, artist.slug);
    expect(result).toEqual({
      ok: true,
      data: {
        artist,
        messages: [
          {
            id: actor,
            kind: 'photo',
            text: '별님 안녕하세요, 별님!',
            sentAt: '2026-10-24T00:00:00Z',
            media: [{ kind: 'photo', availability: 'unavailable' }],
          },
        ],
        selectedSlug: null,
        onboarding: false,
      },
    });
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      'template',
      'callName',
      'privateSecret',
      'contractId',
      'authorId',
      'private/object',
      'unknown.invalid',
    ])
      expect(serialized).not.toContain(forbidden);
  });
  it('keeps empty previews and media-only messages distinct from denied access', async () => {
    const port = previewPort();
    vi.mocked(port.read).mockResolvedValue({
      ok: true,
      data: { ...preview, messages: [] },
    });
    expect(await readArtistPreview(port, actor, artist.slug)).toMatchObject({
      ok: true,
      data: { messages: [] },
    });
    vi.mocked(port.read).mockResolvedValue({
      ok: true,
      data: {
        ...preview,
        messages: [{ ...preview.messages[0]!, template: null }],
      },
    });
    expect(await readArtistPreview(port, actor, artist.slug)).toMatchObject({
      ok: true,
      data: { messages: [{ text: null }] },
    });
  });
  it.each([null, '', '../private', 'a/b', 'Upper', ['valid']])(
    'rejects unknown route slug %j before RPC',
    async (slug) => {
      const port = previewPort();
      expect(await readArtistPreview(port, actor, slug)).toEqual({
        ok: false,
        code: 'NOT_FOUND',
      });
      expect(port.read).not.toHaveBeenCalled();
    },
  );
  it('rejects a non-verified subject shape before privileged RPC', async () => {
    const port = previewPort();
    expect(
      await readArtistPreview(port, 'client supplied', artist.slug),
    ).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(port.read).not.toHaveBeenCalled();
  });
  it.each([
    'NOT_FOUND',
    'PROFILE_REQUIRED',
    'FORBIDDEN',
    'SETUP_NOT_READY',
  ] as const)(
    'passes controlled %s without returning content',
    async (code) => {
      const port = previewPort();
      vi.mocked(port.read).mockResolvedValue({ ok: false, code });
      expect(await readArtistPreview(port, actor, artist.slug)).toEqual({
        ok: false,
        code,
      });
    },
  );
  it('redacts thrown provider or DB details', async () => {
    const port = previewPort();
    vi.mocked(port.read).mockRejectedValue(new Error('private-service-key'));
    expect(await readArtistPreview(port, actor, artist.slug)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
});
