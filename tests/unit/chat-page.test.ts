// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '@/config/routes';
import { getArtistConversationPage } from '@/server/chat/page';
const mock = vi.hoisted(() => ({
  cookies: vi.fn(),
  context: vi.fn(),
  session: vi.fn(),
  redirect: vi.fn(),
  service: vi.fn(),
  pagePort: vi.fn(),
  chat: vi.fn(),
  preview: vi.fn(),
}));
vi.mock('next/headers', () => ({ cookies: mock.cookies }));
vi.mock('next/navigation', () => ({ redirect: mock.redirect }));
vi.mock('@/server/auth/context', () => ({ createAuthContext: mock.context }));
vi.mock('@/server/services/auth/session', () => ({
  readSession: mock.session,
}));
vi.mock('@/server/db/chat-client', () => ({
  createChatServiceClient: mock.service,
}));
vi.mock('@/server/db/chat', () => ({ createChatPagePort: mock.pagePort }));
vi.mock('@/server/services/chat/read', () => ({ readChatPage: mock.chat }));
vi.mock('@/server/artists/page', () => ({
  getArtistPreviewPage: mock.preview,
}));
const actor = 'a1900000-0000-4000-8000-000000000001';
const slug = 'fictional-star';
const profile = {
  id: actor,
  role: 'fan',
  onboarding_completed_at: '2026-10-24T00:00:00Z',
  is_restricted: false,
  restricted_until: null,
};
const chat = {
  artist: { slug, name: '허구 가수', description: null },
  hasAccess: true,
  messages: [],
  nextCursor: null,
  readCount: 0,
};
const preview = {
  artist: chat.artist,
  messages: [],
  selectedSlug: null,
  onboarding: false,
};
beforeEach(() => {
  vi.clearAllMocks();
  mock.cookies.mockResolvedValue({
    getAll: () => [{ name: 'fixture', value: 'actor-cookie' }],
  });
  mock.context.mockReturnValue({
    client: { actor: true },
    port: { verified: true },
  });
  mock.session.mockResolvedValue({ status: 'authenticated', profile });
  mock.service.mockReturnValue({ privileged: true });
  mock.pagePort.mockReturnValue({ trustedPage: true });
  mock.chat.mockResolvedValue({ ok: true, data: chat });
  mock.preview.mockResolvedValue({ ok: true, data: preview });
  mock.redirect.mockImplementation((path: string) => {
    throw new Error(`redirect:${path}`);
  });
});

