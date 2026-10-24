import {
  SPEECH_LANGUAGE,
  SPEECH_MAX_RESULTS,
  SPEECH_MAX_TRANSCRIPT_LENGTH,
  SPEECH_MAX_TRANSCRIPT_CODE_UNITS,
  SPEECH_SESSION_TIMEOUT_MS,
  SPEECH_START_TIMEOUT_MS,
  SPEECH_STOP_TIMEOUT_MS,
  type SpeechError,
  type SpeechPhase,
} from '@/config/speech';

export type NativeSpeechResult = {
  readonly isFinal: boolean;
  readonly [index: number]: { readonly transcript: string } | undefined;
};
export type NativeSpeechEvent = {
  readonly resultIndex: number;
  readonly results: ArrayLike<NativeSpeechResult>;
};
export interface NativeSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: NativeSpeechEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onnomatch: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export type SpeechConstructor = new () => NativeSpeechRecognition;
type SpeechWindow = Window & {
  SpeechRecognition?: SpeechConstructor;
  webkitSpeechRecognition?: SpeechConstructor;
};
function constructor(): SpeechConstructor | null {
  if (typeof window === 'undefined' || window.isSecureContext !== true)
    return null;
  const browser = window as SpeechWindow;
  if (typeof browser.SpeechRecognition === 'function')
    return browser.SpeechRecognition;
  if (typeof browser.webkitSpeechRecognition === 'function')
    return browser.webkitSpeechRecognition;
  return null;
}
export function supportsSpeechRecognition(): boolean {
  return constructor() !== null;
}
function speechError(code: string): SpeechError {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'permission';
    case 'no-speech':
      return 'noSpeech';
    case 'network':
      return 'network';
    case 'audio-capture':
      return 'audio';
    case 'language-not-supported':
      return 'language';
    default:
      return 'unavailable';
  }
}
export type SpeechSession = {
  start(): void;
  stop(): void;
  abort(): void;
};
export type SpeechSessionCallbacks = {
  maxLength: number;
  onPhase: (phase: SpeechPhase) => void;
  onPreview: (text: string) => void;
  onResult: (text: string) => void;
  onError: (error: SpeechError) => void;
  onEnd: () => void;
};

// No audio streams, recordings, storage, remote fetch, automatic restart, or
// permission preflight. Only the explicit UI click may invoke start().
export function createSpeechSession(
  callbacks: SpeechSessionCallbacks,
): SpeechSession {
  let recognition: NativeSpeechRecognition | null = null;
  let started = false;
  let finished = false;
  let phase: SpeechPhase = 'starting';
  let finalText = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = Math.min(callbacks.maxLength, SPEECH_MAX_TRANSCRIPT_LENGTH);
  const detach = () => {
    clearTimeout(timer);
    if (!recognition) return;
    recognition.onstart = null;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onnomatch = null;
    recognition.onend = null;
  };
  const finish = (error?: SpeechError, abort = false) => {
    if (finished) return;
    finished = true;
    detach();
    if (abort) {
      try {
        recognition?.abort();
      } catch {
        /* Already disconnected. */
      }
    }
    const result = finalText;
    finalText = '';
    callbacks.onPreview('');
    if (error) callbacks.onError(error);
    else if (!abort && result.trim()) callbacks.onResult(result);
    else if (!abort) callbacks.onError('noSpeech');
    callbacks.onEnd();
  };
  const deadline = (duration: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => finish('timeout', true), duration);
  };
  return {
    start() {
      if (started || finished) return;
      started = true;
      if (!Number.isInteger(limit) || limit <= 0) {
        finish('tooLong');
        return;
      }
      const Native = constructor();
      if (!Native) {
        finish('unavailable');
        return;
      }
      try {
        recognition = new Native();
        recognition.lang = SPEECH_LANGUAGE;
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        recognition.onstart = () => {
          if (finished || phase !== 'starting') return;
          phase = 'listening';
          callbacks.onPhase(phase);
          deadline(SPEECH_SESSION_TIMEOUT_MS);
        };
        recognition.onresult = (event) => {
          if (finished) return;
          // results is a complete snapshot, not a delta. Replacing the interim
          // hypothesis and reading all finals prevents duplicate appends.
          try {
            if (
              !Number.isInteger(event.results.length) ||
              event.results.length > SPEECH_MAX_RESULTS ||
              event.results.length < 0
            ) {
              finish('unavailable', true);
              return;
            }
            let final = '';
            let preview = '';
            for (let index = 0; index < event.results.length; index += 1) {
              const result = event.results[index];
              const text = result?.[0]?.transcript;
              if (typeof text !== 'string') {
                finish('unavailable', true);
                return;
              }
              if (
                text.length > SPEECH_MAX_TRANSCRIPT_CODE_UNITS ||
                Array.from(preview + text).length > limit
              ) {
                finish('tooLong', true);
                return;
              }
              preview += text;
              if (result?.isFinal) final += text;
            }
            finalText = final;
            callbacks.onPreview(preview);
          } catch {
            finish('unavailable', true);
          }
        };
        recognition.onerror = (event) => {
          if (!finished) finish(speechError(event.error), true);
        };
        recognition.onnomatch = () => finish('noSpeech', true);
        recognition.onend = () => finish();
        callbacks.onPhase(phase);
        deadline(SPEECH_START_TIMEOUT_MS);
        recognition.start();
      } catch (error) {
        finish(
          error instanceof DOMException &&
            (error.name === 'NotAllowedError' || error.name === 'SecurityError')
            ? 'permission'
            : 'unavailable',
          true,
        );
      }
    },
    stop() {
      if (finished || !started || phase !== 'listening') return;
      phase = 'stopping';
      callbacks.onPhase(phase);
      deadline(SPEECH_STOP_TIMEOUT_MS);
      try {
        recognition?.stop();
      } catch {
        finish('unavailable', true);
      }
    },
    abort() {
      finish(undefined, true);
    },
  };
}
