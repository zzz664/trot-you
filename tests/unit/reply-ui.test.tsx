import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FanReplies } from '@/components/fan/replies/FanReplies';
import { FanChat } from '@/components/fan/chat/FanChat';
import type {
  ReplyPage,
  ReplyReceipt,
  ReplyResult,
  ReplyWriteInput,
} from '@/config/replies';
import messages from '@/messages/ko.json';
import { routes } from '@/config/routes';
import {
  ownReply,
  replyUiPage,
  replyUiIds as ids,
  replyUiSlug as slug,
} from './reply-ui-fixtures';
import { chatUiPage } from './chat-ui-fixtures';
const mock = vi.hoisted(() => ({
  read: vi.fn(),
  send: vi.fn(),
  lost: vi.fn(),
  chat: vi.fn(),
  mark: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@/client/replies', () => ({
  readReplyPage: mock.read,
  sendReply: mock.send,
}));
vi.mock('@/client/chat', () => ({
  readChatPage: mock.chat,
  markChatRead: mock.mark,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mock.replace, refresh: mock.refresh }),
}));
vi.mock('@/components/media/SecureMedia', () => ({ SecureMedia: () => null }));
function subject(room = false) {
  return (
    <NextIntlClientProvider locale="ko" messages={messages} timeZone="UTC">
      {room ? (
        <FanChat data={chatUiPage()} />
      ) : (
        <FanReplies slug={slug} onAccessLost={mock.lost} />
      )}
    </NextIntlClientProvider>
  );
}
function defer<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function start(room = false) {
  const view = render(subject(room));
  await screen.findByRole('textbox', { name: messages.replies.label });
  return view;
}
const textbox = () =>
  screen.getByRole('textbox', { name: messages.replies.label });
const sendButton = () =>
  screen.getByRole('button', { name: messages.replies.send });
