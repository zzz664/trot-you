import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FanChat } from '@/components/fan/chat/FanChat';
import { ChatErrorScreen } from '@/components/fan/chat/ChatErrorScreen';
import { ChatLoading } from '@/components/fan/chat/ChatLoading';
import { chatDate } from '@/components/fan/chat/format';
import type {
  ChatError,
  ChatPage,
  ChatReadReceipt,
  ChatResult,
} from '@/config/chat';
import { routes } from '@/config/routes';
import messages from '@/messages/ko.json';
import {
  chatUiIds as ids,
  chatUiPage,
  chatUiMessage,
} from './chat-ui-fixtures';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  mark: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@/client/chat', () => ({
  readChatPage: mocks.read,
  markChatRead: mocks.mark,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));
vi.mock('@/components/media/SecureMedia', () => ({
  SecureMedia: ({
    mediaId,
    kind,
    preview,
  }: {
    mediaId: string;
    kind: string;
    preview: boolean;
  }) => (
    <div data-media-id={mediaId} data-preview={String(preview)}>
      {kind}
    </div>
  ),
}));
function subject(data = chatUiPage()) {
  return (
    <NextIntlClientProvider locale="ko" messages={messages} timeZone="UTC">
      <FanChat data={data} />
    </NextIntlClientProvider>
  );
}
function receipt(
  messageId = ids.first,
  count = 1,
): ChatResult<ChatReadReceipt> {
  return {
    ok: true,
    data: { messageId, readAt: '2026-10-24T01:03:00+00:00', readCount: count },
  };
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function count(value: number) {
  return messages.chat.readCount.replace('{count}', String(value));
}
let observers: {
  callback: IntersectionObserverCallback;
  target: Element | null;
  disconnect: () => void;
}[] = [];
function installObserver() {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      record: (typeof observers)[number];
      constructor(callback: IntersectionObserverCallback) {
        this.record = { callback, target: null, disconnect: vi.fn() };
        observers.push(this.record);
      }
      observe(target: Element) {
        this.record.target = target;
      }
      disconnect() {
        this.record.disconnect();
      }
    },
  );
}
function intersect(index: number, visible = true) {
  const entry = observers[index]!;
  entry.callback(
    [
      {
        target: entry.target!,
        isIntersecting: visible,
      } as IntersectionObserverEntry,
    ],
    {} as IntersectionObserver,
  );
}
beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', undefined);
  observers = [];
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.read.mockResolvedValue({
    ok: true,
    data: chatUiPage({ nextCursor: null }),
  });
  mocks.mark.mockImplementation(async ({ messageId }: { messageId: string }) =>
    receipt(messageId),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete document.documentElement.dataset.fontScale;
});

