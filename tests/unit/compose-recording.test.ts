import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createComposeRecording,
  supportsComposeRecording,
  type ComposeRecording,
} from '@/client/compose-recording';
import { COMPOSE_RECORDING } from '@/config/compose-capture';

class Track extends EventTarget {
  kind = 'audio';
  readyState = 'live';
  stop = vi.fn(() => {
    this.readyState = 'ended';
  });
}
class Recorder {
  static instances: Recorder[] = [];
  static isTypeSupported = vi.fn((mime: string) =>
    mime.startsWith('audio/webm'),
  );
  state = 'inactive';
  mimeType: string;
  onstart: (() => void) | null = null;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onerror: (() => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(
    readonly stream: MediaStream,
    readonly options: MediaRecorderOptions,
  ) {
    this.mimeType = options.mimeType!;
    Recorder.instances.push(this);
  }
  start = vi.fn(() => {
    this.state = 'recording';
  });
  stop = vi.fn(() => {
    this.state = 'inactive';
  });
  emitStart() {
    this.onstart?.();
  }
  emitData(size = 3) {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(size)]) });
  }
  emitStop() {
    this.state = 'inactive';
    this.onstop?.();
  }
}
let sessions: ComposeRecording[];
let track: Track;
let stream: MediaStream;
let getUserMedia: ReturnType<typeof vi.fn>;
function subject(options: { maxBytes?: number; maxDurationMs?: number } = {}) {
  const callbacks = {
    maxDurationMs: options.maxDurationMs ?? 180_000,
    maxBytes: options.maxBytes ?? 1000,
    onPhase: vi.fn(),
    onElapsed: vi.fn(),
    onResult: vi.fn(),
    onError: vi.fn(),
    onEnd: vi.fn(),
  };
  const session = createComposeRecording(callbacks);
  sessions.push(session);
  return { callbacks, session };
}
const latest = () => Recorder.instances.at(-1)!;
async function started(
  options: { maxBytes?: number; maxDurationMs?: number } = {},
) {
  const state = subject(options);
  state.session.start();
  await Promise.resolve();
  latest().emitStart();
  return { ...state, native: latest() };
}
beforeEach(() => {
  vi.useFakeTimers();
  sessions = [];
  track = new Track();
  stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  getUserMedia = vi.fn().mockResolvedValue(stream);
  Recorder.instances = [];
  Recorder.isTypeSupported = vi.fn((mime) => mime.startsWith('audio/webm'));
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('MediaRecorder', Recorder);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
});
afterEach(() => {
  sessions.forEach((session) => session.cancel());
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
// Synthetic native-contract events only. These tests never request a real
// microphone and do not establish physical-device codec/capture support.
describe('explicit browser recording contract', () => {
  it('probes capability without permission, stream, recording, network or storage', () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    expect(supportsComposeRecording()).toBe(true);
    subject();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(Recorder.instances).toHaveLength(0);
    expect(fetcher).not.toHaveBeenCalled();
    expect(storage).not.toHaveBeenCalled();
  });
  it('requests audio only once after start and uses a bounded native timeslice', async () => {
    const { session, callbacks } = subject();
    session.start();
    session.start();
    expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({
      audio: true,
      video: false,
    });
    await Promise.resolve();
    const native = latest();
    expect(native.options).toEqual({
      mimeType: 'audio/webm;codecs=opus',
      audioBitsPerSecond: COMPOSE_RECORDING.audioBitsPerSecond,
    });
    expect(native.start).toHaveBeenCalledExactlyOnceWith(
      COMPOSE_RECORDING.timesliceMs,
    );
    expect(callbacks.onPhase).toHaveBeenCalledExactlyOnceWith('requesting');
    native.emitStart();
    expect(callbacks.onPhase).toHaveBeenLastCalledWith('recording');
  });
  it('combines final chunks only after stop, normalizes MIME and removes private filename metadata', async () => {
    const { session, callbacks, native } = await started();
    native.emitData(7);
    expect(callbacks.onResult).not.toHaveBeenCalled();
    session.stop();
    session.stop();
    expect(native.stop).toHaveBeenCalledOnce();
    expect(track.stop).toHaveBeenCalledOnce();
    native.emitData(5);
    const lateStop = native.onstop;
    native.emitStop();
    lateStop?.();
    expect(callbacks.onResult).toHaveBeenCalledOnce();
    const [file] = callbacks.onResult.mock.calls[0]!;
    expect(file).toMatchObject({
      size: 12,
      type: 'audio/webm',
      name: 'recording.webm',
      lastModified: 0,
    });
    expect(callbacks.onEnd).toHaveBeenCalledOnce();
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('uses MP4 when WebM is unsupported', async () => {
    Recorder.isTypeSupported = vi.fn((mime) => mime === 'audio/mp4');
    const { session, callbacks, native } = await started();
    expect(native.mimeType).toBe('audio/mp4');
    native.emitData();
    session.stop();
    native.emitStop();
    expect(callbacks.onResult.mock.calls[0]![0]).toMatchObject({
      name: 'recording.m4a',
      type: 'audio/mp4',
    });
  });
  it.each([false, undefined])(
    'fails closed without secure context %j',
    (value) => {
      vi.stubGlobal('isSecureContext', value);
      expect(supportsComposeRecording()).toBe(false);
      const { session, callbacks } = subject();
      session.start();
      expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith('unavailable');
      expect(getUserMedia).not.toHaveBeenCalled();
    },
  );
  it('can be inspected and rejected without a browser global', () => {
    vi.stubGlobal('window', undefined);
    expect(supportsComposeRecording()).toBe(false);
    const { session, callbacks } = subject();
    session.start();
    expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith('unavailable');
  });
  it.each([0, -1, 1.1, NaN, Infinity, COMPOSE_RECORDING.maxDurationMs + 1])(
    'rejects invalid duration %j before requesting',
    (maxDurationMs) => {
      const { session, callbacks } = subject({ maxDurationMs });
      session.start();
      expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith('unavailable');
      expect(getUserMedia).not.toHaveBeenCalled();
    },
  );
  it.each([0, -1, 1.1, NaN, Infinity, COMPOSE_RECORDING.maxBytes + 1])(
    'rejects invalid capacity %j before requesting',
    (maxBytes) => {
      const { session, callbacks } = subject({ maxBytes });
      session.start();
      expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith('unavailable');
      expect(getUserMedia).not.toHaveBeenCalled();
    },
  );
});
describe('capture cancellation, bounds, and resource release', () => {
  it('cancels without returning data and ignores retained late native callbacks', async () => {
    const { session, callbacks, native } = await started();
    native.emitData();
    const lateData = native.ondataavailable;
    const lateStop = native.onstop;
    session.cancel();
    session.cancel();
    session.start();
    lateData?.({ data: new Blob(['private audio']) });
    lateStop?.();
    expect(callbacks.onEnd).toHaveBeenCalledOnce();
    expect(callbacks.onResult).not.toHaveBeenCalled();
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('retains the single-flight lock until a canceled permission request settles and stops the late grant', async () => {
    let grant!: (value: MediaStream) => void;
    getUserMedia.mockReturnValueOnce(
      new Promise<MediaStream>((resolve) => {
        grant = resolve;
      }),
    );
    const first = subject();
    first.session.start();
    first.session.cancel();
    const second = subject();
    second.session.start();
    expect(second.callbacks.onError).toHaveBeenCalledExactlyOnceWith('busy');
    grant(stream);
    await Promise.resolve();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(Recorder.instances).toHaveLength(0);
    expect(first.callbacks.onResult).not.toHaveBeenCalled();
    track.readyState = 'live';
    const third = subject();
    third.session.start();
    await Promise.resolve();
    expect(Recorder.instances).toHaveLength(1);
  });
  it('does not open a concurrent second recorder', async () => {
    await started();
    const second = subject();
    second.session.start();
    expect(second.callbacks.onError).toHaveBeenCalledExactlyOnceWith('busy');
    expect(getUserMedia).toHaveBeenCalledOnce();
  });
  it.each([
    ['NotAllowedError', 'permission'],
    ['SecurityError', 'permission'],
    ['NotFoundError', 'device'],
    ['NotReadableError', 'device'],
    ['UnknownError', 'unavailable'],
  ])('normalizes %s without raw diagnostics', async (name, expected) => {
    getUserMedia.mockRejectedValueOnce(
      new DOMException('Private device information', name),
    );
    const { session, callbacks } = subject();
    session.start();
    await Promise.resolve();
    expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith(expected);
    expect(callbacks.onEnd).toHaveBeenCalledOnce();
  });
  it('releases canceled permission lock after a late rejection', async () => {
    let reject!: (error: Error) => void;
    getUserMedia.mockReturnValueOnce(
      new Promise((_, fail) => {
        reject = fail;
      }),
    );
    const first = subject();
    first.session.start();
    first.session.cancel();
    reject(new Error('private'));
    await Promise.resolve();
    const second = subject();
    second.session.start();
    await Promise.resolve();
    expect(Recorder.instances).toHaveLength(1);
    expect(first.callbacks.onError).not.toHaveBeenCalled();
  });
  it('times out a native start that never emits and stops the granted stream', async () => {
    const { session, callbacks } = subject();
    session.start();
    await Promise.resolve();
    vi.advanceTimersByTime(COMPOSE_RECORDING.requestTimeoutMs);
    expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith('timeout');
    expect(track.stop).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('automatically stops at the current duration limit but waits for finalized bytes', async () => {
    const { callbacks, native } = await started({ maxDurationMs: 1000 });
    vi.advanceTimersByTime(1000);
    expect(native.stop).toHaveBeenCalledOnce();
    expect(callbacks.onPhase).toHaveBeenLastCalledWith('stopping');
    expect(callbacks.onResult).not.toHaveBeenCalled();
    native.emitData();
    native.emitStop();
    expect(callbacks.onResult).toHaveBeenCalledOnce();
  });
  it('rejects aggregate byte overflow and releases recording resources', async () => {
    const { callbacks, native } = await started({ maxBytes: 5 });
    native.emitData(3);
    native.emitData(3);
    expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith('tooLarge');
    expect(callbacks.onResult).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalledOnce();
  });
  it('rejects empty finalized output', async () => {
    const { callbacks, native, session } = await started();
    native.emitData(0);
    session.stop();
    native.emitStop();
    expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith('empty');
  });
  it('times out missing final stop events without accepting partial data', async () => {
    const { callbacks, native, session } = await started();
    native.emitData();
    session.stop();
    vi.advanceTimersByTime(COMPOSE_RECORDING.stopTimeoutMs);
    expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith('timeout');
    expect(callbacks.onResult).not.toHaveBeenCalled();
  });
  it.each(['pagehide', 'popstate'])('cancels capture on %s', async (name) => {
    const { callbacks } = await started();
    window.dispatchEvent(new Event(name));
    expect(track.stop).toHaveBeenCalledOnce();
    expect(callbacks.onResult).not.toHaveBeenCalled();
    expect(callbacks.onEnd).toHaveBeenCalledOnce();
  });
  it('cancels capture when backgrounded', async () => {
    const { callbacks } = await started();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(callbacks.onEnd).toHaveBeenCalledOnce();
    expect(track.stop).toHaveBeenCalledOnce();
  });
  it('handles a disconnected microphone without accepting partial output', async () => {
    const { callbacks, native } = await started();
    native.emitData();
    track.dispatchEvent(new Event('ended'));
    expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith('device');
    expect(callbacks.onResult).not.toHaveBeenCalled();
  });
  it('handles a native recorder error without leaking diagnostics', async () => {
    const { callbacks, native } = await started();
    native.onerror?.();
    expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith('unavailable');
    expect(track.stop).toHaveBeenCalledOnce();
  });
  it('rejects an unexpected stop instead of inventing completed output', async () => {
    const { callbacks, native } = await started();
    native.emitData();
    native.emitStop();
    expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith('device');
  });
});
