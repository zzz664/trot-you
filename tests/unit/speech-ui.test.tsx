import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FanReplies } from '@/components/fan/replies/FanReplies';
import { MicButton } from '@/components/ui/MicButton';
import messages from '@/messages/ko.json';
import { replyUiPage, replyUiSlug } from './reply-ui-fixtures';
import {
  ControlledSpeechRecognition,
  installSpeechStub,
  latestSpeechRecognition,
  speechResults,
} from './speech-fixtures';
const mock = vi.hoisted(() => ({
  read: vi.fn(),
  send: vi.fn(),
  analytics: vi.fn(),
  lost: vi.fn(),
}));
vi.mock('@/client/replies', () => ({
  readReplyPage: mock.read,
  sendReply: mock.send,
}));
vi.mock('@/client/analytics', () => ({ recordVoiceInput: mock.analytics }));
function provider(children: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="ko" messages={messages} timeZone="UTC">
      {children}
    </NextIntlClientProvider>
  );
}
async function subject() {
  const view = render(
    provider(<FanReplies slug={replyUiSlug} onAccessLost={mock.lost} />),
  );
  await screen.findByRole('textbox', { name: messages.replies.label });
  return view;
}
const input = () =>
  screen.getByRole('textbox', {
    name: messages.replies.label,
  }) as HTMLTextAreaElement;
const button = (key: 'open' | 'start' | 'stop' | 'cancel') =>
  screen.getByRole('button', { name: messages.speech[key] });
