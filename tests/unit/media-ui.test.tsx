import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SecureMedia } from '@/components/media/SecureMedia';
import type { MediaKind, MediaReadGrant, MediaResult } from '@/config/media';
import messages from '@/messages/ko.json';

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/client/media', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/client/media')>()),
  readMediaUrl: mocks.read,
}));
const mediaId = '20000000-0000-4000-8000-000000000001';
const otherId = '20000000-0000-4000-8000-000000000002';
const signedUrl =
  'https://media-fixture.supabase.co/storage/v1/object/sign/message-media/fictional.png?token=public-fixture';
function grant(kind: MediaKind = 'photo'): MediaReadGrant {
  return {
    url: signedUrl,
    expiresAt: new Date(Date.now() + 50_000).toISOString(),
    kind,
    mimeType:
      kind === 'photo'
        ? 'image/png'
        : kind === 'voice'
          ? 'audio/mp4'
          : 'video/mp4',
  };
}
function subject(kind: MediaKind = 'photo', id = mediaId, preview = true) {
  return (
    <NextIntlClientProvider locale="ko" messages={messages} timeZone="UTC">
      <SecureMedia mediaId={id} kind={kind} preview={preview} />
    </NextIntlClientProvider>
  );
}
function label(key: 'open' | 'retry', kind: MediaKind = 'photo') {
  return messages.media[key].replace(
    '{kind}',
    messages.artists.messageKinds[kind],
  );
}
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  mocks.read.mockReset().mockResolvedValue({ ok: true, data: grant() });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('short-lived accessible secure media', () => {
  it.each(['normal', 'large', 'xlarge'])(
    'keeps private URLs absent before deliberate open at %s text scale',
    async (scale) => {
      document.documentElement.dataset.fontScale = scale;
      const view = render(subject());
      expect(
        view.container.querySelector('img, audio, video, source'),
      ).toBeNull();
      expect(mocks.read).not.toHaveBeenCalled();
      await userEvent.click(
        screen.getByRole('button', { name: label('open') }),
      );
      expect(mocks.read).toHaveBeenCalledWith(
        { mediaId, preview: true },
        expect.any(AbortSignal),
      );
      const image = screen.getByRole('img', { name: messages.media.photoAlt });
      expect(image).toHaveAttribute('src', signedUrl);
      expect(image).toHaveAttribute('loading', 'lazy');
      expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
      expect(image).not.toHaveAttribute('srcset');
      expect(image.getAttribute('src')).not.toContain('/_next/image');
      expect(document.documentElement.dataset.fontScale).toBe(scale);
    },
  );

  it.each(['voice', 'video'] as const)(
    'opens native labeled %s controls only after a tap, with no autoplay/preload',
    async (kind) => {
      mocks.read.mockResolvedValue({ ok: true, data: grant(kind) });
      const view = render(subject(kind));
      expect(view.container.querySelector('audio, video')).toBeNull();
      await userEvent.click(
        screen.getByRole('button', { name: label('open', kind) }),
      );
      const element = screen.getByLabelText(
        kind === 'voice'
          ? messages.media.voiceLabel
          : messages.media.videoLabel,
      );
      expect(element).toHaveAttribute('src', signedUrl);
      expect(element).toHaveAttribute('controls');
      expect(element).toHaveAttribute('preload', 'none');
      expect(element).not.toHaveAttribute('autoplay');
      if (kind === 'video') expect(element).toHaveAttribute('playsinline');
    },
  );

  it('serializes repeated taps while authorization is pending', async () => {
    let finish: (value: MediaResult<MediaReadGrant>) => void = () => {};
    mocks.read.mockImplementation(
      () =>
        new Promise<MediaResult<MediaReadGrant>>((resolve) => {
          finish = resolve;
        }),
    );
    render(subject());
    const button = screen.getByRole('button', { name: label('open') });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(
      messages.media.loading,
    );
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    await act(async () => finish({ ok: true, data: grant() }));
    expect(screen.getByRole('img')).toHaveAttribute('src', signedUrl);
  });

  it('drops an expired signed URL and obtains fresh authorization only after retry', async () => {
    vi.useFakeTimers();
    mocks.read.mockImplementation(async () => ({ ok: true, data: grant() }));
    render(subject());
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: label('open') })),
    );
    expect(screen.getByRole('img')).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(50_001));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      messages.media.expired,
    );
    expect(mocks.read).toHaveBeenCalledTimes(1);
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: label('retry') })),
    );
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  it('shows revoked access on a fresh retry without keeping an old source', async () => {
    render(subject());
    await userEvent.click(screen.getByRole('button', { name: label('open') }));
    fireEvent.error(screen.getByRole('img'));
    mocks.read.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    await userEvent.click(screen.getByRole('button', { name: label('retry') }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      messages.media.errors.FORBIDDEN,
    );
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it.each([
    'NOT_FOUND',
    'UNAUTHENTICATED',
    'UNAVAILABLE',
    'SETUP_NOT_READY',
  ] as const)(
    'uses a persistent inline %s error and a large retry control',
    async (code) => {
      mocks.read.mockResolvedValue({ ok: false, code });
      render(subject());
      await userEvent.click(
        screen.getByRole('button', { name: label('open') }),
      );
      expect(screen.getByRole('alert')).toHaveTextContent(
        messages.media.errors[code],
      );
      expect(
        screen.getByRole('button', { name: label('retry') }),
      ).toBeEnabled();
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
    },
  );

  it('rejects a returned kind mismatch without rendering its source', async () => {
    mocks.read.mockResolvedValue({ ok: true, data: grant('video') });
    const view = render(subject());
    await userEvent.click(screen.getByRole('button', { name: label('open') }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      messages.media.errors.UNAVAILABLE,
    );
    expect(view.container.querySelector('[src]')).toBeNull();
  });

  it('handles an unexpected transport exception without leaking error content', async () => {
    mocks.read.mockRejectedValue(new Error('secret bearer/private path'));
    const view = render(subject());
    await userEvent.click(screen.getByRole('button', { name: label('open') }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      messages.media.errors.UNAVAILABLE,
    );
    expect(view.container.textContent).not.toContain('secret');
  });

  it('aborts an in-flight read on unmount and ignores its late response', async () => {
    let finish: (value: MediaResult<MediaReadGrant>) => void = () => {};
    mocks.read.mockImplementation(
      () =>
        new Promise<MediaResult<MediaReadGrant>>((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(subject());
    fireEvent.click(screen.getByRole('button', { name: label('open') }));
    const signal = mocks.read.mock.calls[0]?.[1] as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => finish({ ok: true, data: grant() }));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('does not let an old resource response overwrite query-only replacement', async () => {
    let finish: (value: MediaResult<MediaReadGrant>) => void = () => {};
    mocks.read.mockImplementationOnce(
      () =>
        new Promise<MediaResult<MediaReadGrant>>((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(subject());
    fireEvent.click(screen.getByRole('button', { name: label('open') }));
    view.rerender(subject('photo', otherId, false));
    await act(async () => finish({ ok: true, data: grant() }));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: label('open') })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: label('open') }));
    expect(mocks.read).toHaveBeenLastCalledWith(
      { mediaId: otherId, preview: false },
      expect.any(AbortSignal),
    );
  });

  it('synchronously clears source on pagehide, then requires a fresh read after restoration', async () => {
    const view = render(subject());
    await userEvent.click(screen.getByRole('button', { name: label('open') }));
    const oldImage = screen.getByRole('img');
    fireEvent(window, new Event('pagehide'));
    expect(oldImage).not.toHaveAttribute('src');
    expect(view.container.querySelector('[src]')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(messages.media.hidden);
    fireEvent(window, new Event('pageshow'));
    expect(mocks.read).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: label('retry') }));
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('img')).toBeVisible();
  });

  it('stops and unloads native media before the back/forward-cache snapshot', async () => {
    const pause = vi
      .spyOn(HTMLMediaElement.prototype, 'pause')
      .mockImplementation(() => {});
    const load = vi
      .spyOn(HTMLMediaElement.prototype, 'load')
      .mockImplementation(() => {});
    mocks.read.mockResolvedValue({ ok: true, data: grant('voice') });
    render(subject('voice'));
    await userEvent.click(
      screen.getByRole('button', { name: label('open', 'voice') }),
    );
    const oldAudio = screen.getByLabelText(messages.media.voiceLabel);
    fireEvent(window, new Event('pagehide'));
    expect(oldAudio).not.toHaveAttribute('src');
    expect(pause).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('stops native playback on SPA unmount, not just browser pagehide', async () => {
    mocks.read.mockResolvedValue({ ok: true, data: grant('video') });
    const view = render(subject('video'));
    await userEvent.click(
      screen.getByRole('button', { name: label('open', 'video') }),
    );
    const oldVideo = screen.getByLabelText(messages.media.videoLabel);
    view.unmount();
    expect(oldVideo).not.toHaveAttribute('src');
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalledTimes(1);
  });

  it('stops native playback and removes the detached source when a grant expires', async () => {
    vi.useFakeTimers();
    mocks.read.mockResolvedValue({ ok: true, data: grant('voice') });
    render(subject('voice'));
    await act(async () =>
      fireEvent.click(
        screen.getByRole('button', { name: label('open', 'voice') }),
      ),
    );
    const oldAudio = screen.getByLabelText(messages.media.voiceLabel);
    await act(async () => vi.advanceTimersByTime(50_001));
    expect(oldAudio).not.toHaveAttribute('src');
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent(
      messages.media.expired,
    );
  });

  it('continues a 180-second user-started voice clip across fresh short authorization grants', async () => {
    vi.useFakeTimers();
    mocks.read.mockImplementation(async () => ({
      ok: true,
      data: grant('voice'),
    }));
    render(subject('voice'));
    await act(async () =>
      fireEvent.click(
        screen.getByRole('button', { name: label('open', 'voice') }),
      ),
    );
    for (const position of [55, 110, 165]) {
      const oldAudio = screen.getByLabelText(
        messages.media.voiceLabel,
      ) as HTMLAudioElement;
      Object.defineProperty(oldAudio, 'paused', {
        configurable: true,
        value: false,
      });
      Object.defineProperty(oldAudio, 'ended', {
        configurable: true,
        value: false,
      });
      oldAudio.currentTime = position;
      await act(async () => vi.advanceTimersByTime(50_001));
      expect(oldAudio).not.toHaveAttribute('src');
      const nextAudio = screen.getByLabelText(
        messages.media.voiceLabel,
      ) as HTMLAudioElement;
      expect(nextAudio).toHaveAttribute('preload', 'metadata');
      Object.defineProperty(nextAudio, 'duration', {
        configurable: true,
        value: 180,
      });
      await act(async () => fireEvent.loadedMetadata(nextAudio));
      expect(nextAudio.currentTime).toBe(position);
      expect(nextAudio).toHaveAttribute('src', signedUrl);
    }
    expect(mocks.read).toHaveBeenCalledTimes(4);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(3);
    const endedAudio = screen.getByLabelText(messages.media.voiceLabel);
    Object.defineProperty(endedAudio, 'ended', {
      configurable: true,
      value: true,
    });
    await act(async () => vi.advanceTimersByTime(50_001));
    expect(mocks.read).toHaveBeenCalledTimes(4);
    expect(screen.getByRole('status')).toHaveTextContent(
      messages.media.expired,
    );
  });

  it('lets the user stop automatic continuation while authorization is pending', async () => {
    vi.useFakeTimers();
    let finish: (value: MediaResult<MediaReadGrant>) => void = () => {};
    mocks.read
      .mockResolvedValueOnce({ ok: true, data: grant('voice') })
      .mockImplementationOnce(
        () =>
          new Promise<MediaResult<MediaReadGrant>>((resolve) => {
            finish = resolve;
          }),
      );
    render(subject('voice'));
    await act(async () =>
      fireEvent.click(
        screen.getByRole('button', { name: label('open', 'voice') }),
      ),
    );
    const oldAudio = screen.getByLabelText(
      messages.media.voiceLabel,
    ) as HTMLAudioElement;
    Object.defineProperty(oldAudio, 'paused', {
      configurable: true,
      value: false,
    });
    oldAudio.currentTime = 54;
    await act(async () => vi.advanceTimersByTime(50_001));
    expect(oldAudio).not.toHaveAttribute('src');
    expect(
      screen.queryByLabelText(messages.media.voiceLabel),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: messages.media.pauseContinuation }),
    );
    await act(async () => finish({ ok: true, data: grant('voice') }));
    const nextAudio = screen.getByLabelText(
      messages.media.voiceLabel,
    ) as HTMLAudioElement;
    Object.defineProperty(nextAudio, 'duration', {
      configurable: true,
      value: 180,
    });
    fireEvent.loadedMetadata(nextAudio);
    expect(nextAudio.currentTime).toBe(54);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(
      messages.media.resumeReady,
    );
  });

  it('stops active playback when renewal authorization is denied and never silently retries', async () => {
    vi.useFakeTimers();
    mocks.read
      .mockResolvedValueOnce({ ok: true, data: grant('voice') })
      .mockResolvedValueOnce({ ok: false, code: 'FORBIDDEN' });
    render(subject('voice'));
    await act(async () =>
      fireEvent.click(
        screen.getByRole('button', { name: label('open', 'voice') }),
      ),
    );
    const oldAudio = screen.getByLabelText(
      messages.media.voiceLabel,
    ) as HTMLAudioElement;
    Object.defineProperty(oldAudio, 'paused', {
      configurable: true,
      value: false,
    });
    oldAudio.currentTime = 54;
    await act(async () => vi.advanceTimersByTime(50_001));
    expect(oldAudio).not.toHaveAttribute('src');
    expect(
      screen.queryByLabelText(messages.media.voiceLabel),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      messages.media.errors.FORBIDDEN,
    );
    await act(async () => vi.advanceTimersByTime(180_000));
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it('retains the seek position but asks for a native Play tap if the browser blocks resume', async () => {
    vi.useFakeTimers();
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValue(
      new DOMException('play blocked', 'NotAllowedError'),
    );
    mocks.read.mockImplementation(async () => ({
      ok: true,
      data: grant('voice'),
    }));
    render(subject('voice'));
    await act(async () =>
      fireEvent.click(
        screen.getByRole('button', { name: label('open', 'voice') }),
      ),
    );
    const oldAudio = screen.getByLabelText(
      messages.media.voiceLabel,
    ) as HTMLAudioElement;
    Object.defineProperty(oldAudio, 'paused', {
      configurable: true,
      value: false,
    });
    oldAudio.currentTime = 54;
    await act(async () => vi.advanceTimersByTime(50_001));
    const nextAudio = screen.getByLabelText(
      messages.media.voiceLabel,
    ) as HTMLAudioElement;
    Object.defineProperty(nextAudio, 'duration', {
      configurable: true,
      value: 180,
    });
    await act(async () => fireEvent.loadedMetadata(nextAudio));
    expect(nextAudio.currentTime).toBe(54);
    expect(screen.getByRole('status')).toHaveTextContent(
      messages.media.resumeReady,
    );
    expect(nextAudio).toHaveAttribute('controls');
  });

  it('preserves a paused clip position for explicit retry without autoauthorization or autoplay', async () => {
    vi.useFakeTimers();
    mocks.read.mockImplementation(async () => ({
      ok: true,
      data: grant('voice'),
    }));
    render(subject('voice'));
    await act(async () =>
      fireEvent.click(
        screen.getByRole('button', { name: label('open', 'voice') }),
      ),
    );
    const oldAudio = screen.getByLabelText(
      messages.media.voiceLabel,
    ) as HTMLAudioElement;
    oldAudio.currentTime = 25;
    await act(async () => vi.advanceTimersByTime(50_001));
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(oldAudio).not.toHaveAttribute('src');
    await act(async () =>
      fireEvent.click(
        screen.getByRole('button', { name: label('retry', 'voice') }),
      ),
    );
    const nextAudio = screen.getByLabelText(
      messages.media.voiceLabel,
    ) as HTMLAudioElement;
    expect(nextAudio).toHaveAttribute('preload', 'metadata');
    Object.defineProperty(nextAudio, 'duration', {
      configurable: true,
      value: 180,
    });
    fireEvent.loadedMetadata(nextAudio);
    expect(nextAudio.currentTime).toBe(25);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it('does not claim position restoration if native seeking fails', async () => {
    vi.useFakeTimers();
    mocks.read.mockImplementation(async () => ({
      ok: true,
      data: grant('voice'),
    }));
    render(subject('voice'));
    await act(async () =>
      fireEvent.click(
        screen.getByRole('button', { name: label('open', 'voice') }),
      ),
    );
    const oldAudio = screen.getByLabelText(
      messages.media.voiceLabel,
    ) as HTMLAudioElement;
    Object.defineProperty(oldAudio, 'paused', {
      configurable: true,
      value: false,
    });
    oldAudio.currentTime = 54;
    await act(async () => vi.advanceTimersByTime(50_001));
    const nextAudio = screen.getByLabelText(messages.media.voiceLabel);
    Object.defineProperty(nextAudio, 'currentTime', {
      configurable: true,
      set() {
        throw new Error('native seek failed');
      },
    });
    fireEvent.loadedMetadata(nextAudio);
    expect(screen.getByRole('status')).toHaveTextContent(
      messages.media.resumeUnavailable,
    );
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it('cancels pending active-playback reauthorization when navigation leaves the resource', async () => {
    vi.useFakeTimers();
    let finish: (value: MediaResult<MediaReadGrant>) => void = () => {};
    mocks.read
      .mockResolvedValueOnce({ ok: true, data: grant('voice') })
      .mockImplementationOnce(
        () =>
          new Promise<MediaResult<MediaReadGrant>>((resolve) => {
            finish = resolve;
          }),
      );
    const view = render(subject('voice'));
    await act(async () =>
      fireEvent.click(
        screen.getByRole('button', { name: label('open', 'voice') }),
      ),
    );
    const oldAudio = screen.getByLabelText(
      messages.media.voiceLabel,
    ) as HTMLAudioElement;
    Object.defineProperty(oldAudio, 'paused', {
      configurable: true,
      value: false,
    });
    oldAudio.currentTime = 54;
    await act(async () => vi.advanceTimersByTime(50_001));
    view.unmount();
    expect(mocks.read.mock.calls[1]?.[1].aborted).toBe(true);
    await act(async () => finish({ ok: true, data: grant('voice') }));
    expect(
      screen.queryByLabelText(messages.media.voiceLabel),
    ).not.toBeInTheDocument();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });
  it('invalidates a pending read on pagehide rather than restoring it later', async () => {
    let finish: (value: MediaResult<MediaReadGrant>) => void = () => {};
    mocks.read.mockImplementationOnce(
      () =>
        new Promise<MediaResult<MediaReadGrant>>((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(subject());
    fireEvent.click(screen.getByRole('button', { name: label('open') }));
    fireEvent(window, new Event('pagehide'));
    await act(async () => finish({ ok: true, data: grant() }));
    expect(view.container.querySelector('[src]')).toBeNull();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: label('retry') }),
      ).toBeEnabled(),
    );
    expect(mocks.read.mock.calls[0]?.[1].aborted).toBe(true);
  });
});