describe('artist conversation RSC chooses current authorized content', () => {
  it('authenticates before reading a personalized paid first page', async () => {
    expect(await getArtistConversationPage(slug)).toEqual({
      ok: true,
      data: { kind: 'chat', chat },
    });
    expect(mock.context).toHaveBeenCalledExactlyOnceWith([
      { name: 'fixture', value: 'actor-cookie' },
    ]);
    expect(mock.session).toHaveBeenCalledExactlyOnceWith({ verified: true });
    expect(mock.pagePort).toHaveBeenCalledExactlyOnceWith({ privileged: true });
    expect(mock.chat).toHaveBeenCalledExactlyOnceWith(
      { trustedPage: true },
      actor,
      { slug },
    );
    expect(mock.preview).not.toHaveBeenCalled();
  });
  it('renders an honest paid empty conversation instead of mistaking it for unsubscribed', async () => {
    expect(await getArtistConversationPage(slug)).toMatchObject({
      ok: true,
      data: { kind: 'chat', chat: { messages: [], hasAccess: true } },
    });
    expect(mock.preview).not.toHaveBeenCalled();
  });
  it('retains authorized onboarding preview without requesting paid templates', async () => {
    mock.session.mockResolvedValue({
      status: 'authenticated',
      profile: { ...profile, onboarding_completed_at: null },
    });
    expect(await getArtistConversationPage(slug)).toEqual({
      ok: true,
      data: { kind: 'preview', preview },
    });
    expect(mock.service).not.toHaveBeenCalled();
    expect(mock.chat).not.toHaveBeenCalled();
    expect(mock.preview).toHaveBeenCalledExactlyOnceWith(slug);
  });
  it('uses the existing safe preview projection only after explicit no-paid-access context', async () => {
    mock.chat.mockResolvedValue({
      ok: true,
      data: { ...chat, hasAccess: false },
    });
    expect(await getArtistConversationPage(slug)).toEqual({
      ok: true,
      data: { kind: 'preview', preview },
    });
    expect(mock.chat).toHaveBeenCalledOnce();
    expect(mock.preview).toHaveBeenCalledExactlyOnceWith(slug);
  });
  it.each([
    'INVALID_INPUT',
    'FORBIDDEN',
    'NOT_FOUND',
    'PROFILE_REQUIRED',
    'SETUP_NOT_READY',
    'UNAVAILABLE',
    'SUBSCRIPTION_REQUIRED',
  ] as const)('does not hide %s by falling back to preview', async (code) => {
    mock.chat.mockResolvedValue({ ok: false, code });
    expect(await getArtistConversationPage(slug)).toEqual({ ok: false, code });
    expect(mock.preview).not.toHaveBeenCalled();
  });
  it.each([
    'NOT_FOUND',
    'FORBIDDEN',
    'PROFILE_REQUIRED',
    'SETUP_NOT_READY',
    'UNAVAILABLE',
  ] as const)('preserves safe preview %s without fabrication', async (code) => {
    mock.chat.mockResolvedValue({
      ok: true,
      data: { ...chat, hasAccess: false },
    });
    mock.preview.mockResolvedValue({ ok: false, code });
    expect(await getArtistConversationPage(slug)).toEqual({ ok: false, code });
  });
  it('cannot infer a subscription from missing service-role configuration', async () => {
    mock.service.mockReturnValue(null);
    expect(await getArtistConversationPage(slug)).toEqual({
      ok: false,
      code: 'SETUP_NOT_READY',
    });
    expect(mock.chat).not.toHaveBeenCalled();
    expect(mock.preview).not.toHaveBeenCalled();
  });
  it('redirects anonymous sessions to sign-in before any private query', async () => {
    mock.session.mockResolvedValue({ status: 'anonymous' });
    await expect(getArtistConversationPage(slug)).rejects.toThrow(
      `redirect:${routes.start}`,
    );
    expect(mock.service).not.toHaveBeenCalled();
    expect(mock.preview).not.toHaveBeenCalled();
  });
  it.each([
    ['unconfigured', 'SETUP_NOT_READY'],
    ['unavailable', 'UNAVAILABLE'],
  ])('fails closed for session %s', async (status, code) => {
    mock.session.mockResolvedValue({ status });
    expect(await getArtistConversationPage(slug)).toEqual({ ok: false, code });
    expect(mock.service).not.toHaveBeenCalled();
    expect(mock.preview).not.toHaveBeenCalled();
  });
  it('does not continue on a verified subject with no actor client', async () => {
    mock.context.mockReturnValue({ client: null, port: { verified: true } });
    expect(await getArtistConversationPage(slug)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(mock.service).not.toHaveBeenCalled();
  });
  it('redirects restrictions before determining paid access', async () => {
    mock.session.mockResolvedValue({
      status: 'authenticated',
      profile: { ...profile, is_restricted: true },
    });
    await expect(getArtistConversationPage(slug)).rejects.toThrow(
      `redirect:${routes.restricted}`,
    );
    expect(mock.service).not.toHaveBeenCalled();
    expect(mock.preview).not.toHaveBeenCalled();
  });
  it.each([
    ['artist', routes.artist],
    ['admin', routes.admin],
  ])(
    'routes %s accounts to their own mode without a fan content query',
    async (role, path) => {
      mock.session.mockResolvedValue({
        status: 'authenticated',
        profile: { ...profile, role },
      });
      await expect(getArtistConversationPage(slug)).rejects.toThrow(
        `redirect:${path}`,
      );
      expect(mock.service).not.toHaveBeenCalled();
      expect(mock.preview).not.toHaveBeenCalled();
    },
  );
});
