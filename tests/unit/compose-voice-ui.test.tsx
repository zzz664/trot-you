import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceRecorder } from '@/components/artist-compose/VoiceRecorder';
import type { ComposeRecordingCallbacks } from '@/client/compose-recording';
import messages from '@/messages/ko.json';
const mock = vi.hoisted(() => ({
  supports: vi.fn(),
  create: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  cancel: vi.fn(),
  file: vi.fn(),
  busy: vi.fn(),
}));
vi.mock('@/components/artist-dispatch/ArtistDispatch', () => ({
  ArtistDispatch: () => null,
}));
vi.mock('@/client/compose-recording', () => ({
  supportsComposeRecording: mock.supports,
  createComposeRecording: mock.create,
}));
const copy = messages.artistCompose;
let callbacks: ComposeRecordingCallbacks;
function subject(disabled = false) {
  return (
    <NextIntlClientProvider locale="ko" messages={messages}>
      <VoiceRecorder
        maxSeconds={180}
        maxBytes={20971520}
        disabled={disabled}
        onFile={mock.file}
        onBusy={mock.busy}
      />
    </NextIntlClientProvider>
  );
}
beforeEach(() => {
  Object.values(mock).forEach((fn) => fn.mockReset());
  mock.supports.mockReturnValue(true);
  mock.create.mockImplementation((input: ComposeRecordingCallbacks) => {
    callbacks = input;
    return { start: mock.start, stop: mock.stop, cancel: mock.cancel };
  });
  mock.start.mockImplementation(() => callbacks.onPhase('requesting'));
});
afterEach(() => {
  vi.restoreAllMocks();
});
async function start() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: copy.record }));
  await user.click(screen.getByRole('button', { name: copy.recordStart }));
  return user;
}
describe('voice authoring consent and local capture ownership', () => {
  it('never constructs or starts capture until the second explicit disclosure click', async () => {
    const user = userEvent.setup();
    render(subject());
    expect(mock.create).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: copy.record }));
    expect(
      screen.getByText(copy.recordNotice.replace('{seconds}', '180')),
    ).toBeVisible();
    expect(mock.create).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: copy.recordStart }));
    expect(mock.create).toHaveBeenCalledOnce();
    expect(mock.start).toHaveBeenCalledOnce();
    expect(callbacks.maxDurationMs).toBe(180000);
    expect(callbacks.maxBytes).toBe(20971520);
  });
  it('can dismiss the disclosure without capture', async () => {
    const user = userEvent.setup();
    render(subject());
    await user.click(screen.getByRole('button', { name: copy.record }));
    await user.click(screen.getByRole('button', { name: copy.recordCancel }));
    expect(mock.create).not.toHaveBeenCalled();
  });
  it('holds bytes locally until explicit use and never uploads or stores on native stop', async () => {
    render(subject());
    const user = await start();
    await act(async () => callbacks.onPhase('recording'));
    await user.click(screen.getByRole('button', { name: copy.recordStop }));
    expect(mock.stop).toHaveBeenCalledOnce();
    const file = new File(['synthetic'], 'recording.webm', {
      type: 'audio/webm',
    });
    await act(async () => {
      callbacks.onResult(file);
      callbacks.onEnd();
    });
    expect(mock.file).not.toHaveBeenCalled();
    expect(screen.getByText(copy.recordReady)).toBeVisible();
    await user.click(screen.getByRole('button', { name: copy.recordUpload }));
    expect(mock.file).toHaveBeenCalledWith(file);
  });
  it('discards a local recording instead of leaking it to later clicks', async () => {
    render(subject());
    const user = await start();
    await act(async () => {
      callbacks.onResult(
        new File(['x'], 'recording.webm', { type: 'audio/webm' }),
      );
      callbacks.onEnd();
    });
    await user.click(screen.getByRole('button', { name: copy.recordCancel }));
    expect(
      screen.queryByRole('button', { name: copy.recordUpload }),
    ).not.toBeInTheDocument();
    expect(mock.file).not.toHaveBeenCalled();
  });
  it('cancels pending permission and ignores late result callbacks', async () => {
    render(subject());
    const user = await start();
    await user.click(screen.getByRole('button', { name: copy.recordCancel }));
    expect(mock.cancel).toHaveBeenCalledOnce();
    await act(async () => {
      callbacks.onResult(
        new File(['x'], 'recording.webm', { type: 'audio/webm' }),
      );
      callbacks.onPhase('recording');
      callbacks.onEnd();
    });
    expect(screen.queryByText(copy.recordReady)).not.toBeInTheDocument();
    expect(mock.file).not.toHaveBeenCalled();
  });
  it.each(['pagehide', 'popstate'])(
    'releases native capture on %s',
    async (event) => {
      render(subject());
      await start();
      fireEvent(window, new Event(event));
      expect(mock.cancel).toHaveBeenCalledOnce();
    },
  );
  it('releases native capture on unmount', async () => {
    const view = render(subject());
    await start();
    view.unmount();
    expect(mock.cancel).toHaveBeenCalledOnce();
  });
  it.each([
    'permission',
    'device',
    'timeout',
    'tooLarge',
    'empty',
    'busy',
    'unavailable',
  ] as const)(
    'shows actionable %s without native diagnostic details',
    async (error) => {
      render(subject());
      await start();
      await act(async () => {
        callbacks.onError(error);
        callbacks.onEnd();
      });
      expect(screen.getByRole('alert')).toHaveTextContent(copy.errors[error]);
    },
  );
  it('shows file fallback without offering unsupported native capture', () => {
    mock.supports.mockReturnValue(false);
    render(subject());
    expect(screen.getByText(copy.recordUnavailable)).toBeVisible();
    expect(
      screen.queryByRole('button', { name: copy.record }),
    ).not.toBeInTheDocument();
  });
  it('disables new capture while another draft operation owns the screen', () => {
    render(subject(true));
    expect(screen.getByRole('button', { name: copy.record })).toBeDisabled();
    expect(mock.create).not.toHaveBeenCalled();
  });
});

it('discloses and applies a bounded native capture duration even when upload policy allows longer files', async () => {
  const user = userEvent.setup();
  render(
    <NextIntlClientProvider locale="ko" messages={messages}>
      <VoiceRecorder
        maxSeconds={86400}
        maxBytes={104857600}
        disabled={false}
        onFile={mock.file}
        onBusy={mock.busy}
      />
    </NextIntlClientProvider>,
  );
  await user.click(screen.getByRole('button', { name: copy.record }));
  expect(
    screen.getByText(copy.recordNotice.replace('{seconds}', '3600')),
  ).toBeVisible();
  await user.click(screen.getByRole('button', { name: copy.recordStart }));
  expect(callbacks.maxDurationMs).toBe(3600000);
  expect(callbacks.maxBytes).toBe(20971520);
});