describe('fan chat readable personalized UI', () => {
  it.each(['normal', 'large', 'xlarge'])(
    'renders safe text and readable route actions at %s scale without composer',
    (scale) => {
      document.documentElement.dataset.fontScale = scale;
      const literal = '<img src=x onerror=alert(1)> $& {이름}\n줄바꿈';
      const view = render(
        subject(chatUiPage({ messages: [chatUiMessage({ text: literal })] })),
      );
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        '가상 가수 님의 대화방',
      );
      expect(
        view.container.querySelector('.chat-message-copy')?.textContent,
      ).toBe(literal);
      expect(
        view.container.querySelector('img, script, textarea, input'),
      ).toBeNull();
      expect(view.container.querySelector('time')).toHaveAttribute(
        'datetime',
        '2026-10-24T01:02:03.123456+00:00',
      );
      expect(
        screen.getByRole('link', { name: messages.chat.subscriptions }),
      ).toHaveAttribute('href', routes.subscriptions);
      expect(mocks.mark).not.toHaveBeenCalled();
      expect(mocks.read).not.toHaveBeenCalled();
      expect(screen.getByText(count(0))).toBeVisible();
    },
  );
  it('formats dates in Korean/KST while preserving original precise datetime', () => {
    expect(chatDate('2026-10-24T23:02:00+00:00')).toMatch(
      /2026년 10월 25일.*08:02/,
    );
  });
  it.each(['photo', 'voice', 'video'] as const)(
    'passes paid %s media only to accepted SecureMedia API',
    (kind) => {
      const view = render(
        subject(
          chatUiPage({
            messages: [
              chatUiMessage({
                kind,
                text: null,
                media: [{ id: ids.media, kind, availability: 'available' }],
              }),
            ],
          }),
        ),
      );
      expect(
        view.container.querySelector(`[data-media-id="${ids.media}"]`),
      ).toHaveAttribute('data-preview', 'false');
      expect(view.container.querySelector('.chat-message-copy')).toBeNull();
    },
  );
  it('has a truthful empty state with refresh but no older control', () => {
    render(subject(chatUiPage({ messages: [], nextCursor: null })));
    expect(
      screen.getByRole('heading', { name: messages.chat.emptyTitle }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: messages.chat.refresh }),
    ).toBeEnabled();
    expect(
      screen.queryByRole('button', { name: messages.chat.older }),
    ).not.toBeInTheDocument();
  });
  it('serializes repeated load-older clicks, appends without replacing existing message DOM, and dedupes', async () => {
    const pending = deferred<ChatResult<ChatPage>>();
    mocks.read.mockReturnValue(pending.promise);
    const view = render(subject());
    const existing = view.container.querySelector(
      `[data-message-id="${ids.first}"]`,
    );
    const button = screen.getByRole('button', { name: messages.chat.older });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith(
      { slug: 'fictional-singer', cursor: 'Y3Vyc29y' },
      expect.any(AbortSignal),
    );
    expect(button).toBeDisabled();
    await act(async () =>
      pending.resolve({
        ok: true,
        data: chatUiPage({
          messages: [
            chatUiMessage(),
            chatUiMessage({ id: ids.older, text: '이전 인사' }),
          ],
          nextCursor: null,
        }),
      }),
    );
    expect(
      view.container.querySelector(`[data-message-id="${ids.first}"]`),
    ).toBe(existing);
    expect(
      view.container.querySelectorAll(`[data-message-id="${ids.first}"]`),
    ).toHaveLength(1);
    expect(screen.getByText('이전 인사')).toBeVisible();
    expect(screen.getByText(messages.chat.end)).toBeVisible();
  });
  it('retries the failed older cursor without discarding first-page content', async () => {
    mocks.read.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
    render(subject());
    await userEvent.click(
      screen.getByRole('button', { name: messages.chat.older }),
    );
    expect(screen.getByText('순자 님, 반가워요.')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(
      messages.chat.errors.UNAVAILABLE,
    );
    await userEvent.click(
      screen.getByRole('button', { name: messages.ui.retry }),
    );
    expect(mocks.read.mock.calls[1]?.[0]).toEqual({
      slug: 'fictional-singer',
      cursor: 'Y3Vyc29y',
    });
  });
  it('retries a failed latest refresh as first page even when an older cursor exists', async () => {
    mocks.read.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
    render(subject());
    await userEvent.click(
      screen.getByRole('button', { name: messages.chat.refresh }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: messages.ui.retry }),
    );
    expect(mocks.read.mock.calls[1]?.[0]).toEqual({ slug: 'fictional-singer' });
  });
  it('does not optimistically increment read marks and serializes double clicks', async () => {
    const pending = deferred<ChatResult<ChatReadReceipt>>();
    mocks.mark.mockReturnValue(pending.promise);
    render(subject());
    const button = screen.getByRole('button', { name: messages.chat.markRead });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mocks.mark).toHaveBeenCalledTimes(1);
    expect(screen.getByText(count(0))).toBeVisible();
    expect(
      screen.queryByText(messages.chat.read, { exact: true }),
    ).not.toBeInTheDocument();
    await act(async () => pending.resolve(receipt()));
    expect(screen.getByText(count(1))).toBeVisible();
    expect(screen.getByText(messages.chat.read, { exact: true })).toBeVisible();
    expect(
      screen.queryByRole('button', { name: messages.chat.markRead }),
    ).not.toBeInTheDocument();
  });
  it('keeps server count monotonic across out-of-order read receipts then accepts lower authoritative refresh', async () => {
    const first = deferred<ChatResult<ChatReadReceipt>>();
    const second = deferred<ChatResult<ChatReadReceipt>>();
    mocks.mark
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    render(
      subject(
        chatUiPage({
          messages: [
            chatUiMessage(),
            chatUiMessage({ id: ids.second, text: '두 번째' }),
          ],
        }),
      ),
    );
    const buttons = screen.getAllByRole('button', {
      name: messages.chat.markRead,
    });
    fireEvent.click(buttons[0]!);
    fireEvent.click(buttons[1]!);
    await act(async () => second.resolve(receipt(ids.second, 2)));
    await act(async () => first.resolve(receipt(ids.first, 1)));
    expect(screen.getByText(count(2))).toBeVisible();
    mocks.read.mockResolvedValue({
      ok: true,
      data: chatUiPage({ messages: [], readCount: 0, nextCursor: null }),
    });
    await userEvent.click(
      screen.getByRole('button', { name: messages.chat.refresh }),
    );
    expect(screen.getByText(count(0))).toBeVisible();
  });
  it('offers explicit idempotent retry after a lost read response and never loops automatically', async () => {
    mocks.mark.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
    render(subject());
    await userEvent.click(
      screen.getByRole('button', { name: messages.chat.markRead }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      messages.chat.readFailed,
    );
    expect(mocks.mark).toHaveBeenCalledTimes(1);
    await userEvent.click(
      screen.getByRole('button', { name: messages.chat.retryRead }),
    );
    expect(mocks.mark).toHaveBeenCalledTimes(2);
    expect(screen.getByText(count(1))).toBeVisible();
  });
  it('only automatically marks an intersecting message, not SSR/offscreen siblings', async () => {
    installObserver();
    render(
      subject(
        chatUiPage({
          messages: [chatUiMessage(), chatUiMessage({ id: ids.second })],
        }),
      ),
    );
    expect(mocks.mark).not.toHaveBeenCalled();
    await act(async () => intersect(0, false));
    expect(mocks.mark).not.toHaveBeenCalled();
    await act(async () => intersect(0));
    expect(mocks.mark).toHaveBeenCalledExactlyOnceWith(
      { slug: 'fictional-singer', messageId: ids.first },
      expect.any(AbortSignal),
    );
    await act(async () => intersect(0));
    expect(mocks.mark).toHaveBeenCalledTimes(1);
  });
  it('waits for visible document before automatically marking an intersecting card', async () => {
    installObserver();
    const visibility = vi
      .spyOn(document, 'visibilityState', 'get')
      .mockReturnValue('hidden');
    render(subject());
    await act(async () => intersect(0));
    expect(mocks.mark).not.toHaveBeenCalled();
    visibility.mockReturnValue('visible');
    await act(async () =>
      document.dispatchEvent(new Event('visibilitychange')),
    );
    expect(mocks.mark).toHaveBeenCalledTimes(1);
  });
  it.each([
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'SUBSCRIPTION_REQUIRED',
    'PROFILE_REQUIRED',
    'NOT_FOUND',
  ] as const)(
    'clears private data after terminal %s response',
    async (code) => {
      mocks.read.mockResolvedValue({ ok: false, code });
      render(subject());
      await userEvent.click(
        screen.getByRole('button', { name: messages.chat.older }),
      );
      expect(screen.queryByText('순자 님, 반가워요.')).not.toBeInTheDocument();
      expect(screen.queryByText(count(0))).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent(
        messages.chat.errors[code],
      );
      if (code === 'UNAUTHENTICATED')
        expect(
          screen.getByRole('link', { name: messages.chat.signIn }),
        ).toHaveAttribute('href', routes.start);
    },
  );
  it('clears messages after a successful access-loss projection or rejected readmark', async () => {
    mocks.read.mockResolvedValue({
      ok: true,
      data: chatUiPage({
        hasAccess: false,
        messages: [],
        readCount: 0,
        nextCursor: null,
      }),
    });
    const view = render(subject());
    await userEvent.click(
      screen.getByRole('button', { name: messages.chat.refresh }),
    );
    expect(screen.queryByText('순자 님, 반가워요.')).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: messages.chat.preview }),
    ).toBeVisible();
    view.unmount();
    mocks.mark.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    render(subject());
    await userEvent.click(
      screen.getByRole('button', { name: messages.chat.markRead }),
    );
    expect(screen.queryByText('순자 님, 반가워요.')).not.toBeInTheDocument();
  });
  it('aborts pending read and pagination on newer artist navigation; late results cannot resurrect old room', async () => {
    const pending = deferred<ChatResult<ChatPage>>();
    mocks.read.mockReturnValue(pending.promise);
    const view = render(subject());
    await userEvent.click(
      screen.getByRole('button', { name: messages.chat.older }),
    );
    const signal = mocks.read.mock.calls[0]?.[1] as AbortSignal;
    view.rerender(
      subject(
        chatUiPage({
          artist: { slug: 'new-singer', name: '다음 가수', description: null },
          messages: [],
        }),
      ),
    );
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve({ ok: true, data: chatUiPage() }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      '다음 가수',
    );
    expect(screen.queryByText('순자 님, 반가워요.')).not.toBeInTheDocument();
  });
  it('same-slug authoritative RSC props replace old content and invalidate late receipts', async () => {
    const pending = deferred<ChatResult<ChatReadReceipt>>();
    mocks.mark.mockReturnValue(pending.promise);
    const view = render(subject());
    await userEvent.click(
      screen.getByRole('button', { name: messages.chat.markRead }),
    );
    const signal = mocks.mark.mock.calls[0]?.[1] as AbortSignal;
    view.rerender(
      subject(
        chatUiPage({
          messages: [chatUiMessage({ id: ids.second, text: '새 서버 화면' })],
          readCount: 5,
        }),
      ),
    );
    expect(signal.aborted).toBe(true);
    expect(screen.queryByText('순자 님, 반가워요.')).not.toBeInTheDocument();
    await act(async () => pending.resolve(receipt(ids.first, 10)));
    expect(screen.getByText('새 서버 화면')).toBeVisible();
    expect(screen.getByText(count(5))).toBeVisible();
  });
  it('latest refresh resets automatic observation after aborting a prior unread attempt', async () => {
    installObserver();
    const pending = deferred<ChatResult<ChatReadReceipt>>();
    mocks.mark.mockReturnValueOnce(pending.promise);
    render(subject());
    await act(async () => intersect(0));
    const signal = mocks.mark.mock.calls[0]?.[1] as AbortSignal;
    await userEvent.click(
      screen.getByRole('button', { name: messages.chat.refresh }),
    );
    expect(signal.aborted).toBe(true);
    await act(async () => intersect(observers.length - 1));
    expect(mocks.mark).toHaveBeenCalledTimes(2);
    expect(screen.getByText(count(1))).toBeVisible();
    await act(async () => pending.resolve(receipt(ids.first, 20)));
    expect(screen.getByText(count(1))).toBeVisible();
  });
  it('refresh invalidates pending receipts instead of applying stale counts to new first page', async () => {
    const pending = deferred<ChatResult<ChatReadReceipt>>();
    mocks.mark.mockReturnValue(pending.promise);
    render(subject());
    await userEvent.click(
      screen.getByRole('button', { name: messages.chat.markRead }),
    );
    const signal = mocks.mark.mock.calls[0]?.[1] as AbortSignal;
    await userEvent.click(
      screen.getByRole('button', { name: messages.chat.refresh }),
    );
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(receipt(ids.first, 9)));
    expect(screen.getByText(count(0))).toBeVisible();
  });
  it('unmount aborts without replay and back action clears room before route replacement', async () => {
    const pending = deferred<ChatResult<ChatReadReceipt>>();
    mocks.mark.mockReturnValue(pending.promise);
    const view = render(subject());
    await userEvent.click(
      screen.getByRole('button', { name: messages.chat.markRead }),
    );
    const signal = mocks.mark.mock.calls[0]?.[1] as AbortSignal;
    await userEvent.click(
      screen.getByRole('button', { name: messages.ui.back }),
    );
    expect(signal.aborted).toBe(true);
    expect(mocks.replace).toHaveBeenCalledWith(routes.artists);
    expect(screen.queryByText('순자 님, 반가워요.')).not.toBeInTheDocument();
    view.unmount();
    await act(async () => pending.resolve(receipt()));
    expect(mocks.mark).toHaveBeenCalledTimes(1);
  });
  it('history navigation replaces stale private data with a new authoritative fetch', async () => {
    mocks.read.mockResolvedValue({ ok: false, code: 'UNAUTHENTICATED' });
    render(subject());
    await act(async () => window.dispatchEvent(new PopStateEvent('popstate')));
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith(
      { slug: 'fictional-singer' },
      expect.any(AbortSignal),
    );
    expect(screen.queryByText('순자 님, 반가워요.')).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: messages.chat.signIn }),
    ).toBeVisible();
  });
  it('pagehide clears private text and bfcache restore revalidates', async () => {
    render(subject());
    act(() =>
      window.dispatchEvent(
        new PageTransitionEvent('pagehide', { persisted: true }),
      ),
    );
    expect(screen.queryByText('순자 님, 반가워요.')).not.toBeInTheDocument();
    await act(async () =>
      window.dispatchEvent(
        new PageTransitionEvent('pageshow', { persisted: true }),
      ),
    );
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(screen.getByText('순자 님, 반가워요.')).toBeVisible();
  });
  it('renders standalone loading and all documented error screens', () => {
    const view = render(
      <NextIntlClientProvider locale="ko" messages={messages}>
        <ChatLoading />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent(messages.chat.loading);
    for (const code of Object.keys(messages.chat.errors) as ChatError[]) {
      view.rerender(
        <NextIntlClientProvider locale="ko" messages={messages}>
          <ChatErrorScreen code={code} slug="fictional-singer" />
        </NextIntlClientProvider>,
      );
      expect(screen.getByRole('alert')).toHaveTextContent(
        messages.chat.errors[code],
      );
      expect(
        within(screen.getByRole('main')).getByRole('button', {
          name: messages.ui.retry,
        }),
      ).toBeEnabled();
    }
  });
});
