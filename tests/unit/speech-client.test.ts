import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSpeechSession,
  supportsSpeechRecognition,
  type NativeSpeechEvent,
} from '@/client/speech';
import {
  SPEECH_LANGUAGE,
  SPEECH_MAX_RESULTS,
  SPEECH_MAX_TRANSCRIPT_LENGTH,
  SPEECH_SESSION_TIMEOUT_MS,
  SPEECH_START_TIMEOUT_MS,
  SPEECH_STOP_TIMEOUT_MS,
} from '@/config/speech';
import {
  ControlledSpeechRecognition,
  installSpeechStub,
  latestSpeechRecognition,
  speechResults,
} from './speech-fixtures';

function subject(maxLength = 100) {
  const callbacks = {
    maxLength,
    onPhase: vi.fn(),
    onPreview: vi.fn(),
    onResult: vi.fn(),
    onError: vi.fn(),
    onEnd: vi.fn(),
  };
  return { callbacks, session: createSpeechSession(callbacks) };
}
function started(maxLength = 100) {
  const state = subject(maxLength);
  state.session.start();
  const native = latestSpeechRecognition();
  native.emitStart();
  return { ...state, native };
}

beforeEach(() => {
  vi.useFakeTimers();
  installSpeechStub();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// These tests exercise an application contract with synthetic native events.
// They do not establish microphone permissions, Korean transcription quality,
// vendor service availability or real-device browser support.
describe('speech API capability and explicit startup contract', () => {
  it.each(['SpeechRecognition', 'webkitSpeechRecognition'] as const)(
    'detects %s without constructing or starting an instance',
    (name) => {
      installSpeechStub(name);
      expect(supportsSpeechRecognition()).toBe(true);
      const { session } = subject();
      expect(ControlledSpeechRecognition.instances).toHaveLength(0);
      session.start();
      expect(latestSpeechRecognition().start).toHaveBeenCalledOnce();
    },
  );
  it('prefers the standard constructor when both exist', () => {
    const prefixed = vi.fn();
    vi.stubGlobal('webkitSpeechRecognition', prefixed);
    subject().session.start();
    expect(ControlledSpeechRecognition.instances).toHaveLength(1);
    expect(prefixed).not.toHaveBeenCalled();
  });
  it('can use a prefixed constructor when the standard property is not callable', () => {
    installSpeechStub('webkitSpeechRecognition');
    vi.stubGlobal('SpeechRecognition', {});
    expect(supportsSpeechRecognition()).toBe(true);
    subject().session.start();
    expect(ControlledSpeechRecognition.instances).toHaveLength(1);
  });
  it.each([false, undefined])(
    'does not expose microphone startup in insecure/unknown context %j',
    (secure) => {
      vi.stubGlobal('isSecureContext', secure);
      expect(supportsSpeechRecognition()).toBe(false);
      const { callbacks, session } = subject();
      session.start();
      expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith('unavailable');
      expect(callbacks.onEnd).toHaveBeenCalledOnce();
      expect(ControlledSpeechRecognition.instances).toHaveLength(0);
    },
  );
  it('returns unsupported on the server without reading browser globals', () => {
    vi.stubGlobal('window', undefined);
    expect(supportsSpeechRecognition()).toBe(false);
    const { callbacks, session } = subject();
    session.start();
    expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith('unavailable');
    expect(ControlledSpeechRecognition.instances).toHaveLength(0);
  });
  it('returns unsupported when neither API is callable', () => {
    vi.stubGlobal('SpeechRecognition', undefined);
    vi.stubGlobal('webkitSpeechRecognition', {});
    expect(supportsSpeechRecognition()).toBe(false);
    const { callbacks, session } = subject();
    session.start();
    expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith('unavailable');
    expect(ControlledSpeechRecognition.instances).toHaveLength(0);
  });
  it('configures one-shot Korean recognition and starts only once without app I/O', () => {
    const fetcher = vi.fn();
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    vi.stubGlobal('fetch', fetcher);
    const { callbacks, session } = subject();
    session.start();
    session.start();
    const native = latestSpeechRecognition();
    expect(native.lang).toBe(SPEECH_LANGUAGE);
    expect(native.continuous).toBe(false);
    expect(native.interimResults).toBe(true);
    expect(native.maxAlternatives).toBe(1);
    expect(native.start).toHaveBeenCalledExactlyOnceWith();
    expect(callbacks.onPhase).toHaveBeenCalledExactlyOnceWith('starting');
    expect(callbacks.onResult).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(storage).not.toHaveBeenCalled();
  });
  it.each([0, -1, 0.5, Number.NaN])(
    'rejects invalid or exhausted capacity %j before constructing',
    (maxLength) => {
      const { callbacks, session } = subject(maxLength);
      session.start();
      expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith('tooLong');
      expect(callbacks.onEnd).toHaveBeenCalledOnce();
      expect(ControlledSpeechRecognition.instances).toHaveLength(0);
    },
  );
  it('reports constructor failure without exposing diagnostics or attempting restart', () => {
    const constructor = vi.fn(function () {
      throw new Error('Private provider diagnostic');
    });
    vi.stubGlobal('SpeechRecognition', constructor);
    const { callbacks, session } = subject();
    session.start();
    session.start();
    expect(constructor).toHaveBeenCalledOnce();
    expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith('unavailable');
    expect(callbacks.onEnd).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([
    ['NotAllowedError', 'permission'],
    ['SecurityError', 'permission'],
    ['InvalidStateError', 'unavailable'],
  ])('normalizes thrown %s from native start to %s', (name, expected) => {
    class RejectingRecognition extends ControlledSpeechRecognition {
      override start = vi.fn(() => {
        throw new DOMException('Untrusted diagnostic', name);
      });
    }
    vi.stubGlobal('SpeechRecognition', RejectingRecognition);
    const { callbacks, session } = subject();
    session.start();
    expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith(expected);
    expect(latestSpeechRecognition().abort).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('speech result snapshots and draft-only completion', () => {
  it('replaces partial hypotheses and commits final text once only after end', () => {
    const { native, callbacks, session } = started();
    native.emitResults([['안', false]]);
    native.emitResults([['안녕', false]]);
    native.emitResults([['안녕하세요.', true]]);
    native.emitResults([['안녕하세요.', true]]);
    expect(callbacks.onPreview.mock.calls.map(([text]) => text)).toEqual([
      '안',
      '안녕',
      '안녕하세요.',
      '안녕하세요.',
    ]);
    expect(callbacks.onResult).not.toHaveBeenCalled();
    const lateEnd = native.onend;
    native.emitEnd();
    lateEnd?.();
    session.start();
    expect(callbacks.onResult).toHaveBeenCalledExactlyOnceWith('안녕하세요.');
    expect(callbacks.onPreview).toHaveBeenLastCalledWith('');
    expect(callbacks.onEnd).toHaveBeenCalledOnce();
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(native.start).toHaveBeenCalledOnce();
    expect(native.abort).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('reads all final prefix entries even when resultIndex only points to the changed suffix', () => {
    const { native, callbacks } = started();
    native.emitResults([
      ['늘 ', true],
      ['응', false],
    ]);
    native.emitResults(
      [
        ['늘 ', true],
        ['응원합니다.', true],
      ],
      1,
    );
    native.emitEnd();
    expect(callbacks.onResult).toHaveBeenCalledExactlyOnceWith(
      '늘 응원합니다.',
    );
  });
  it('removes an interim suffix when results shrinks and resultIndex equals its length', () => {
    const { native, callbacks } = started();
    native.emitResults([
      ['고마워요.', true],
      [' 임시 문장', false],
    ]);
    native.emitResults([['고마워요.', true]], 1);
    expect(callbacks.onPreview).toHaveBeenLastCalledWith('고마워요.');
    native.emitEnd();
    expect(callbacks.onResult).toHaveBeenCalledExactlyOnceWith('고마워요.');
  });
  it('allows an empty snapshot to clear a partial hypothesis without accepting it', () => {
    const { native, callbacks } = started();
    native.emitResults([['임시', false]]);
    native.emitResults([]);
    expect(callbacks.onPreview).toHaveBeenLastCalledWith('');
    native.emitEnd();
    expect(callbacks.onResult).not.toHaveBeenCalled();
    expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith('noSpeech');
  });
  it('does not accept interim-only recognition on disconnection', () => {
    const { native, callbacks } = started();
    native.emitResults([['아직 확정되지 않음', false]]);
    native.emitEnd();
    expect(callbacks.onResult).not.toHaveBeenCalled();
    expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith('noSpeech');
  });
  it.each(['', '   ', '\n\t'])(
    'does not accept a blank final transcript %j',
    (text) => {
      const { native, callbacks } = started();
      native.emitResults([[text, true]]);
      native.emitEnd();
      expect(callbacks.onResult).not.toHaveBeenCalled();
      expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith('noSpeech');
    },
  );
  it('preserves literal markup, placeholders, spaces and newlines in recognized text', () => {
    const text = '  <b>{이름}</b>\n응원해요.  ';
    const { native, callbacks } = started();
    native.emitResults([[text, true]]);
    native.emitEnd();
    expect(callbacks.onResult).toHaveBeenCalledExactlyOnceWith(text);
  });
  it('reads native array-like snapshots without requiring array methods', () => {
    const { native, callbacks } = started();
    native.onresult?.({
      resultIndex: 0,
      results: {
        length: 1,
        0: { length: 1, isFinal: true, 0: { transcript: '브라우저 결과' } },
      },
    });
    native.emitEnd();
    expect(callbacks.onResult).toHaveBeenCalledExactlyOnceWith('브라우저 결과');
  });
  it('counts Unicode scalars instead of UTF-16 units at the draft capacity', () => {
    const { native, callbacks } = started(3);
    native.emitResults([['🙂한🧡', true]]);
    native.emitEnd();
    expect(callbacks.onResult).toHaveBeenCalledExactlyOnceWith('🙂한🧡');
    expect(callbacks.onError).not.toHaveBeenCalled();
  });
  it('accepts the full technical scalar maximum even for supplementary Unicode characters', () => {
    const text = '🙂'.repeat(SPEECH_MAX_TRANSCRIPT_LENGTH);
    const { native, callbacks } = started(SPEECH_MAX_TRANSCRIPT_LENGTH);
    native.emitResults([[text, true]]);
    native.emitEnd();
    expect(callbacks.onResult).toHaveBeenCalledExactlyOnceWith(text);
    expect(callbacks.onError).not.toHaveBeenCalled();
  });
  it.each([true, false])(
    'rejects oversized %s-final snapshots without truncating or committing an earlier final',
    (isFinal) => {
      const { native, callbacks } = started(3);
      native.emitResults([['가', true]]);
      native.emitResults([
        ['가', true],
        ['🙂나🧡', isFinal],
      ]);
      native.emitEnd();
      expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith('tooLong');
      expect(callbacks.onResult).not.toHaveBeenCalled();
      expect(callbacks.onPreview).toHaveBeenLastCalledWith('');
      expect(native.abort).toHaveBeenCalledOnce();
      expect(callbacks.onEnd).toHaveBeenCalledOnce();
    },
  );
  it('applies the technical transcript bound even if a caller provides a larger capacity', () => {
    const { native, callbacks } = started(SPEECH_MAX_TRANSCRIPT_LENGTH + 1);
    native.emitResults([['가'.repeat(SPEECH_MAX_TRANSCRIPT_LENGTH + 1), true]]);
    expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith('tooLong');
    expect(callbacks.onResult).not.toHaveBeenCalled();
  });
  it.each([
    -1,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    SPEECH_MAX_RESULTS + 1,
  ])('rejects invalid/unbounded result-list length %j', (length) => {
    const { native, callbacks } = started();
    native.onresult?.({ resultIndex: 0, results: { length } });
    expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith('unavailable');
    expect(native.abort).toHaveBeenCalledOnce();
    expect(callbacks.onResult).not.toHaveBeenCalled();
  });
  it('fails closed on a missing transcript rather than preserving a prior result', () => {
    const { native, callbacks } = started();
    native.emitResults([['기존 확정', true]]);
    const malformed: NativeSpeechEvent = {
      resultIndex: 0,
      results: { length: 1, 0: { isFinal: true } },
    };
    native.onresult?.(
      malformed as Parameters<NonNullable<typeof native.onresult>>[0],
    );
    native.emitEnd();
    expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith('unavailable');
    expect(callbacks.onResult).not.toHaveBeenCalled();
  });
  it('normalizes an unreadable result snapshot without leaking the thrown diagnostic', () => {
    const { native, callbacks } = started();
    native.onresult?.({
      resultIndex: 0,
      get results(): never {
        throw new Error('Untrusted recognizer diagnostic');
      },
    });
    expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith('unavailable');
    expect(callbacks.onEnd).toHaveBeenCalledOnce();
    expect(native.abort).toHaveBeenCalledOnce();
  });
});

describe('speech stop, abort and terminal event ordering', () => {
  it('stops once and waits for the final result before applying it', () => {
    const { native, callbacks, session } = started();
    native.emitResults([['고마', false]]);
    session.stop();
    session.stop();
    expect(native.stop).toHaveBeenCalledOnce();
    expect(callbacks.onPhase.mock.calls.map(([phase]) => phase)).toEqual([
      'starting',
      'listening',
      'stopping',
    ]);
    expect(callbacks.onResult).not.toHaveBeenCalled();
    expect(callbacks.onEnd).not.toHaveBeenCalled();
    native.emitResults([['고마워요.', true]]);
    native.emitEnd();
    expect(callbacks.onResult).toHaveBeenCalledExactlyOnceWith('고마워요.');
    expect(callbacks.onEnd).toHaveBeenCalledOnce();
    expect(native.abort).not.toHaveBeenCalled();
  });
  it('does not stop before start or while native permission is pending', () => {
    const { callbacks, session } = subject();
    session.stop();
    expect(ControlledSpeechRecognition.instances).toHaveLength(0);
    session.start();
    const native = latestSpeechRecognition();
    session.stop();
    expect(native.stop).not.toHaveBeenCalled();
    expect(callbacks.onEnd).not.toHaveBeenCalled();
    session.abort();
    expect(native.abort).toHaveBeenCalledOnce();
  });
  it('discards all final and interim text on cancel and ignores captured late handlers', () => {
    const { native, callbacks, session } = started();
    native.emitResults([
      ['확정 문장', true],
      [' 임시 문장', false],
    ]);
    const late = {
      start: native.onstart,
      result: native.onresult,
      error: native.onerror,
      end: native.onend,
      nomatch: native.onnomatch,
    };
    session.abort();
    session.abort();
    late.start?.();
    late.result?.(speechResults([['늦게 도착한 문장', true]]));
    late.error?.({ error: 'network' });
    late.nomatch?.();
    late.end?.();
    session.start();
    session.stop();
    expect(native.abort).toHaveBeenCalledOnce();
    expect(native.start).toHaveBeenCalledOnce();
    expect(native.stop).not.toHaveBeenCalled();
    expect(callbacks.onResult).not.toHaveBeenCalled();
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(callbacks.onPreview).toHaveBeenLastCalledWith('');
    expect(callbacks.onEnd).toHaveBeenCalledOnce();
    expect(native.onstart).toBeNull();
    expect(native.onresult).toBeNull();
    expect(native.onerror).toBeNull();
    expect(native.onnomatch).toBeNull();
    expect(native.onend).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels before start without ever constructing native speech', () => {
    const { callbacks, session } = subject();
    session.abort();
    session.start();
    expect(ControlledSpeechRecognition.instances).toHaveLength(0);
    expect(callbacks.onEnd).toHaveBeenCalledOnce();
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(callbacks.onResult).not.toHaveBeenCalled();
  });
  it('allows cancellation while waiting for a stop result without accepting late final text', () => {
    const { native, callbacks, session } = started();
    const lateResult = native.onresult;
    const lateEnd = native.onend;
    session.stop();
    session.abort();
    lateResult?.(speechResults([['취소 후 최종 결과', true]]));
    lateEnd?.();
    expect(native.stop).toHaveBeenCalledOnce();
    expect(native.abort).toHaveBeenCalledOnce();
    expect(callbacks.onResult).not.toHaveBeenCalled();
    expect(callbacks.onEnd).toHaveBeenCalledOnce();
  });
  it('handles a synchronous native abort/end without a duplicate completion', () => {
    const { native, callbacks, session } = started();
    native.abort.mockImplementation(() => native.emitEnd());
    session.abort();
    expect(callbacks.onEnd).toHaveBeenCalledOnce();
    expect(callbacks.onResult).not.toHaveBeenCalled();
  });
  it('still cleans up when native abort throws', () => {
    const { native, callbacks, session } = started();
    native.abort.mockImplementation(() => {
      throw new DOMException('Already stopped', 'InvalidStateError');
    });
    expect(() => session.abort()).not.toThrow();
    expect(callbacks.onEnd).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('normalizes stop failure and discards previously recognized final text', () => {
    const { native, callbacks, session } = started();
    native.emitResults([['보류된 확정 문장', true]]);
    native.stop.mockImplementation(() => {
      throw new Error('Untrusted stop diagnostic');
    });
    session.stop();
    expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith('unavailable');
    expect(callbacks.onResult).not.toHaveBeenCalled();
    expect(native.abort).toHaveBeenCalledOnce();
    expect(callbacks.onEnd).toHaveBeenCalledOnce();
  });
});

describe('speech errors and bounded native service lifetime', () => {
  it.each([
    ['not-allowed', 'permission'],
    ['service-not-allowed', 'permission'],
    ['no-speech', 'noSpeech'],
    ['network', 'network'],
    ['audio-capture', 'audio'],
    ['language-not-supported', 'language'],
    ['aborted', 'unavailable'],
    ['phrases-not-supported', 'unavailable'],
    ['unknown-provider-detail', 'unavailable'],
  ])(
    'normalizes native %s as %s with no transcript or diagnostic leakage',
    (code, expected) => {
      const { native, callbacks, session } = started();
      native.emitResults([['공개하지 않을 초안', true]]);
      const lateEnd = native.onend;
      native.emitError(code);
      lateEnd?.();
      session.start();
      expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith(expected);
      expect(callbacks.onResult).not.toHaveBeenCalled();
      expect(callbacks.onEnd).toHaveBeenCalledOnce();
      expect(native.abort).toHaveBeenCalledOnce();
      expect(native.start).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it('handles nomatch as no-speech without committing a previous result', () => {
    const { native, callbacks } = started();
    native.emitResults([['이전 후보', true]]);
    native.onnomatch?.();
    expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith('noSpeech');
    expect(callbacks.onResult).not.toHaveBeenCalled();
    expect(native.abort).toHaveBeenCalledOnce();
  });
  it('aborts a permission/start request that never emits start', () => {
    const { callbacks, session } = subject();
    session.start();
    const native = latestSpeechRecognition();
    const lateStart = native.onstart;
    vi.advanceTimersByTime(SPEECH_START_TIMEOUT_MS - 1);
    expect(callbacks.onEnd).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    lateStart?.();
    expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith('timeout');
    expect(native.abort).toHaveBeenCalledOnce();
    expect(callbacks.onPhase).toHaveBeenCalledExactlyOnceWith('starting');
    expect(callbacks.onEnd).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('replaces the permission timeout with a finite listening lifetime without extending it on results', () => {
    const { callbacks, session } = subject();
    session.start();
    const native = latestSpeechRecognition();
    vi.advanceTimersByTime(SPEECH_START_TIMEOUT_MS - 1);
    native.emitStart();
    vi.advanceTimersByTime(SPEECH_SESSION_TIMEOUT_MS - 1);
    native.emitResults([['아직 듣는 중', true]]);
    expect(callbacks.onEnd).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith('timeout');
    expect(callbacks.onResult).not.toHaveBeenCalled();
    expect(native.abort).toHaveBeenCalledOnce();
    expect(callbacks.onEnd).toHaveBeenCalledOnce();
  });
  it('times out a stop that never disconnects rather than committing partial or final text early', () => {
    const { native, callbacks, session } = started();
    native.emitResults([['확정 후보', true]]);
    session.stop();
    vi.advanceTimersByTime(SPEECH_STOP_TIMEOUT_MS - 1);
    expect(callbacks.onEnd).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith('timeout');
    expect(callbacks.onResult).not.toHaveBeenCalled();
    expect(native.abort).toHaveBeenCalledOnce();
    expect(callbacks.onEnd).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not retain timers or restart recognition after natural completion', () => {
    const { native, callbacks } = started();
    native.emitResults([['끝난 문장', true]]);
    native.emitEnd();
    vi.advanceTimersByTime(SPEECH_SESSION_TIMEOUT_MS * 2);
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(callbacks.onEnd).toHaveBeenCalledOnce();
    expect(native.start).toHaveBeenCalledOnce();
    expect(native.abort).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
