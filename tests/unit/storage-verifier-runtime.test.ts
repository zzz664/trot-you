// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyMedia } from '@/server/adapters/storage/verify';
const mocks = vi.hoisted(() => ({ factory: vi.fn() }));
vi.mock('mediainfo.js', () => ({ mediaInfoFactory: mocks.factory }));
const input = {
  kind: 'voice',
  mimeType: 'audio/mpeg',
  maxBytes: 1_000_000,
  maxDurationMs: 1000,
} as const;
const fixture = () =>
  readFile(new URL('../fixtures/media/tone.mp3', import.meta.url));
afterEach(() => vi.resetAllMocks());
describe('byte parser infrastructure recovery', () => {
  it('does not revoke valid uploads when deployed WASM cannot initialize', async () => {
    mocks.factory.mockRejectedValue(
      new Error('/private/path/secret-wasm-error'),
    );
    expect(await verifyMedia(await fixture(), input)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it('invalid content still fails permanently and closes the parser without exposing input', async () => {
    const close = vi.fn();
    mocks.factory.mockResolvedValue({
      analyzeData: vi.fn().mockRejectedValue(new Error('private-byte-content')),
      close,
    });
    expect(await verifyMedia(await fixture(), input)).toEqual({
      ok: false,
      code: 'INVALID_MEDIA',
    });
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('rejects deeply nested conformance diagnostics rather than trusting valid-looking top-level metadata', async () => {
    const close = vi.fn();
    mocks.factory.mockResolvedValue({
      analyzeData: vi.fn().mockResolvedValue({
        media: {
          track: [
            {
              '@type': 'General',
              extra: { nested: [{ ConformanceErrors: ['bad bytes'] }] },
            },
          ],
        },
      }),
      close,
    });
    expect(await verifyMedia(await fixture(), input)).toEqual({
      ok: false,
      code: 'INVALID_MEDIA',
    });
    expect(close).toHaveBeenCalledTimes(1);
  });
});
