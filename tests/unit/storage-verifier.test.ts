// @vitest-environment node
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { verifyMedia } from '@/server/adapters/storage/verify';
import type { MediaMime, MediaKind } from '@/config/media';

const invalid = { ok: false, code: 'INVALID_MEDIA' };
const photo = {
  kind: 'photo',
  mimeType: 'image/png',
  maxBytes: 1_000_000,
  maxDurationMs: null,
} as const;
const blank = () =>
  sharp({
    create: { width: 32, height: 24, channels: 3, background: '#336699' },
  });
const fixture = (name: string) =>
  readFile(new URL(`../fixtures/media/${name}`, import.meta.url));

describe('actual image byte decoding and safe re-encoding', () => {
  it.each(['png', 'jpeg', 'webp'] as const)(
    'decodes %s to immutable image-only output without embedded metadata',
    async (format) => {
      const bytes = await blank()
        .withMetadata({
          exif: { IFD0: { Copyright: 'fictional-private-exif-marker' } },
        })
        .toFormat(format)
        .toBuffer();
      const result = await verifyMedia(bytes, {
        ...photo,
        mimeType: `image/${format}`,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toMatchObject({
        mimeType: `image/${format}`,
        width: 32,
        height: 24,
        durationMs: null,
      });
      expect(result.data.byteSize).toBe(result.data.bytes.byteLength);
      expect(
        Buffer.from(result.data.bytes).includes(
          Buffer.from('fictional-private-exif-marker'),
        ),
      ).toBe(false);
      const decoded = await sharp(result.data.bytes).raw().toBuffer();
      expect(decoded.byteLength).toBe(32 * 24 * 3);
      expect((await sharp(result.data.bytes).metadata()).exif).toBeUndefined();
    },
  );
  it('strips appended HTML/script polyglot bytes rather than publishing the original file', async () => {
    const good = await blank().png().toBuffer();
    const injected = Buffer.concat([
      good,
      Buffer.from('<script>secret-content</script>'),
    ]);
    const result = await verifyMedia(injected, photo);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(
        Buffer.from(result.data.bytes).includes(Buffer.from('secret-content')),
      ).toBe(false);
  });
  it.each([
    '<svg xmlns="http://www.w3.org/2000/svg"><script>unsafe()</script></svg>',
    '<html><script>unsafe()</script></html>',
    '<?xml version="1.0"?><svg/>',
    '#EXTM3U\nhttps://example.invalid/ssrf',
  ])(
    'rejects active/non-media bytes claiming image/png: %s',
    async (content) => {
      expect(await verifyMedia(Buffer.from(content), photo)).toEqual(invalid);
    },
  );
  it('rejects truncated image data despite a complete-looking PNG signature', async () => {
    const bytes = await blank().png().toBuffer();
    expect(await verifyMedia(bytes.subarray(0, 40), photo)).toEqual(invalid);
  });
  it('does not trust declared MIME, dimensions or file extension', async () => {
    const png = await blank().png().toBuffer();
    expect(
      await verifyMedia(png, { ...photo, mimeType: 'image/jpeg' }),
    ).toEqual(invalid);
    expect(
      await verifyMedia(png, { ...photo, kind: 'voice', maxDurationMs: 1000 }),
    ).toEqual(invalid);
  });
  it('rejects oversized dimensions and decompression bombs before full decode', async () => {
    const bytes = await sharp({
      create: { width: 10_001, height: 1, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer();
    expect(await verifyMedia(bytes, photo)).toEqual(invalid);
  });
});

const timeFixtures: [string, MediaKind, MediaMime][] = [
  ['tone.mp3', 'voice', 'audio/mpeg'],
  ['tone.m4a', 'voice', 'audio/mp4'],
  ['tone.webm', 'voice', 'audio/webm'],
  ['live-tone.webm', 'voice', 'audio/webm'],
  ['clip.mp4', 'video', 'video/mp4'],
  ['clip.webm', 'video', 'video/webm'],
];
describe('real local WASM media parser', () => {
  it.each(timeFixtures)(
    'measures %s actual bytes and track duration',
    async (name, kind, mimeType) => {
      const bytes = await fixture(name);
      const result = await verifyMedia(bytes, {
        kind,
        mimeType,
        maxBytes: 1_000_000,
        maxDurationMs: 1000,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.byteSize).toBe(bytes.length);
      expect(result.data.durationMs).toBeGreaterThanOrEqual(250);
      expect(result.data.durationMs).toBeLessThanOrEqual(350);
      expect(result.data.width).toBe(kind === 'video' ? 32 : null);
      expect(result.data.height).toBe(kind === 'video' ? 24 : null);
      expect(
        await verifyMedia(bytes, {
          kind,
          mimeType,
          maxBytes: 1_000_000,
          maxDurationMs: 100,
        }),
      ).toEqual(invalid);
    },
  );
  it.each(timeFixtures)(
    'rejects malformed %s despite plausible parsed metadata',
    async (name, kind, mimeType) => {
      const bytes = await fixture(name);
      for (const corrupt of [
        bytes.subarray(0, Math.floor(bytes.length / 2)),
        Buffer.concat([
          bytes,
          Buffer.from('<html><script>unsafe()</script></html>'),
        ]),
      ]) {
        expect(
          await verifyMedia(corrupt, {
            kind,
            mimeType,
            maxBytes: 1_000_000,
            maxDurationMs: 1000,
          }),
        ).toEqual(invalid);
      }
    },
  );
  it('accepts the real ninety-second synthetic MP3 within the approved three-minute fixture policy', async () => {
    const result = await verifyMedia(await fixture('long-tone.mp3'), {
      kind: 'voice',
      mimeType: 'audio/mpeg',
      maxBytes: 20_971_520,
      maxDurationMs: 180_000,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.durationMs).toBeGreaterThanOrEqual(90_000);
      expect(result.data.durationMs).toBeLessThan(91_000);
    }
  });
  it('rejects long actual MP3 audio despite stale short Xing/Info duration', async () => {
    const source = await fixture('tone.mp3');
    const bytes = Buffer.concat([
      source,
      ...Array.from({ length: 999 }, () => source.subarray(226)),
    ]);
    expect(
      await verifyMedia(bytes, {
        kind: 'voice',
        mimeType: 'audio/mpeg',
        maxBytes: 20_971_520,
        maxDurationMs: 180_000,
      }),
    ).toEqual(invalid);
  });
  it('rejects late WebM clusters despite stale short Info duration', async () => {
    const source = await fixture('clip.webm');
    const chunks = [source];
    for (let i = 1; i < 1000; i++) {
      const header = Buffer.from([
        0x1f, 0x43, 0xb6, 0x75, 0xdd, 0xe7, 0x84, 0, 0, 0, 0,
      ]);
      header.writeUInt32BE(i * 300, 7);
      chunks.push(header, source.subarray(480, 567));
    }
    const bytes = Buffer.concat(chunks);
    bytes.writeBigUInt64BE(BigInt(bytes.length - 48) | 0x0100000000000000n, 40);
    expect(
      await verifyMedia(bytes, {
        kind: 'video',
        mimeType: 'video/webm',
        maxBytes: 104_857_600,
        maxDurationMs: 60_000,
      }),
    ).toEqual(invalid);
  });
  it('rejects late non-monotonic MP4 presentation timestamps despite short metadata duration', async () => {
    const bytes = Buffer.from(await fixture('clip.mp4'));
    bytes.writeUInt32BE(3_072_000, bytes.indexOf('ctts') + 32);
    expect(
      await verifyMedia(bytes, {
        kind: 'video',
        mimeType: 'video/mp4',
        maxBytes: 104_857_600,
        maxDurationMs: 60_000,
      }),
    ).toEqual(invalid);
  });
  it('rejects audio/video MIME substitution even within the same container family', async () => {
    expect(
      await verifyMedia(await fixture('clip.mp4'), {
        kind: 'voice',
        mimeType: 'audio/mp4',
        maxBytes: 1_000_000,
        maxDurationMs: 1000,
      }),
    ).toEqual(invalid);
    expect(
      await verifyMedia(await fixture('tone.webm'), {
        kind: 'video',
        mimeType: 'video/webm',
        maxBytes: 1_000_000,
        maxDurationMs: 1000,
      }),
    ).toEqual(invalid);
  });
  it('rejects unsupported MP4 edit rates instead of silently measuring the wrong timeline', async () => {
    const bytes = Buffer.from(await fixture('clip.mp4'));
    const edit = bytes.indexOf('elst');
    expect(edit).toBeGreaterThan(0);
    bytes.writeUInt32BE(0x00008000, edit + 20);
    expect(
      await verifyMedia(bytes, {
        kind: 'video',
        mimeType: 'video/mp4',
        maxBytes: 104_857_600,
        maxDurationMs: 60_000,
      }),
    ).toEqual(invalid);
  });
  it('rejects external MP4 data references without fetching any URL', async () => {
    const bytes = Buffer.from(await fixture('clip.mp4'));
    const urlEntry = bytes.indexOf('url ');
    expect(urlEntry).toBeGreaterThan(0);
    bytes.writeUInt32BE(0, urlEntry + 4);
    expect(
      await verifyMedia(bytes, {
        kind: 'video',
        mimeType: 'video/mp4',
        maxBytes: 1_000_000,
        maxDurationMs: 1000,
      }),
    ).toEqual(invalid);
  });
  it('rejects truncated/invalid MP4 boxes and appended active content', async () => {
    const bytes = await fixture('clip.mp4');
    for (const corrupt of [
      bytes.subarray(0, bytes.length - 1),
      Buffer.concat([bytes, Buffer.from('<script>unsafe</script>')]),
      Buffer.from('0000ftyp0000moov'),
    ])
      expect(
        await verifyMedia(corrupt, {
          kind: 'video',
          mimeType: 'video/mp4',
          maxBytes: 1_000_000,
          maxDurationMs: 1000,
        }),
      ).toEqual(invalid);
  });
  it.each(timeFixtures)(
    'rejects %s wrong byte limits before parser allocation',
    async (name, kind, mimeType) => {
      const bytes = await fixture(name);
      expect(
        await verifyMedia(bytes, {
          kind,
          mimeType,
          maxBytes: bytes.length - 1,
          maxDurationMs: 1000,
        }),
      ).toEqual(invalid);
    },
  );
});
describe('parser guardrails', () => {
  it.each([0, -1, Infinity, NaN, 1.5, 104_857_601])(
    'rejects unsafe byte bound %s',
    async (maxBytes) => {
      expect(
        await verifyMedia(new Uint8Array([1]), { ...photo, maxBytes }),
      ).toEqual(invalid);
    },
  );
  it('rejects empty bytes, unavailable duration and forged mime values without raw errors', async () => {
    expect(await verifyMedia(new Uint8Array(), photo)).toEqual(invalid);
    expect(
      await verifyMedia(await fixture('tone.mp3'), {
        kind: 'voice',
        mimeType: 'audio/mpeg',
        maxBytes: 1_000_000,
        maxDurationMs: null,
      }),
    ).toEqual(invalid);
    expect(
      await verifyMedia(Buffer.from('secret raw content'), {
        ...photo,
        mimeType: 'text/html' as MediaMime,
      }),
    ).toEqual(invalid);
  });
});
