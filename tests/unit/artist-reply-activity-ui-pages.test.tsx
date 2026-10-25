import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ArtistReplyActivityMenu from '@/app/artist/replies/page';
import ArtistReplyActivityPage from '@/app/artist/[slug]/replies/page';
import {
  artistReplyActivityMenuPath,
  artistReplyActivityPath,
  routes,
} from '@/config/routes';
import messages from '@/messages/ko.json';

const mock = vi.hoisted(() => ({
  menu: vi.fn(),
  page: vi.fn(),
  translations: vi.fn(),
  screen: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@/server/artist-reply-activity/page', () => ({
  getArtistReplyActivityMenu: mock.menu,
  getArtistReplyActivityPage: mock.page,
}));
vi.mock('next-intl/server', () => ({ getTranslations: mock.translations }));
vi.mock('@/components/artist-reply-activity/ArtistReplyActivityScreen', () => ({
  ArtistReplyActivityScreen: (props: unknown) => {
    mock.screen(props);
    return <main>activity-screen</main>;
  },
}));
vi.mock(
  '@/components/artist-reply-activity/ArtistReplyActivityErrorScreen',
  () => ({
    ArtistReplyActivityErrorScreen: (props: unknown) => {
      mock.error(props);
      return <main>activity-error</main>;
    },
  }),
);
const artist = {
  id: '15111f52-a02e-42f7-9012-446401a10001',
  slug: 'fictional-artist',
  name: '가상 가수',
};
const message = {
  id: '15111f52-a02e-42f7-9012-446401a10002',
  kind: 'text',
  sentAt: '2026-10-25T01:00:00Z',
};
beforeEach(() => {
  Object.values(mock).forEach((fn) => fn.mockReset());
  mock.menu.mockResolvedValue({
    ok: true,
    data: { artists: [artist], nextSlug: null },
  });
  mock.page.mockResolvedValue({
    ok: true,
    data: {
      artist,
      selectedMessage: null,
      replies: [{ body: 'Not passed to client route props' }],
    },
  });
  mock.translations.mockImplementation(
    async () =>
      (
        key: keyof typeof messages.artistReplyActivity,
        values?: Record<string, string>,
      ) => {
        const text = messages.artistReplyActivity[key];
        if (typeof text !== 'string')
          throw new Error('Expected a leaf translation');
        return Object.entries(values ?? {}).reduce(
          (result, [name, value]) => result.replaceAll(`{${name}}`, value),
          text,
        );
      },
  );
});

describe('artist reply/activity server-rendered route shells', () => {
  it('lists owned artist links and the real parent menu', async () => {
    render(
      await ArtistReplyActivityMenu({ searchParams: Promise.resolve({}) }),
    );
    expect(mock.menu).toHaveBeenCalledWith(null);
    expect(
      screen.getByRole('link', { name: '가상 가수 답장과 활동 보기' }),
    ).toHaveAttribute('href', artistReplyActivityPath(artist.slug));
    expect(
      screen.getByRole('link', { name: messages.artistReplyActivity.back }),
    ).toHaveAttribute('href', routes.artist);
    expect(
      screen.queryByRole('link', {
        name: messages.artistReplyActivity.menuMore,
      }),
    ).not.toBeInTheDocument();
  });

  it('offers complete artist catalog pagination and a first-page link', async () => {
    mock.menu.mockResolvedValueOnce({
      ok: true,
      data: { artists: [artist], nextSlug: artist.slug },
    });
    render(
      await ArtistReplyActivityMenu({
        searchParams: Promise.resolve({ after: 'previous-artist' }),
      }),
    );
    expect(mock.menu).toHaveBeenCalledWith('previous-artist');
    expect(
      screen.getByRole('link', { name: messages.artistReplyActivity.menuMore }),
    ).toHaveAttribute('href', artistReplyActivityMenuPath(artist.slug));
    expect(
      screen.getByRole('link', {
        name: messages.artistReplyActivity.menuFirst,
      }),
    ).toHaveAttribute('href', routes.artistReplyActivityMenu);
  });

  it('shows an empty owned catalog without inventing a featured artist', async () => {
    mock.menu.mockResolvedValueOnce({
      ok: true,
      data: { artists: [], nextSlug: null },
    });
    render(
      await ArtistReplyActivityMenu({ searchParams: Promise.resolve({}) }),
    );
    expect(
      screen.getByText(messages.artistReplyActivity.menuEmpty),
    ).toBeVisible();
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('forwards duplicate menu parameters for service rejection', async () => {
    mock.menu.mockResolvedValueOnce({ ok: false, code: 'INVALID_INPUT' });
    render(
      await ArtistReplyActivityMenu({
        searchParams: Promise.resolve({ after: ['a', 'b'] }),
      }),
    );
    expect(mock.menu).toHaveBeenCalledWith(['a', 'b']);
    expect(mock.error).toHaveBeenCalledWith({ code: 'INVALID_INPUT' });
    expect(mock.translations).not.toHaveBeenCalled();
  });

  it('uses validated artist identity without sending reply bodies to cached client props', async () => {
    render(
      await ArtistReplyActivityPage({
        params: Promise.resolve({ slug: artist.slug }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(mock.page).toHaveBeenCalledWith(artist.slug, null, undefined);
    expect(mock.screen).toHaveBeenCalledWith({
      slug: artist.slug,
      name: artist.name,
      messageId: null,
      cursor: null,
    });
  });

  it('preserves validated message and cursor identity in the route screen', async () => {
    mock.page.mockResolvedValueOnce({
      ok: true,
      data: { artist, selectedMessage: message },
    });
    render(
      await ArtistReplyActivityPage({
        params: Promise.resolve({ slug: artist.slug }),
        searchParams: Promise.resolve({
          message: message.id,
          cursor: 'opaqueCursor',
        }),
      }),
    );
    expect(mock.page).toHaveBeenCalledWith(
      artist.slug,
      message.id,
      'opaqueCursor',
    );
    expect(mock.screen).toHaveBeenCalledWith({
      slug: artist.slug,
      name: artist.name,
      messageId: message.id,
      cursor: 'opaqueCursor',
    });
  });

  it('does not render a private screen when route authorization fails', async () => {
    mock.page.mockResolvedValueOnce({ ok: false, code: 'FORBIDDEN' });
    render(
      await ArtistReplyActivityPage({
        params: Promise.resolve({ slug: artist.slug }),
        searchParams: Promise.resolve({
          message: ['a', 'b'],
          cursor: ['a', 'b'],
        }),
      }),
    );
    expect(mock.page).toHaveBeenCalledWith(artist.slug, ['a', 'b'], ['a', 'b']);
    expect(mock.screen).not.toHaveBeenCalled();
    expect(mock.error).toHaveBeenCalledWith({ code: 'FORBIDDEN' });
  });
});