function accepted(input: ReplyWriteInput): ReplyResult<ReplyReceipt> {
  return {
    ok: true,
    data: {
      slug: input.slug,
      reply: ownReply({
        operationId: input.operationId,
        body: input.body,
        messageId: input.messageId,
      }),
    },
  };
}
beforeEach(() => {
  Object.values(mock).forEach((fn) => fn.mockReset());
  mock.read.mockResolvedValue({ ok: true, data: replyUiPage() });
  mock.send.mockImplementation(async (input: ReplyWriteInput) =>
    accepted(input),
  );
  mock.chat.mockResolvedValue({ ok: true, data: chatUiPage() });
  mock.mark.mockResolvedValue({ ok: false, code: 'UNAVAILABLE' });
  vi.stubGlobal('IntersectionObserver', undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete document.documentElement.dataset.fontScale;
});
describe('actual fan reply composer', () => {
  it.each(['normal', 'large', 'xlarge'])(
    'shows accessible fields and personal history at %s scale',
    async (scale) => {
      document.documentElement.dataset.fontScale = scale;
      const text = '<img src=x onerror=alert(1)> {이름}\n둘째 줄';
      mock.read.mockResolvedValue({
        ok: true,
        data: replyUiPage({
          replies: [
            ownReply({ body: text }),
            ownReply({ id: ids.second, blocked: true, body: null }),
          ],
        }),
      });
      const view = await start();
      expect(textbox()).toHaveAccessibleDescription('0 / 100자');
      expect(textbox()).toHaveValue('');
      expect(
        screen.getByRole('list', { name: messages.replies.history }),
      ).toBeVisible();
      expect(view.container.querySelector('.reply-body')?.textContent).toBe(
        text,
      );
      expect(view.container.querySelector('img, script')).toBeNull();
      expect(screen.getByText(messages.replies.blocked)).toBeVisible();
      expect(view.container.querySelector('time')).toHaveAttribute(
        'datetime',
        '2026-10-24T02:03:04.123456+00:00',
      );
      expect(screen.getByText(messages.replies.end)).toBeVisible();
      expect(sendButton()).toBeEnabled();
    },
  );
  it('shows loading text without inventing a configured composer', async () => {
    const wait = defer<ReplyResult<ReplyPage>>();
    mock.read.mockReturnValue(wait.promise);
    render(subject());
    expect(screen.getByRole('status')).toHaveTextContent(
      messages.replies.loading,
    );
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await act(async () =>
      wait.resolve({
        ok: true,
        data: replyUiPage({ sendReady: false, replies: [ownReply()] }),
      }),
    );
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: messages.replies.send }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(messages.replies.unavailable)).toBeVisible();
    expect(screen.getByText('항상 응원해요.')).toBeVisible();
  });
  it('submits from the real chat composition without changing read counts', async () => {
    await start(true);
    fireEvent.change(textbox(), { target: { value: '언제나 고마워요.' } });
    fireEvent.click(sendButton());
    await screen.findByText(messages.replies.sent);
    expect(mock.send).toHaveBeenCalledOnce();
    expect(mock.send.mock.calls[0]![0]).toMatchObject({
      slug,
      body: '언제나 고마워요.',
      messageId: null,
    });
    expect(mock.send.mock.calls[0]![0].operationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      screen.getByText(messages.chat.readCount.replace('{count}', '0')),
    ).toBeVisible();
    expect(textbox()).toHaveValue('');
    expect(screen.getByText('언제나 고마워요.')).toBeVisible();
  });
  it('supports keyboard form submission', async () => {
    const view = await start();
    fireEvent.change(textbox(), { target: { value: '키보드 답장' } });
    fireEvent.submit(view.container.querySelector('form')!);
    await screen.findByText(messages.replies.sent);
    expect(mock.send).toHaveBeenCalledOnce();
  });
  it('preserves spaces and newlines in the immutable submitted body', async () => {
    await start();
    const body = '  좋은 노래예요.\n고맙습니다.  ';
    fireEvent.change(textbox(), { target: { value: body } });
    fireEvent.click(sendButton());
    await screen.findByText(messages.replies.sent);
    expect(mock.send.mock.calls[0]![0].body).toBe(body);
    expect(document.querySelector('.reply-body')?.textContent).toBe(body);
  });
  it.each(['', '  ', '\n\t'])(
    'rejects blank draft %j without sending',
    async (body) => {
      await start();
      fireEvent.change(textbox(), { target: { value: body } });
      fireEvent.click(sendButton());
      expect(screen.getByRole('alert')).toHaveTextContent(
        messages.replies.errors.INVALID_INPUT,
      );
      expect(mock.send).not.toHaveBeenCalled();
      expect(textbox()).toHaveValue(body.replace(/\r/g, ''));
    },
  );
  it('counts Unicode scalars and enforces configured maximum without truncation', async () => {
    mock.read.mockResolvedValue({
      ok: true,
      data: replyUiPage({ maxLength: 2 }),
    });
    await start();
    fireEvent.change(textbox(), { target: { value: '😀😀😀' } });
    expect(textbox()).toHaveAccessibleDescription('3 / 2자');
    fireEvent.click(sendButton());
    expect(screen.getByRole('alert')).toHaveTextContent(
      messages.replies.errors.TOO_LONG,
    );
    expect(textbox()).toHaveAttribute('aria-invalid', 'true');
    expect(textbox()).toHaveAccessibleDescription(
      expect.stringContaining(messages.replies.errors.TOO_LONG),
    );
    expect(mock.send).not.toHaveBeenCalled();
    expect(textbox()).toHaveValue('😀😀😀');
    fireEvent.change(textbox(), { target: { value: '😀😀' } });
    fireEvent.click(sendButton());
    await screen.findByText(messages.replies.sent);
    expect(mock.send.mock.calls[0]![0].body).toBe('😀😀');
  });
  it('retains drafts on close/reopen and a harmless history refresh', async () => {
    await start();
    await userEvent.type(textbox(), '작성 중인 답장');
    fireEvent.click(
      screen.getByRole('button', { name: messages.replies.close }),
    );
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: messages.replies.refresh }),
    );
    await screen.findByRole('button', { name: messages.replies.refresh });
    fireEvent.click(
      screen.getByRole('button', { name: messages.replies.open }),
    );
    expect(textbox()).toHaveValue('작성 중인 답장');
    expect(mock.send).not.toHaveBeenCalled();
  });
  it.each([
    'INVALID_INPUT',
    'FORBIDDEN_CONTENT',
    'TOO_LONG',
    'RATE_LIMITED',
    'SETUP_NOT_READY',
  ] as const)(
    'preserves rejected draft and permits deliberate correction for %s',
    async (code) => {
      mock.send.mockResolvedValueOnce({ ok: false, code });
      await start();
      fireEvent.change(textbox(), { target: { value: '첫 내용' } });
      fireEvent.click(sendButton());
      await screen.findByRole('alert');
      expect(textbox()).toHaveValue('첫 내용');
      expect(textbox()).not.toHaveAttribute('readonly');
      expect(screen.getByRole('alert')).toHaveTextContent(
        messages.replies.errors[code],
      );
      fireEvent.change(textbox(), { target: { value: '수정 내용' } });
      fireEvent.click(sendButton());
      await screen.findByText(messages.replies.sent);
      expect(mock.send.mock.calls[0]![0].operationId).not.toBe(
        mock.send.mock.calls[1]![0].operationId,
      );
    },
  );
});
describe('reply uncertainty and response ordering', () => {
  it('guards double submit before React disabled state commits', async () => {
    const wait = defer<ReplyResult<ReplyReceipt>>();
    mock.send.mockReturnValue(wait.promise);
    const view = await start();
    fireEvent.change(textbox(), { target: { value: '한 번만' } });
    act(() => {
      fireEvent.submit(view.container.querySelector('form')!);
      fireEvent.submit(view.container.querySelector('form')!);
    });
    expect(mock.send).toHaveBeenCalledOnce();
    expect(textbox()).toBeDisabled();
    expect(
      screen.getByRole('button', { name: messages.replies.sending }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: messages.replies.refresh }),
    ).toBeDisabled();
    await act(async () =>
      wait.resolve(accepted(mock.send.mock.calls[0]![0] as ReplyWriteInput)),
    );
    expect(screen.getAllByText('한 번만')).toHaveLength(1);
  });
  it('allows closing an in-flight composer without canceling its immutable submission', async () => {
    const wait = defer<ReplyResult<ReplyReceipt>>();
    mock.send.mockReturnValue(wait.promise);
    await start();
    fireEvent.change(textbox(), { target: { value: '진행 중' } });
    fireEvent.click(sendButton());
    const signal = mock.send.mock.calls[0]![1] as AbortSignal;
    fireEvent.click(
      screen.getByRole('button', { name: messages.replies.close }),
    );
    expect(signal.aborted).toBe(false);
    await act(async () =>
      wait.resolve(accepted(mock.send.mock.calls[0]![0] as ReplyWriteInput)),
    );
    fireEvent.click(
      screen.getByRole('button', { name: messages.replies.open }),
    );
    expect(textbox()).toHaveValue('');
    expect(screen.getAllByText('진행 중')).toHaveLength(1);
  });
  it.each(['UNAVAILABLE', 'IDEMPOTENCY_CONFLICT'] as const)(
    'locks uncertain %s body, closes/reopens and retries the identical operation',
    async (code) => {
      mock.send.mockResolvedValueOnce({ ok: false, code });
      await start();
      fireEvent.change(textbox(), { target: { value: '같은 답장' } });
      fireEvent.click(sendButton());
      await screen.findByText(messages.replies.uncertain);
      expect(textbox()).toHaveAttribute('readonly');
      fireEvent.change(textbox(), { target: { value: '바뀐 답장' } });
      expect(textbox()).toHaveValue('같은 답장');
      expect(
        screen.getByRole('button', { name: messages.replies.refresh }),
      ).toBeDisabled();
      fireEvent.click(
        screen.getByRole('button', { name: messages.replies.close }),
      );
      fireEvent.click(
        screen.getByRole('button', { name: messages.replies.open }),
      );
      expect(textbox()).toHaveValue('같은 답장');
      fireEvent.click(
        screen.getByRole('button', { name: messages.replies.retrySend }),
      );
      await screen.findByText(messages.replies.sent);
      expect(mock.send.mock.calls[1]![0]).toEqual(mock.send.mock.calls[0]![0]);
      expect(screen.getAllByText('같은 답장')).toHaveLength(1);
    },
  );
  it('retains uncertainty if a retry gets a conclusive rejection but original result is unknown', async () => {
    mock.send
      .mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' })
      .mockResolvedValueOnce({ ok: false, code: 'RATE_LIMITED' });
    await start();
    fireEvent.change(textbox(), { target: { value: '확인 필요' } });
    fireEvent.click(sendButton());
    await screen.findByText(messages.replies.uncertain);
    fireEvent.click(
      screen.getByRole('button', { name: messages.replies.retrySend }),
    );
    await screen.findByText(messages.replies.errors.RATE_LIMITED);
    expect(textbox()).toHaveAttribute('readonly');
    expect(
      screen.getByRole('button', { name: messages.replies.retrySend }),
    ).toBeEnabled();
    expect(mock.send.mock.calls[1]![0]).toEqual(mock.send.mock.calls[0]![0]);
  });
  it('treats thrown writes as unknown and never automatically sends again', async () => {
    mock.send.mockRejectedValue(new Error('response lost'));
    await start();
    fireEvent.change(textbox(), { target: { value: '답장' } });
    fireEvent.click(sendButton());
    await screen.findByText(messages.replies.uncertain);
    expect(mock.send).toHaveBeenCalledOnce();
    expect(textbox()).toHaveValue('답장');
  });
  it('fails closed when crypto operation allocation is unavailable', async () => {
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      throw new Error('unavailable');
    });
    await start();
    fireEvent.change(textbox(), { target: { value: '초안' } });
    fireEvent.click(sendButton());
    expect(screen.getByRole('alert')).toHaveTextContent(
      messages.replies.errors.UNAVAILABLE,
    );
    expect(mock.send).not.toHaveBeenCalled();
    expect(textbox()).toHaveValue('초안');
  });
  it('does not restore a late successful write after unmount', async () => {
    const wait = defer<ReplyResult<ReplyReceipt>>();
    mock.send.mockReturnValue(wait.promise);
    const view = await start();
    fireEvent.change(textbox(), { target: { value: '이전 화면의 답장' } });
    fireEvent.click(sendButton());
    const signal = mock.send.mock.calls[0]![1] as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () =>
      wait.resolve(accepted(mock.send.mock.calls[0]![0] as ReplyWriteInput)),
    );
    expect(screen.queryByText(messages.replies.sent)).not.toBeInTheDocument();
  });
  it('accepts a blocked replay marker without displaying the draft in history', async () => {
    mock.send.mockImplementation(async (input: ReplyWriteInput) => ({
      ok: true,
      data: {
        slug,
        reply: ownReply({
          operationId: input.operationId,
          blocked: true,
          body: null,
        }),
      },
    }));
    await start();
    fireEvent.change(textbox(), { target: { value: '숨겨진 내용' } });
    fireEvent.click(sendButton());
    await screen.findByText(messages.replies.sent);
    expect(screen.queryByText('숨겨진 내용')).not.toBeInTheDocument();
    expect(screen.getByText(messages.replies.blocked)).toBeVisible();
  });
});
describe('reply personal feed and navigation lifecycle', () => {
  it('loads more once, deduplicates boundaries and preserves timestamp order', async () => {
    mock.read.mockResolvedValueOnce({
      ok: true,
      data: replyUiPage({ replies: [ownReply()], nextCursor: 'YWJj' }),
    });
    const wait = defer<ReplyResult<ReplyPage>>();
    mock.read.mockReturnValueOnce(wait.promise);
    await start();
    const button = screen.getByRole('button', { name: messages.replies.older });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(mock.read).toHaveBeenCalledTimes(2);
    expect(mock.read.mock.calls[1]![0]).toEqual({ slug, cursor: 'YWJj' });
    await act(async () =>
      wait.resolve({
        ok: true,
        data: replyUiPage({
          replies: [
            ownReply(),
            ownReply({
              id: ids.older,
              body: '이전 답장',
              operationId: ids.operation2,
            }),
          ],
        }),
      }),
    );
    expect(
      within(
        screen.getByRole('list', { name: messages.replies.history }),
      ).getAllByRole('listitem'),
    ).toHaveLength(2);
    expect(screen.getByText(messages.replies.end)).toBeVisible();
  });
  it('retries the failed older page without clearing the draft or loaded feed', async () => {
    mock.read
      .mockResolvedValueOnce({
        ok: true,
        data: replyUiPage({ replies: [ownReply()], nextCursor: 'YWJj' }),
      })
      .mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' })
      .mockResolvedValueOnce({
        ok: true,
        data: replyUiPage({
          replies: [ownReply({ id: ids.older, body: '이전 답장' })],
        }),
      });
    await start();
    fireEvent.change(textbox(), { target: { value: '작성 중' } });
    fireEvent.click(
      screen.getByRole('button', { name: messages.replies.older }),
    );
    await screen.findByRole('alert');
    expect(textbox()).toHaveValue('작성 중');
    expect(screen.getByText('항상 응원해요.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: messages.ui.retry }));
    await screen.findByText('이전 답장');
    expect(mock.read.mock.calls[2]![0]).toEqual({ slug, cursor: 'YWJj' });
  });
  it.each(['UNAVAILABLE', 'SETUP_NOT_READY'] as const)(
    'renders explicit initial %s without a fake composer and supports retry',
    async (code) => {
      mock.read.mockResolvedValueOnce({ ok: false, code });
      render(subject());
      await screen.findByRole('alert');
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent(
        messages.replies.errors[code],
      );
      fireEvent.click(screen.getByRole('button', { name: messages.ui.retry }));
      await screen.findByRole('textbox');
    },
  );
  it.each([
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'SUBSCRIPTION_REQUIRED',
    'PROFILE_REQUIRED',
    'NOT_FOUND',
  ] as const)(
    'clears private data and informs room owner on %s',
    async (code) => {
      mock.read.mockResolvedValueOnce({
        ok: true,
        data: replyUiPage({ replies: [ownReply()] }),
      });
      mock.send.mockResolvedValueOnce({ ok: false, code });
      await start();
      fireEvent.change(textbox(), { target: { value: '비공개 초안' } });
      fireEvent.click(sendButton());
      await act(async () => {});
      expect(mock.lost).toHaveBeenCalledExactlyOnceWith(code);
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(screen.queryByText('항상 응원해요.')).not.toBeInTheDocument();
    },
  );
  it.each([
    'UNAUTHENTICATED',
    'SUBSCRIPTION_REQUIRED',
    'PROFILE_REQUIRED',
  ] as const)(
    'shows real recovery navigation for reply-triggered %s in chat',
    async (code) => {
      mock.send.mockResolvedValueOnce({ ok: false, code });
      await start(true);
      fireEvent.change(textbox(), { target: { value: '민감한 초안' } });
      fireEvent.click(sendButton());
      await screen.findByText(messages.chat.errors[code]);
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(screen.queryByText('순자 님, 반가워요.')).not.toBeInTheDocument();
      const linkName =
        code === 'UNAUTHENTICATED'
          ? messages.chat.signIn
          : code === 'PROFILE_REQUIRED'
            ? messages.chat.profile
            : messages.chat.preview;
      const href =
        code === 'UNAUTHENTICATED'
          ? routes.start
          : code === 'PROFILE_REQUIRED'
            ? routes.onboarding
            : `/artists/${slug}`;
      expect(screen.getByRole('link', { name: linkName })).toHaveAttribute(
        'href',
        href,
      );
      expect(
        screen.getByRole('link', { name: messages.chat.subscriptions }),
      ).toHaveAttribute('href', routes.subscriptions);
    },
  );
  it('drops old feed/draft and ignores late page after back/forward', async () => {
    mock.read.mockResolvedValueOnce({
      ok: true,
      data: replyUiPage({ replies: [ownReply()], nextCursor: 'YWJj' }),
    });
    const oldPage = defer<ReplyResult<ReplyPage>>();
    mock.read
      .mockReturnValueOnce(oldPage.promise)
      .mockResolvedValueOnce({ ok: true, data: replyUiPage() });
    await start();
    fireEvent.change(textbox(), { target: { value: '오래된 초안' } });
    fireEvent.click(
      screen.getByRole('button', { name: messages.replies.older }),
    );
    const oldSignal = mock.read.mock.calls[1]![1] as AbortSignal;
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    await screen.findByRole('textbox');
    expect(oldSignal.aborted).toBe(true);
    expect(textbox()).toHaveValue('');
    expect(screen.queryByText('항상 응원해요.')).not.toBeInTheDocument();
    await act(async () =>
      oldPage.resolve({
        ok: true,
        data: replyUiPage({ replies: [ownReply({ body: '늦게 온 내용' })] }),
      }),
    );
    expect(screen.queryByText('늦게 온 내용')).not.toBeInTheDocument();
  });
  it('clears hidden-page private state and revalidates persisted-page return', async () => {
    await start();
    fireEvent.change(textbox(), { target: { value: '남기지 않을 초안' } });
    act(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    act(() =>
      window.dispatchEvent(
        new PageTransitionEvent('pageshow', { persisted: true }),
      ),
    );
    await screen.findByRole('textbox');
    expect(textbox()).toHaveValue('');
    expect(mock.read).toHaveBeenCalledTimes(2);
  });
  it('aborts an unknown write on back and never adds its delayed success to current room', async () => {
    const wait = defer<ReplyResult<ReplyReceipt>>();
    mock.send.mockReturnValue(wait.promise);
    await start();
    fireEvent.change(textbox(), { target: { value: '늦은 답장' } });
    fireEvent.click(sendButton());
    const signal = mock.send.mock.calls[0]![1] as AbortSignal;
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    await screen.findByRole('textbox');
    expect(signal.aborted).toBe(true);
    await act(async () =>
      wait.resolve(accepted(mock.send.mock.calls[0]![0] as ReplyWriteInput)),
    );
    expect(screen.queryByText(messages.replies.sent)).not.toBeInTheDocument();
    expect(screen.queryByText('늦은 답장')).not.toBeInTheDocument();
    expect(textbox()).toHaveValue('');
  });
  it('handles a thrown read as unavailable without losing an existing draft', async () => {
    await start();
    fireEvent.change(textbox(), { target: { value: '계속 작성' } });
    mock.read.mockRejectedValueOnce(new Error('network'));
    fireEvent.click(
      screen.getByRole('button', { name: messages.replies.refresh }),
    );
    await screen.findByRole('alert');
    expect(textbox()).toHaveValue('계속 작성');
    expect(screen.getByRole('alert')).toHaveTextContent(
      messages.replies.errors.UNAVAILABLE,
    );
  });
  it('stops stale submission when room receives a fresh same-slug RSC snapshot', async () => {
    const wait = defer<ReplyResult<ReplyReceipt>>();
    mock.send.mockReturnValue(wait.promise);
    const view = await start(true);
    fireEvent.change(textbox(), { target: { value: '이전 상태' } });
    fireEvent.click(sendButton());
    const signal = mock.send.mock.calls[0]![1] as AbortSignal;
    view.rerender(subject(true));
    await screen.findByRole('textbox');
    expect(signal.aborted).toBe(true);
    expect(textbox()).toHaveValue('');
    await act(async () =>
      wait.resolve(accepted(mock.send.mock.calls[0]![0] as ReplyWriteInput)),
    );
    expect(screen.queryByText('이전 상태')).not.toBeInTheDocument();
  });
});
