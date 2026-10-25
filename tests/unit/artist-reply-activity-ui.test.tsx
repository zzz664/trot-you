import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArtistReplyActivityScreen } from '@/components/artist-reply-activity/ArtistReplyActivityScreen';
import { ArtistReplyActivityErrorScreen } from '@/components/artist-reply-activity/ArtistReplyActivityErrorScreen';
import type {
  ArtistReplyActivityMessages,
  ArtistReplyActivityPage,
} from '@/config/artist-reply-activity';
import { artistReplyActivityPath, routes } from '@/config/routes';
import messages from '@/messages/ko.json';

const mock = vi.hoisted(() => ({
  read: vi.fn(),
  messages: vi.fn(),
  refresh: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock('@/client/artist-reply-activity', () => ({
  readArtistReplyActivityPage: mock.read,
  readArtistReplyActivityMessages: mock.messages,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mock.refresh }),
}));
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch,
    onNavigate,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    children: ReactNode;
    href: string;
    prefetch?: boolean;
    onNavigate?: () => void;
  }) => (
    <a
      {...props}
      data-prefetch={String(prefetch)}
      href={href}
      onClick={(event) => {
        event.preventDefault();
        onNavigate?.();
        mock.navigate(href);
      }}
    >
      {children}
    </a>
  ),
}));
const copy = messages.artistReplyActivity;
const artist = {
  id: '2c166408-cb22-4be2-950d-77b4983e2001',
  slug: 'fictional-activity',
  name: '가상 가수',
};
const selectedMessage = {
  id: '2c166408-cb22-4be2-950d-77b4983e2002',
  kind: 'text' as const,
  sentAt: '2026-10-20T01:00:00Z',
};
const secondMessage = {
  id: '2c166408-cb22-4be2-950d-77b4983e2003',
  kind: 'photo' as const,
  sentAt: '2026-10-19T01:00:00Z',
};
function page(overrides: Partial<ArtistReplyActivityPage> = {}) {
  return {
    artist,
    serverNow: '2026-10-25T01:00:00Z',
    activity: {
      weekStart: '2026-10-19',
      weekEnd: '2026-10-26',
      messageCount: 3,
      photoCount: 1,
      weeklyMessageMin: 3,
      weeklyPhotoMin: 2,
      requirementsReady: true,
    },
    replies: [
      {
        id: '2c166408-cb22-4be2-950d-77b4983e2004',
        callName: '가상 호칭',
        body: '가상 답장 내용',
        createdAt: '2026-10-20T02:00:00Z',
        messageId: null,
      },
    ],
    selectedMessage: null,
    hasMore: false,
    nextCursor: null,
    ...overrides,
  } satisfies ArtistReplyActivityPage;
}
function picker(overrides: Partial<ArtistReplyActivityMessages> = {}) {
  return {
    artist,
    messages: [selectedMessage],
    hasMore: false,
    nextCursor: null,
    ...overrides,
  } satisfies ArtistReplyActivityMessages;
}
function subject(
  messageId: string | null = null,
  cursor: string | null = null,
) {
  return (
    <NextIntlClientProvider locale="ko" messages={messages} timeZone="UTC">
      <ArtistReplyActivityScreen
        slug={artist.slug}
        name={artist.name}
        messageId={messageId}
        cursor={cursor}
      />
    </NextIntlClientProvider>
  );
}
async function ready() {
  await screen.findByText('가상 답장 내용');
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  Object.values(mock).forEach((fn) => fn.mockReset());
  window.history.replaceState({}, '', artistReplyActivityPath(artist.slug));
  mock.read.mockResolvedValue({ ok: true, data: page() });
  mock.messages.mockResolvedValue({ ok: true, data: picker() });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete document.documentElement.dataset.fontScale;
});

