import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

// Controlled native API contract only. No permission grant, microphone, user
// audio or external recording service. The emitted bytes are the existing
// generated sine-tone fixture, not browser/device capture evidence.
type RecordingSnapshot = {
  requests: number;
  starts: number;
  stops: number;
  tracksStopped: number;
  constraints: unknown[];
};
type RecordingHarness = {
  snapshot(): RecordingSnapshot;
  resolvePermission(): void;
  finish(): void;
  lateData(): void;
  error(): void;
};
declare global {
  interface Window {
    __composeRecording: RecordingHarness;
  }
}
export async function installRecording(
  page: Page,
  options: {
    permission?: 'allow' | 'deny' | 'pending';
    supported?: boolean;
  } = {},
) {
  const bytes = readFileSync(
    new URL('../../fixtures/media/tone.webm', import.meta.url),
  ).toString('base64');
  await page.addInitScript(
    ({ bytes, permission, supported }) => {
      let requests = 0;
      let starts = 0;
      let stops = 0;
      let tracksStopped = 0;
      const constraints: unknown[] = [];
      let pending: ((stream: MediaStream) => void) | null = null;
      const track = new EventTarget() as EventTarget & {
        kind: string;
        readyState: string;
        stop(): void;
      };
      track.kind = 'audio';
      track.readyState = 'live';
      track.stop = () => {
        tracksStopped++;
        track.readyState = 'ended';
      };
      const stream = {
        getTracks: () => [track],
        getAudioTracks: () => [track],
      } as unknown as MediaStream;
      const instances: RecordingStub[] = [];
      let capturedData: ((event: BlobEvent) => void) | null = null;
      const data = () =>
        new Blob(
          [
            Uint8Array.from(atob(bytes), (character) =>
              character.charCodeAt(0),
            ),
          ],
          { type: 'audio/webm' },
        );
      class RecordingStub {
        state = 'inactive';
        mimeType = 'audio/webm;codecs=opus';
        onstart: ((event: Event) => void) | null = null;
        ondataavailable: ((event: BlobEvent) => void) | null = null;
        onstop: ((event: Event) => void) | null = null;
        onerror: ((event: Event) => void) | null = null;
        static isTypeSupported(mime: string) {
          return supported && mime === 'audio/webm;codecs=opus';
        }
        constructor() {
          instances.push(this);
        }
        start() {
          starts++;
          this.state = 'recording';
          capturedData = this.ondataavailable;
          queueMicrotask(() => this.onstart?.(new Event('start')));
        }
        stop() {
          stops++;
          this.state = 'inactive';
          queueMicrotask(() => {
            this.ondataavailable?.(
              new BlobEvent('dataavailable', { data: data() }),
            );
            this.onstop?.(new Event('stop'));
          });
        }
      }
      Object.defineProperty(window, 'MediaRecorder', {
        configurable: true,
        value: supported ? RecordingStub : undefined,
      });
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: async (input: unknown) => {
            requests++;
            constraints.push(input);
            if (permission === 'deny')
              throw new DOMException(
                'Synthetic permission denial',
                'NotAllowedError',
              );
            if (permission === 'pending')
              return new Promise<MediaStream>((resolve) => {
                pending = resolve;
              });
            return stream;
          },
        },
      });
      Object.defineProperty(window, '__composeRecording', {
        configurable: true,
        value: {
          snapshot: () => ({
            requests,
            starts,
            stops,
            tracksStopped,
            constraints,
          }),
          resolvePermission: () => pending?.(stream),
          finish: () => instances.at(-1)?.stop(),
          lateData: () =>
            capturedData?.(new BlobEvent('dataavailable', { data: data() })),
          error: () => instances.at(-1)?.onerror?.(new Event('error')),
        } satisfies RecordingHarness,
      });
    },
    {
      bytes,
      permission: options.permission ?? 'allow',
      supported: options.supported ?? true,
    },
  );
}
export function recordingSnapshot(page: Page) {
  return page.evaluate(() => window.__composeRecording.snapshot());
}
