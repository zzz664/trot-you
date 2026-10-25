// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createSupabaseStorageAdapter } from '@/server/adapters/storage/supabase';
const origin = 'https://fixture.supabase.co';
const path =
  'd0340000-0000-4000-8000-000000000001/d0340000-0000-4000-8000-000000000002/d0340000-0000-4000-8000-000000000003.png';
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
function adapter(value: unknown) {
  const transport = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => json(value));
  return {
    transport,
    port: createSupabaseStorageAdapter({
      url: origin,
      serviceRoleKey: 'synthetic-key',
      transport,
      area: 'board',
    }),
  };
}
function signed(bucket: string) {
  const token = `e30.${Buffer.from(JSON.stringify({ url: `${bucket}/${path}`, exp: Math.floor(Date.now() / 1000) + 50 })).toString('base64url')}.signature`;
  return `/object/sign/${bucket}/${path}?token=${token}`;
}
describe('explicit board storage area SDK configuration', () => {
  it('signs only private board quarantine capability', async () => {
    const f = adapter({
      url: `/object/upload/sign/board-quarantine/${path}?token=synthetic`,
    });
    expect(await f.port.signUpload(path)).toEqual({
      ok: true,
      data: {
        signedUrl: `${origin}/storage/v1/object/upload/sign/board-quarantine/${path}?token=synthetic`,
      },
    });
    expect(String(f.transport.mock.calls[0]![0])).toContain(
      '/board-quarantine/',
    );
  });
  it('validates board read token bucket and expiry', async () => {
    const url = signed('board-media');
    const f = adapter({ signedURL: url });
    expect(await f.port.signRead(path, 60)).toMatchObject({
      ok: true,
      data: { signedUrl: `${origin}/storage/v1${url}` },
    });
  });
  it('does not accept message bucket token for board read', async () => {
    expect(
      await adapter({ signedURL: signed('message-media') }).port.signRead(
        path,
        60,
      ),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
  it.each(['mp4', 'mp3', 'svg'])(
    'rejects non-image extension %s before I/O',
    async (extension) => {
      const f = adapter({});
      expect(
        await f.port.signUpload(path.replace('.png', `.${extension}`)),
      ).toEqual({ ok: false, code: 'INVALID_MEDIA' });
      expect(f.transport).not.toHaveBeenCalled();
    },
  );
  it('enforces board upload byte ceiling without altering message ceiling', async () => {
    const f = adapter({});
    expect(await f.port.downloadQuarantine(path, 10485761)).toEqual({
      ok: false,
      code: 'INVALID_MEDIA',
    });
    expect(f.transport).not.toHaveBeenCalled();
  });
  it('publishes sanitized bytes to board-media with no upsert', async () => {
    const f = adapter({
      Id: 'd0340000-0000-4000-8000-000000000004',
      Key: `board-media/${path}`,
    });
    expect(
      await f.port.publish(path, new Uint8Array([1, 2, 3]), 'image/png'),
    ).toEqual({
      ok: true,
      data: { objectId: 'd0340000-0000-4000-8000-000000000004' },
    });
    expect(String(f.transport.mock.calls[0]![0])).toContain('/board-media/');
    expect(
      new Headers(f.transport.mock.calls[0]![1]?.headers).get('x-upsert'),
    ).toBe('false');
  });
});