describe('artist received replies and activity UI', () => {
  it.each(['normal', 'large', 'xlarge'])(
    'renders calling-name-only replies and honest current-week metrics at %s scale',
    async (scale) => {
      document.documentElement.dataset.fontScale = scale;
      render(subject());
      await ready();
      expect(
        screen.getByRole('heading', { name: '가상 호칭 님의 답장' }),
      ).toBeVisible();
      const activity = screen.getByRole('region', { name: copy.activityTitle });
      expect(activity).toHaveTextContent('3회 / 주간 기준 3회');
      expect(activity).toHaveTextContent('1회 / 주간 기준 2회');
      expect(activity).toHaveTextContent(
        '2026년 10월 19일 0시부터 2026년 10월 26일 0시 전까지',
      );
      expect(activity).toHaveTextContent(copy.activityNotice);
      expect(activity).toHaveTextContent(copy.activityProvisional);
      expect(screen.getByText(copy.privacyNotice)).toBeVisible();
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(screen.queryByText(artist.id)).not.toBeInTheDocument();
      expect(mock.read).toHaveBeenCalledWith(
        { slug: artist.slug, messageId: null },
        expect.any(AbortSignal),
      );
      expect(mock.messages).toHaveBeenCalledWith(
        { slug: artist.slug },
        expect.any(AbortSignal),
      );
    },
  );

  it('keeps message choices collapsed and supports an accessible close/reopen without a new read', async () => {
    const user = userEvent.setup();
    render(subject());
    await ready();
    const open = screen.getByRole('button', { name: copy.openMessages });
    expect(open).toHaveAttribute('aria-expanded', 'false');
    const controlledId = open.getAttribute('aria-controls')!;
    expect(document.getElementById(controlledId)).not.toBeVisible();
    expect(
      document.querySelector('[data-activity-message-id]'),
    ).not.toBeInTheDocument();
    await user.click(open);
    const close = screen.getByRole('button', { name: copy.closeMessages });
    expect(close).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(controlledId)).toBeVisible();
    expect(document.querySelector('[data-activity-message-id]')).toBeVisible();
    await user.click(close);
    expect(
      document.querySelector('[data-activity-message-id]'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('가상 답장 내용')).toBeVisible();
    await user.click(screen.getByRole('button', { name: copy.openMessages }));
    expect(document.querySelector('[data-activity-message-id]')).toBeVisible();
    expect(mock.read).toHaveBeenCalledOnce();
    expect(mock.messages).toHaveBeenCalledOnce();
  });

  it('does not invent a threshold when approved contract requirements are unavailable', async () => {
    mock.read.mockResolvedValueOnce({
      ok: true,
      data: page({
        activity: {
          ...page().activity,
          weeklyMessageMin: null,
          weeklyPhotoMin: null,
          requirementsReady: false,
        },
      }),
    });
    render(subject());
    await ready();
    const activity = screen.getByRole('region', { name: copy.activityTitle });
    expect(activity).toHaveTextContent(copy.requirementsUnavailable);
    expect(activity).not.toHaveTextContent('주간 기준');
    expect(
      activity.querySelector('[data-activity-metric="message"]'),
    ).toHaveTextContent('3회');
  });

  it('shows a true empty feed and empty message picker', async () => {
    mock.read.mockResolvedValueOnce({ ok: true, data: page({ replies: [] }) });
    mock.messages.mockResolvedValueOnce({
      ok: true,
      data: picker({ messages: [] }),
    });
    render(subject());
    expect(await screen.findByText(copy.repliesEmpty)).toBeVisible();
    await userEvent.click(
      screen.getByRole('button', { name: copy.openMessages }),
    );
    expect(screen.getByText(copy.noMessages)).toBeVisible();
    expect(
      screen.queryByRole('link', { name: copy.moreReplies }),
    ).not.toBeInTheDocument();
  });

  it('links to a message filter and clears current content before navigation', async () => {
    const user = userEvent.setup();
    render(subject());
    await ready();
    await user.click(screen.getByRole('button', { name: copy.openMessages }));
    const item = document.querySelector(
      `[data-activity-message-id="${selectedMessage.id}"]`,
    )!;
    const link = within(item as HTMLElement).getByRole('link');
    expect(link).toHaveAttribute(
      'href',
      artistReplyActivityPath(artist.slug, selectedMessage.id),
    );
    await user.click(link);
    expect(mock.navigate).toHaveBeenCalledWith(
      artistReplyActivityPath(artist.slug, selectedMessage.id),
    );
    expect(screen.queryByText('가상 답장 내용')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: copy.activityTitle }),
    ).not.toBeInTheDocument();
  });

  it('preserves message filter in reply pagination and offers all/first links', async () => {
    const cursor = 'olderReplies';
    window.history.replaceState(
      {},
      '',
      artistReplyActivityPath(artist.slug, selectedMessage.id, cursor),
    );
    mock.read.mockResolvedValueOnce({
      ok: true,
      data: page({
        selectedMessage,
        replies: [{ ...page().replies[0]!, messageId: selectedMessage.id }],
        hasMore: true,
        nextCursor: 'nextReplies',
      }),
    });
    render(subject(selectedMessage.id, cursor));
    await ready();
    expect(screen.getByRole('link', { name: copy.allReplies })).toHaveAttribute(
      'href',
      artistReplyActivityPath(artist.slug),
    );
    expect(
      screen.getByRole('link', { name: copy.moreReplies }),
    ).toHaveAttribute(
      'href',
      artistReplyActivityPath(artist.slug, selectedMessage.id, 'nextReplies'),
    );
    expect(
      screen.getByRole('link', { name: copy.firstReplies }),
    ).toHaveAttribute(
      'href',
      artistReplyActivityPath(artist.slug, selectedMessage.id),
    );
    await userEvent.click(
      screen.getByRole('button', { name: copy.openMessages }),
    );
    expect(document.querySelector('[aria-current="true"]')).toBeVisible();
    expect(mock.read).toHaveBeenCalledWith(
      { slug: artist.slug, messageId: selectedMessage.id, cursor },
      expect.any(AbortSignal),
    );
  });

  it('distinguishes an empty selected-message feed from the full feed', async () => {
    window.history.replaceState(
      {},
      '',
      artistReplyActivityPath(artist.slug, selectedMessage.id),
    );
    mock.read.mockResolvedValueOnce({
      ok: true,
      data: page({ selectedMessage, replies: [] }),
    });
    render(subject(selectedMessage.id));
    expect(await screen.findByText(copy.filteredEmpty)).toBeVisible();
    expect(screen.queryByText(copy.repliesEmpty)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: copy.allReplies })).toBeVisible();
  });

  it('fully paginates sent-message choices, revalidates replies, and returns to recent messages', async () => {
    mock.messages.mockResolvedValueOnce({
      ok: true,
      data: picker({ hasMore: true, nextCursor: 'olderMessages' }),
    });
    const user = userEvent.setup();
    render(subject());
    await ready();
    mock.messages.mockResolvedValueOnce({
      ok: true,
      data: picker({ messages: [secondMessage] }),
    });
    await user.click(screen.getByRole('button', { name: copy.openMessages }));
    await user.click(screen.getByRole('button', { name: copy.olderMessages }));
    await waitFor(() =>
      expect(
        document.querySelector(
          `[data-activity-message-id="${secondMessage.id}"]`,
        ),
      ).toBeVisible(),
    );
    expect(mock.messages).toHaveBeenLastCalledWith(
      { slug: artist.slug, cursor: 'olderMessages' },
      expect.any(AbortSignal),
    );
    expect(mock.read).toHaveBeenCalledTimes(2);
    expect(
      document.querySelector(
        `[data-activity-message-id="${selectedMessage.id}"]`,
      ),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: copy.firstMessages }));
    await waitFor(() =>
      expect(
        document.querySelector(
          `[data-activity-message-id="${selectedMessage.id}"]`,
        ),
      ).toBeVisible(),
    );
    expect(mock.messages).toHaveBeenLastCalledWith(
      { slug: artist.slug },
      expect.any(AbortSignal),
    );
  });

  it.each(['FORBIDDEN', 'UNAUTHENTICATED', 'UNAVAILABLE'] as const)(
    'clears replies, activity and picker when refresh returns %s',
    async (code) => {
      const user = userEvent.setup();
      render(subject());
      await ready();
      mock.read.mockResolvedValueOnce({ ok: false, code });
      await user.click(screen.getByRole('button', { name: copy.refresh }));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(
        code === 'UNAVAILABLE' ? copy.errors.UNAVAILABLE : copy.accessLost,
      );
      expect(screen.queryByText('가상 답장 내용')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('region', { name: copy.activityTitle }),
      ).not.toBeInTheDocument();
      expect(
        document.querySelector('[data-activity-message-id]'),
      ).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: messages.ui.retry }));
      await ready();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    },
  );

  it('also clears the feed if the independently loaded message picker fails', async () => {
    const user = userEvent.setup();
    render(subject());
    await ready();
    mock.messages.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
    await user.click(screen.getByRole('button', { name: copy.refresh }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      copy.errors.UNAVAILABLE,
    );
    expect(screen.queryByText('가상 답장 내용')).not.toBeInTheDocument();
  });

  it('aborts an older refresh and never restores its replies after a newer response', async () => {
    const user = userEvent.setup();
    render(subject());
    await ready();
    const older = deferred<{ ok: true; data: ArtistReplyActivityPage }>();
    mock.read.mockReturnValueOnce(older.promise);
    await user.click(screen.getByRole('button', { name: copy.refresh }));
    const signal = mock.read.mock.calls.at(-1)![1] as AbortSignal;
    expect(screen.queryByText('가상 답장 내용')).not.toBeInTheDocument();
    mock.read.mockResolvedValueOnce({
      ok: true,
      data: page({
        replies: [{ ...page().replies[0]!, body: '더 새로운 가상 답장' }],
      }),
    });
    await user.click(screen.getByRole('button', { name: copy.refresh }));
    expect(await screen.findByText('더 새로운 가상 답장')).toBeVisible();
    expect(signal.aborted).toBe(true);
    await act(async () => older.resolve({ ok: true, data: page() }));
    expect(screen.queryByText('가상 답장 내용')).not.toBeInTheDocument();
  });

  it('aborts pending reads before following the artist-menu link', async () => {
    const older = deferred<{ ok: true; data: ArtistReplyActivityPage }>();
    mock.read.mockReturnValueOnce(older.promise);
    const user = userEvent.setup();
    render(subject());
    await waitFor(() => expect(mock.read).toHaveBeenCalledOnce());
    const signal = mock.read.mock.calls[0]![1] as AbortSignal;
    await user.click(screen.getByRole('link', { name: copy.backToArtists }));
    expect(mock.navigate).toHaveBeenCalledWith(routes.artistReplyActivityMenu);
    expect(signal.aborted).toBe(true);
    await act(async () => older.resolve({ ok: true, data: page() }));
    expect(screen.queryByText('가상 답장 내용')).not.toBeInTheDocument();
  });

  it('clears on browser departure and reloads when Back returns to its exact URL', async () => {
    render(subject());
    await ready();
    act(() => {
      window.history.replaceState({}, '', routes.artistReplyActivityMenu);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.queryByText('가상 답장 내용')).not.toBeInTheDocument();
    expect(mock.read).toHaveBeenCalledOnce();
    act(() => {
      window.history.replaceState({}, '', artistReplyActivityPath(artist.slug));
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await ready();
    expect(mock.read).toHaveBeenCalledTimes(2);
  });

  it('clears on pagehide and revalidates a persisted pageshow', async () => {
    render(subject());
    await ready();
    act(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    expect(screen.queryByText('가상 답장 내용')).not.toBeInTheDocument();
    act(() =>
      window.dispatchEvent(
        new PageTransitionEvent('pageshow', { persisted: true }),
      ),
    );
    await ready();
    expect(mock.read).toHaveBeenCalledTimes(2);
  });

  it('aborts reads on unmount without applying late results', async () => {
    const older = deferred<{ ok: true; data: ArtistReplyActivityPage }>();
    mock.read.mockReturnValueOnce(older.promise);
    const result = render(subject());
    await waitFor(() => expect(mock.read).toHaveBeenCalledOnce());
    const signal = mock.read.mock.calls[0]![1] as AbortSignal;
    result.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => older.resolve({ ok: true, data: page() }));
    expect(screen.queryByText('가상 답장 내용')).not.toBeInTheDocument();
  });

  it('offers real route refresh and menu navigation on an initial error screen', async () => {
    const user = userEvent.setup();
    render(
      <NextIntlClientProvider locale="ko" messages={messages} timeZone="UTC">
        <ArtistReplyActivityErrorScreen code="SETUP_NOT_READY" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      copy.errors.SETUP_NOT_READY,
    );
    await user.click(screen.getByRole('button', { name: messages.ui.retry }));
    expect(mock.refresh).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('link', { name: copy.back }));
    expect(mock.navigate).toHaveBeenCalledWith(routes.artist);
  });
});
