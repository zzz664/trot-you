import { vi } from 'vitest';

export type ControlledSpeechResult = {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: { readonly transcript: string };
};
export type ControlledSpeechEvent = {
  readonly resultIndex: number;
  readonly results: ArrayLike<ControlledSpeechResult>;
};

// A synthetic event source only. It never calls a browser permission API,
// obtains microphone data, contacts a recognizer or verifies device support.
export class ControlledSpeechRecognition {
  static instances: ControlledSpeechRecognition[] = [];
  lang = '';
  continuous = true;
  interimResults = false;
  maxAlternatives = 0;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onresult: ((event: ControlledSpeechEvent) => void) | null = null;
  onerror: ((event: { error: string; message?: string }) => void) | null = null;
  onnomatch: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();

  constructor() {
    ControlledSpeechRecognition.instances.push(this);
  }

  emitStart() {
    this.onstart?.();
  }
  emitEnd() {
    this.onend?.();
  }
  emitError(error: string) {
    this.onerror?.({ error, message: 'Untrusted browser diagnostic' });
  }
  emitResults(
    parts: ReadonlyArray<readonly [text: string, final: boolean]>,
    resultIndex = 0,
  ) {
    this.onresult?.(speechResults(parts, resultIndex));
  }
}

export function speechResults(
  parts: ReadonlyArray<readonly [text: string, final: boolean]>,
  resultIndex = 0,
): ControlledSpeechEvent {
  return {
    resultIndex,
    results: parts.map(([transcript, isFinal]) => ({
      0: { transcript },
      length: 1,
      isFinal,
    })),
  };
}

export function installSpeechStub(
  constructorName:
    'SpeechRecognition' | 'webkitSpeechRecognition' = 'SpeechRecognition',
) {
  ControlledSpeechRecognition.instances = [];
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('SpeechRecognition', undefined);
  vi.stubGlobal('webkitSpeechRecognition', undefined);
  vi.stubGlobal(constructorName, ControlledSpeechRecognition);
}

export function latestSpeechRecognition() {
  const instance = ControlledSpeechRecognition.instances.at(-1);
  if (!instance) throw new Error('Expected an explicit synthetic speech start');
  return instance;
}
