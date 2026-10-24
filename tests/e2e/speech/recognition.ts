import type { Page } from '@playwright/test';

// Deliberately synthetic native-API contract harness. It neither asks for a
// microphone grant nor creates audio, media tracks or a recognition connection.
// It is not evidence of a real browser/device/vendor speech service working.
export type SpeechPart = { text: string; final: boolean };
type Snapshot = {
  constructed: number;
  starts: number;
  stops: number;
  aborts: number;
  options: {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    maxAlternatives: number;
  }[];
};
type SpeechHarness = {
  snapshot(): Snapshot;
  started(): void;
  results(parts: SpeechPart[], resultIndex?: number): void;
  error(code: string): void;
  end(): void;
  noMatch(): void;
  lateResults(parts: SpeechPart[]): void;
};
declare global {
  interface Window {
    __speechFixture: SpeechHarness;
  }
}
export async function installSpeech(
  page: Page,
  options: {
    capability?: 'standard' | 'webkit' | 'none';
    delayStart?: boolean;
    startError?: string;
  } = {},
) {
  await page.addInitScript(
    ({ capability, delayStart, startError }) => {
      type RecognitionResult = {
        length: number;
        isFinal: boolean;
        [key: number]: { transcript: string; confidence: number };
      };
      type ResultEvent = { resultIndex: number; results: RecognitionResult[] };
      const instances: TestRecognition[] = [];
      let starts = 0;
      let stops = 0;
      let aborts = 0;
      let savedResult: ((event: ResultEvent) => void) | null = null;
      const eventFor = (parts: SpeechPart[], resultIndex = 0): ResultEvent => ({
        resultIndex,
        results: parts.map(({ text, final }) => ({
          length: 1,
          isFinal: final,
          0: { transcript: text, confidence: 1 },
        })),
      });
      const current = () => {
        const instance = instances.at(-1);
        if (!instance) throw new Error('No synthetic recognition session.');
        return instance;
      };
      class TestRecognition {
        lang = '';
        continuous = false;
        interimResults = false;
        maxAlternatives = 1;
        onstart: ((event: Event) => void) | null = null;
        onaudiostart: ((event: Event) => void) | null = null;
        onaudioend: ((event: Event) => void) | null = null;
        onend: ((event: Event) => void) | null = null;
        onerror: ((event: { error: string; message: string }) => void) | null =
          null;
        onnomatch: ((event: Event) => void) | null = null;
        onresult: ((event: ResultEvent) => void) | null = null;
        constructor() {
          instances.push(this);
        }
        start() {
          starts++;
          savedResult = this.onresult;
          if (startError)
            throw new DOMException('Synthetic start error', startError);
          if (!delayStart)
            queueMicrotask(() => {
              this.onstart?.(new Event('start'));
              this.onaudiostart?.(new Event('audiostart'));
            });
        }
        stop() {
          stops++;
          this.onaudioend?.(new Event('audioend'));
          // Native stop may deliver final results asynchronously before onend.
          // The test controls that ordering explicitly instead of assuming success.
        }
        abort() {
          aborts++;
          this.onaudioend?.(new Event('audioend'));
          this.onend?.(new Event('end'));
        }
      }
      const harness: SpeechHarness = {
        snapshot: () => ({
          constructed: instances.length,
          starts,
          stops,
          aborts,
          options: instances.map((item) => ({
            lang: item.lang,
            continuous: item.continuous,
            interimResults: item.interimResults,
            maxAlternatives: item.maxAlternatives,
          })),
        }),
        started() {
          current().onstart?.(new Event('start'));
          current().onaudiostart?.(new Event('audiostart'));
        },
        results(parts, index = 0) {
          current().onresult?.(eventFor(parts, index));
        },
        error(code) {
          current().onerror?.({
            error: code,
            message: 'Untrusted diagnostic must not be displayed',
          });
        },
        end() {
          current().onaudioend?.(new Event('audioend'));
          current().onend?.(new Event('end'));
        },
        noMatch() {
          current().onnomatch?.(new Event('nomatch'));
        },
        lateResults(parts) {
          savedResult?.(eventFor(parts));
        },
      };
      Object.defineProperty(window, '__speechFixture', {
        configurable: true,
        value: harness,
      });
      for (const name of ['SpeechRecognition', 'webkitSpeechRecognition'])
        Object.defineProperty(window, name, {
          configurable: true,
          value: undefined,
        });
      if (capability !== 'none')
        Object.defineProperty(
          window,
          capability === 'webkit'
            ? 'webkitSpeechRecognition'
            : 'SpeechRecognition',
          {
            configurable: true,
            value: TestRecognition,
          },
        );
    },
    {
      capability: options.capability ?? 'standard',
      delayStart: options.delayStart ?? false,
      startError: options.startError ?? '',
    },
  );
}
export async function speechSnapshot(page: Page) {
  return page.evaluate(() => window.__speechFixture.snapshot());
}
export async function speechResult(
  page: Page,
  parts: SpeechPart[],
  resultIndex = 0,
) {
  await page.evaluate(
    ({ parts, resultIndex }) =>
      window.__speechFixture.results(parts, resultIndex),
    { parts, resultIndex },
  );
}
export async function speechEnd(page: Page) {
  await page.evaluate(() => window.__speechFixture.end());
}
export async function speechError(page: Page, code: string) {
  await page.evaluate((value) => window.__speechFixture.error(value), code);
}
export async function lateSpeechResult(page: Page, text: string) {
  await page.evaluate(
    (value) =>
      window.__speechFixture.lateResults([{ text: value, final: true }]),
    text,
  );
}