const send = () => screen.getByRole('button', { name: messages.replies.send });
function begin() {
  fireEvent.click(button('open'));
  fireEvent.click(button('start'));
  const native = latestSpeechRecognition();
  act(() => native.emitStart());
  return native;
}
function finish(native: ControlledSpeechRecognition, text: string) {
  act(() => {
    native.emitResults([[text, true]]);
    native.emitEnd();
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  installSpeechStub();
  mock.read.mockResolvedValue({ ok: true, data: replyUiPage() });
  mock.send.mockResolvedValue({ ok: false, code: 'UNAVAILABLE' });
  mock.analytics.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('MicButton with real fan reply draft state, simulated recognition only', () => {
  it('closing the disclosure before native start unlocks the reopened composer', async () => {
    await subject();
    fireEvent.change(input(), { target: { value: '원본 보존' } });
    fireEvent.click(button('open'));
    fireEvent.click(
      screen.getByRole('button', { name: messages.replies.close }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: messages.replies.open }),
    );
    expect(input()).toHaveValue('원본 보존');
    expect(input()).not.toHaveAttribute('readonly');
    expect(send()).toBeEnabled();
    expect(ControlledSpeechRecognition.instances).toHaveLength(0);
  });
  it('restores focus and caret even when recognition exactly replaces the same selected text', async () => {
    await subject();
    fireEvent.change(input(), { target: { value: '앞기존뒤' } });
    input().setSelectionRange(1, 3);
    finish(begin(), '기존');
    expect(input()).toHaveValue('앞기존뒤');
    expect(input()).toHaveFocus();
    expect(input().selectionStart).toBe(3);
    expect(input().selectionEnd).toBe(3);
  });
  it('never constructs or requests recognition before separate disclosure and start clicks', async () => {
    await subject();
    expect(ControlledSpeechRecognition.instances).toHaveLength(0);
    fireEvent.change(input(), { target: { value: '내 초안' } });
    fireEvent.click(button('open'));
    expect(screen.getByText(messages.speech.privacy)).toBeVisible();
    expect(button('start')).toHaveAccessibleDescription(
      messages.speech.privacy,
    );
    expect(button('start')).toHaveFocus();
    expect(ControlledSpeechRecognition.instances).toHaveLength(0);
    expect(input()).toHaveAttribute('readonly');
    expect(send()).toBeDisabled();
    fireEvent.submit(input().closest('form')!);
    expect(mock.send).not.toHaveBeenCalled();
    fireEvent.click(button('start'));
    expect(latestSpeechRecognition().start).toHaveBeenCalledOnce();
    expect(screen.getByText(messages.speech.starting)).toBeVisible();
    expect(mock.analytics).not.toHaveBeenCalled();
  });
  it('replaces the captured selection with one final snapshot, preserves surrounding text and caret, never sends', async () => {
    await subject();
    fireEvent.change(input(), { target: { value: '앞😀기존뒤' } });
    input().setSelectionRange(3, 5);
    const native = begin();
    act(() => native.emitResults([['새', false]]));
    expect(input()).toHaveValue('앞😀기존뒤');
    act(() =>
      native.emitResults([
        ['새로운', true],
        [' 글', false],
      ]),
    );
    act(() =>
      native.emitResults(
        [
          ['새로운', true],
          [' 글', true],
        ],
        1,
      ),
    );
    act(() =>
      native.emitResults(
        [
          ['새로운', true],
          [' 글', true],
        ],
        1,
      ),
    );
    expect(mock.analytics).not.toHaveBeenCalled();
    fireEvent.click(button('stop'));
    expect(native.stop).toHaveBeenCalledOnce();
    expect(screen.getByText(messages.speech.stopping)).toBeVisible();
    act(() => native.emitEnd());
    expect(input()).toHaveValue('앞😀새로운 글뒤');
    expect(input()).toHaveFocus();
    expect(input().selectionStart).toBe(8);
    expect(input().selectionEnd).toBe(8);
    expect(send()).toBeEnabled();
    expect(mock.send).not.toHaveBeenCalled();
    expect(mock.analytics).toHaveBeenCalledOnce();
    expect(mock.analytics.mock.calls[0]).toEqual([
      'reply',
      expect.stringMatching(/^[0-9a-f-]{36}$/),
      expect.any(AbortSignal),
    ]);
    expect(JSON.stringify(mock.analytics.mock.calls)).not.toContain('새로운');
    expect(screen.getByText(messages.speech.applied)).toBeVisible();
  });
  it.each(['notice', 'starting', 'listening', 'stopping'])(
    'cancel at %s preserves all original text and ignores late events',
    async (phase) => {
      await subject();
      fireEvent.change(input(), { target: { value: '취소해도 남을 글' } });
      fireEvent.click(button('open'));
      let native: ControlledSpeechRecognition | undefined;
      let late: ControlledSpeechRecognition['onresult'];
      if (phase !== 'notice') {
        fireEvent.click(button('start'));
        native = latestSpeechRecognition();
        if (phase !== 'starting') act(() => native!.emitStart());
        act(() => native!.emitResults([['넣지 않을 글', true]]));
        late = native.onresult;
        if (phase === 'stopping') fireEvent.click(button('stop'));
      }
      fireEvent.click(button('cancel'));
      if (native) expect(native.abort).toHaveBeenCalledOnce();
      act(() => {
        late?.(speechResults([['지연된 결과', true]]));
        native?.emitEnd();
      });
      expect(input()).toHaveValue('취소해도 남을 글');
      expect(input()).not.toHaveAttribute('readonly');
      expect(screen.queryByText('넣지 않을 글')).not.toBeInTheDocument();
      expect(screen.getByText(messages.speech.canceled)).toBeVisible();
      expect(mock.send).not.toHaveBeenCalled();
      expect(mock.analytics).not.toHaveBeenCalled();
    },
  );
  it.each(['Escape', 'pagehide', 'popstate', 'hidden', 'unmount', 'close'])(
    '%s aborts capture without a delayed draft or analytics write',
    async (kind) => {
      const view = await subject();
      fireEvent.change(input(), { target: { value: '작성 중인 초안' } });
      const native = begin();
      const late = native.onresult;
      const end = native.onend;
      if (kind === 'Escape') fireEvent.keyDown(document, { key: 'Escape' });
      else if (kind === 'hidden') {
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        fireEvent(document, new Event('visibilitychange'));
      } else if (kind === 'unmount') view.unmount();
      else if (kind === 'close')
        fireEvent.click(
          screen.getByRole('button', { name: messages.replies.close }),
        );
      else fireEvent(window, new Event(kind));
      expect(native.abort).toHaveBeenCalledOnce();
      act(() => {
        late?.(speechResults([['늦은 글', true]]));
        end?.();
      });
      expect(mock.analytics).not.toHaveBeenCalled();
      expect(mock.send).not.toHaveBeenCalled();
      if (kind === 'close') {
        fireEvent.click(
          screen.getByRole('button', { name: messages.replies.open }),
        );
        expect(input()).toHaveValue('작성 중인 초안');
      }
      if (kind === 'popstate') await screen.findByRole('textbox');
    },
  );
  it('denied recognition leaves manual typing and sending available', async () => {
    await subject();
    fireEvent.change(input(), { target: { value: '원본' } });
    const native = begin();
    act(() => native.emitError('not-allowed'));
    expect(screen.getByRole('alert')).toHaveTextContent(
      messages.speech.errors.permission,
    );
    expect(input()).toHaveValue('원본');
    fireEvent.change(input(), { target: { value: '직접 쓴 답장' } });
    fireEvent.click(send());
    await waitFor(() => expect(mock.send).toHaveBeenCalledOnce());
    expect(mock.send.mock.calls[0]![0].body).toBe('직접 쓴 답장');
    expect(mock.analytics).not.toHaveBeenCalled();
  });
  it('access loss during reply refresh unmounts capture and erases the private draft', async () => {
    await subject();
    fireEvent.change(input(), { target: { value: '비공개 초안' } });
    const native = begin();
    mock.read.mockResolvedValueOnce({
      ok: false,
      code: 'SUBSCRIPTION_REQUIRED',
    });
    fireEvent.click(
      screen.getByRole('button', { name: messages.replies.refresh }),
    );
    await waitFor(() =>
      expect(mock.lost).toHaveBeenCalledWith('SUBSCRIPTION_REQUIRED'),
    );
    expect(native.abort).toHaveBeenCalledOnce();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByText('비공개 초안')).not.toBeInTheDocument();
    expect(mock.analytics).not.toHaveBeenCalled();
  });
  it('stops capture while awaiting a policy refresh rather than using stale access data', async () => {
    await subject();
    const native = begin();
    mock.read.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(
      screen.getByRole('button', { name: messages.replies.refresh }),
    );
    await waitFor(() => expect(native.abort).toHaveBeenCalledOnce());
    expect(button('open')).toBeDisabled();
  });
  it('rejects an over-capacity transcript without truncating original selected text', async () => {
    mock.read.mockResolvedValue({
      ok: true,
      data: replyUiPage({ maxLength: 5 }),
    });
    await subject();
    fireEvent.change(input(), { target: { value: '가😀나다라' } });
    input().setSelectionRange(1, 3);
    const native = begin();
    act(() => native.emitResults([['😀😀', true]]));
    expect(input()).toHaveValue('가😀나다라');
    expect(screen.getByRole('alert')).toHaveTextContent(
      messages.speech.errors.tooLong,
    );
    expect(mock.analytics).not.toHaveBeenCalled();
    const retry = begin();
    finish(retry, '🌸');
    expect(input()).toHaveValue('가🌸나다라');
  });
  it('does not open native capture when the unselected draft is already full', async () => {
    mock.read.mockResolvedValue({
      ok: true,
      data: replyUiPage({ maxLength: 2 }),
    });
    await subject();
    fireEvent.change(input(), { target: { value: '가나' } });
    input().setSelectionRange(2, 2);
    fireEvent.click(button('open'));
    expect(screen.getByRole('alert')).toHaveTextContent(
      messages.speech.errors.tooLong,
    );
    expect(ControlledSpeechRecognition.instances).toHaveLength(0);
    expect(input()).not.toHaveAttribute('readonly');
  });
  it('treats a later equal utterance as an intentional new session instead of global deduplication', async () => {
    await subject();
    finish(begin(), '고마워요');
    finish(begin(), '고마워요');
    expect(input()).toHaveValue('고마워요고마워요');
    expect(mock.analytics).toHaveBeenCalledTimes(2);
    expect(mock.analytics.mock.calls[0]![1]).not.toBe(
      mock.analytics.mock.calls[1]![1],
    );
  });
  it('retains the draft when optional analytics fails and never retries it', async () => {
    mock.analytics.mockRejectedValue(new Error('private diagnostic'));
    await subject();
    finish(begin(), '분석과 무관한 초안');
    await act(async () => {});
    expect(input()).toHaveValue('분석과 무관한 초안');
    expect(mock.analytics).toHaveBeenCalledOnce();
    expect(screen.queryByText('private diagnostic')).not.toBeInTheDocument();
  });
  it('supports reusable context-free MicButton without inventing an artist analytics context', () => {
    const result = vi.fn();
    render(provider(<MicButton maxLength={30} onResult={result} />));
    finish(begin(), '재사용 입력');
    expect(result).toHaveBeenCalledExactlyOnceWith('재사용 입력');
    expect(mock.analytics).not.toHaveBeenCalled();
  });
  it('does not report usage when the parent rejects a stale draft result', () => {
    render(
      provider(
        <MicButton
          maxLength={30}
          analyticsContext="reply"
          onResult={() => false}
        />,
      ),
    );
    finish(begin(), '채택하지 않음');
    expect(mock.analytics).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      messages.speech.errors.unavailable,
    );
  });
  it.each(['missing', 'insecure'])(
    'shows honest fallback for %s capability without disabling manual replies',
    async (kind) => {
      if (kind === 'missing') vi.stubGlobal('SpeechRecognition', undefined);
      else vi.stubGlobal('isSecureContext', false);
      await subject();
      expect(screen.getByText(messages.speech.unsupported)).toBeVisible();
      expect(
        screen.queryByRole('button', { name: messages.speech.open }),
      ).not.toBeInTheDocument();
      expect(input()).not.toHaveAttribute('readonly');
      fireEvent.change(input(), { target: { value: '키보드 입력' } });
      fireEvent.click(send());
      await waitFor(() => expect(mock.send).toHaveBeenCalledOnce());
    },
  );
});
