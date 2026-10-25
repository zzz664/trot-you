// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  beginMediaUpload,
  completeMediaUpload,
  readMediaUrl,
  revokeMediaUpload,
  type MediaDependencies,
} from '@/server/services/media/access';
import type {
  MediaUploadSnapshot,
  MediaReadSnapshot,
} from '@/server/services/media/model';
const actor = 'a1000000-0000-4000-8000-000000000001';
const artist = 'a1000000-0000-4000-8000-000000000002';
const message = 'a1000000-0000-4000-8000-000000000003';
const media = 'a1000000-0000-4000-8000-000000000004';
const upload = 'a1000000-0000-4000-8000-000000000005';
const request = 'a1000000-0000-4000-8000-000000000006';
const object = 'a1000000-0000-4000-8000-000000000007';
const time = Date.parse('2026-10-24T00:00:00Z');
const bytes = new Uint8Array([1, 2, 3]);
const snapshot: MediaUploadSnapshot = {
  upload_id: upload,
  media_id: media,
  artist_id: artist,
  message_id: message,
  state: 'pending',
  kind: 'photo',
  mime_type: 'image/png',
  byte_size: bytes.length,
  quarantine_path: `${artist}/${message}/${upload}.png`,
  object_path: `${artist}/${message}/${media}.png`,
  expires_at: new Date(time + 600_000).toISOString(),
  max_bytes: 1000,
  max_count: 10,
  max_duration_ms: null,
};
const readSnapshot: MediaReadSnapshot = {
  media_id: media,
  message_id: message,
  kind: 'photo',
  mime_type: 'image/png',
  byte_size: 3,
  width: 1,
  height: 1,
  duration_ms: null,
  object_path: snapshot.object_path,
  bucket_id: 'message-media',
  access_expires_at: new Date(time + 60_000).toISOString(),
};
const beginInput = {
  requestId: request,
  messageId: message,
  mimeType: 'image/png',
  byteSize: bytes.length,
};
function deps() {
  return {
    db: {
      begin: vi.fn().mockResolvedValue({ ok: true, data: snapshot }),
      resolve: vi.fn().mockResolvedValue({ ok: true, data: snapshot }),
      finalize: vi.fn().mockResolvedValue({ ok: true, data: media }),
      revoke: vi.fn().mockResolvedValue({ ok: true, data: null }),
      read: vi.fn().mockResolvedValue({ ok: true, data: readSnapshot }),
    },
    storage: {
      signUpload: vi.fn().mockResolvedValue({
        ok: true,
        data: { signedUrl: 'https://storage.example/upload?token=fixture' },
      }),
      downloadQuarantine: vi.fn().mockResolvedValue({ ok: true, data: bytes }),
      publish: vi
        .fn()
        .mockResolvedValue({ ok: true, data: { objectId: object } }),
      removeQuarantine: vi.fn().mockResolvedValue({ ok: true, data: null }),
      signRead: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          signedUrl: 'https://storage.example/read?token=fixture',
          expiresAt: new Date(time + 60_000).toISOString(),
        },
      }),
    },
    verify: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        bytes,
        mimeType: 'image/png',
        byteSize: 3,
        width: 1,
        height: 1,
        durationMs: null,
      },
    }),
    now: vi.fn().mockReturnValue(time),
  } satisfies MediaDependencies;
}
const operations = [
  { run: beginMediaUpload, input: beginInput },
  { run: completeMediaUpload, input: { uploadId: upload } },
  { run: revokeMediaUpload, input: { uploadId: upload } },
  { run: readMediaUrl, input: { mediaId: media, preview: true } },
];
describe('resource-only media service validation and redaction', () => {
  for (const operation of operations) {
    it(`${operation.run.name} rejects unverified actor before I/O`, async () => {
      const d = deps();
      expect(await operation.run(d, 'cookie-subject', operation.input)).toEqual(
        { ok: false, code: 'FORBIDDEN' },
      );
      for (const method of Object.values(d.db))
        expect(method).not.toHaveBeenCalled();
    });
    it.each([
      null,
      {},
      'private/path',
      { ...operation.input, path: '../private' },
      { ...operation.input, actorId: actor },
    ])(
      `${operation.run.name} rejects unknown/arbitrary-path input %j`,
      async (input) => {
        const d = deps();
        expect(await operation.run(d, actor, input)).toEqual({
          ok: false,
          code: 'INVALID_INPUT',
        });
        for (const method of Object.values(d.db))
          expect(method).not.toHaveBeenCalled();
      },
    );
    it(`${operation.run.name} hides thrown credentials and private paths`, async () => {
      const d = deps();
      for (const method of Object.values(d.db))
        method.mockRejectedValue(new Error('service-role-secret/path'));
      expect(await operation.run(d, actor, operation.input)).toEqual({
        ok: false,
        code: 'UNAVAILABLE',
      });
    });
  }
  it.each([-1, 0, 1.5, 104857601, Number.MAX_SAFE_INTEGER, NaN, Infinity])(
    'rejects invalid declared bytes %s',
    async (byteSize) => {
      const d = deps();
      expect(
        await beginMediaUpload(d, actor, { ...beginInput, byteSize }),
      ).toEqual({ ok: false, code: 'INVALID_INPUT' });
      expect(d.db.begin).not.toHaveBeenCalled();
    },
  );
  it.each([
    'image/svg+xml',
    'text/html',
    'application/octet-stream',
    'image/PNG',
    'IMAGE/JPEG',
    'image/png; charset=utf-8',
  ])('rejects unsupported declaration %s', async (mimeType) => {
    const d = deps();
    expect(
      await beginMediaUpload(d, actor, { ...beginInput, mimeType }),
    ).toEqual({ ok: false, code: 'INVALID_INPUT' });
  });
});
describe('private quarantined upload initiation', () => {
  it('uses only the generated quarantine path and rechecks authority before returning a safe grant', async () => {
    const d = deps();
    expect(await beginMediaUpload(d, actor, beginInput)).toEqual({
      ok: true,
      data: {
        uploadId: upload,
        uploadUrl: 'https://storage.example/upload?token=fixture',
        expiresAt: snapshot.expires_at,
      },
    });
    expect(d.db.begin).toHaveBeenCalledExactlyOnceWith(actor, beginInput);
    expect(d.storage.signUpload).toHaveBeenCalledExactlyOnceWith(
      snapshot.quarantine_path,
    );
    expect(d.db.resolve).toHaveBeenCalledExactlyOnceWith(actor, upload);
  });
  it.each(['FORBIDDEN', 'LIMIT_EXCEEDED', 'SETUP_NOT_READY'] as const)(
    'passes denied initiation %s without signing',
    async (code) => {
      const d = deps();
      d.db.begin.mockResolvedValue({ ok: false, code });
      expect(await beginMediaUpload(d, actor, beginInput)).toEqual({
        ok: false,
        code,
      });
      expect(d.storage.signUpload).not.toHaveBeenCalled();
    },
  );
  it.each([
    { state: 'revoked' },
    { state: 'completed' },
    { expires_at: new Date(time).toISOString() },
  ])('never signs stale %j', async (change) => {
    const d = deps();
    d.db.begin.mockResolvedValue({
      ok: true,
      data: { ...snapshot, ...change },
    });
    expect(await beginMediaUpload(d, actor, beginInput)).toEqual({
      ok: false,
      code: 'EXPIRED',
    });
    expect(d.storage.signUpload).not.toHaveBeenCalled();
  });
  it('does not expose signed token after revoked authority during provider call', async () => {
    const d = deps();
    d.db.resolve.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    expect(await beginMediaUpload(d, actor, beginInput)).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
  });
  it('does not expose capability after intent deadline during provider call', async () => {
    const d = deps();
    d.now.mockReturnValueOnce(time).mockReturnValue(time + 600_000);
    expect(await beginMediaUpload(d, actor, beginInput)).toEqual({
      ok: false,
      code: 'EXPIRED',
    });
  });
  it('retains retryable intent on storage unavailability without fake success', async () => {
    const d = deps();
    d.storage.signUpload.mockResolvedValue({ ok: false, code: 'UNAVAILABLE' });
    expect(await beginMediaUpload(d, actor, beginInput)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(d.db.revoke).not.toHaveBeenCalled();
  });
});
describe('actual-byte verification and immutable completion', () => {
  it('downloads bounded original bytes, probes independently, promotes verified bytes and finalizes server metadata', async () => {
    const d = deps();
    const sanitized = new Uint8Array([9, 8]);
    d.verify.mockResolvedValue({
      ok: true,
      data: {
        bytes: sanitized,
        mimeType: 'image/png',
        byteSize: 2,
        width: 12,
        height: 15,
        durationMs: null,
      },
    });
    expect(await completeMediaUpload(d, actor, { uploadId: upload })).toEqual({
      ok: true,
      data: { mediaId: media },
    });
    expect(d.storage.downloadQuarantine).toHaveBeenCalledExactlyOnceWith(
      snapshot.quarantine_path,
      3,
    );
    expect(d.verify).toHaveBeenCalledExactlyOnceWith(bytes, {
      kind: 'photo',
      mimeType: 'image/png',
      maxBytes: 1000,
      maxDurationMs: null,
    });
    expect(d.storage.publish).toHaveBeenCalledExactlyOnceWith(
      snapshot.object_path,
      sanitized,
      'image/png',
    );
    expect(d.db.finalize).toHaveBeenCalledExactlyOnceWith(
      actor,
      upload,
      object,
      expect.objectContaining({ width: 12, height: 15, durationMs: null }),
    );
    expect(d.storage.removeQuarantine).toHaveBeenCalledExactlyOnceWith(
      snapshot.quarantine_path,
    );
  });
  it('returns completed replay without downloading, signing, promoting or verifying', async () => {
    const d = deps();
    d.db.resolve.mockResolvedValue({
      ok: true,
      data: {
        ...snapshot,
        state: 'completed',
        expires_at: new Date(time - 1).toISOString(),
      },
    });
    expect(await completeMediaUpload(d, actor, { uploadId: upload })).toEqual({
      ok: true,
      data: { mediaId: media },
    });
    for (const fn of Object.values(d.storage))
      expect(fn).not.toHaveBeenCalled();
    expect(d.verify).not.toHaveBeenCalled();
  });
  it.each([
    new Uint8Array([]),
    new Uint8Array([1]),
    new Uint8Array([1, 2, 3, 4]),
  ])('revokes mismatched declared length %j', async (data) => {
    const d = deps();
    d.storage.downloadQuarantine.mockResolvedValue({ ok: true, data });
    expect(await completeMediaUpload(d, actor, { uploadId: upload })).toEqual({
      ok: false,
      code: 'INVALID_CONTENT',
    });
    expect(d.db.revoke).toHaveBeenCalledExactlyOnceWith(actor, upload);
    expect(d.storage.publish).not.toHaveBeenCalled();
  });
  it.each(['download', 'verify'])(
    'never publishes bytes rejected by %s',
    async (stage) => {
      const d = deps();
      (stage === 'download'
        ? d.storage.downloadQuarantine
        : d.verify
      ).mockResolvedValue({ ok: false, code: 'INVALID_MEDIA' });
      expect(await completeMediaUpload(d, actor, { uploadId: upload })).toEqual(
        { ok: false, code: 'INVALID_CONTENT' },
      );
      expect(d.storage.publish).not.toHaveBeenCalled();
      expect(d.db.revoke).toHaveBeenCalledExactlyOnceWith(actor, upload);
    },
  );
  it('invalid content remains denied even if quarantine cleanup fails', async () => {
    const d = deps();
    d.verify.mockResolvedValue({ ok: false, code: 'INVALID_MEDIA' });
    d.db.revoke.mockRejectedValue(new Error('db'));
    d.storage.removeQuarantine.mockRejectedValue(new Error('storage'));
    expect(await completeMediaUpload(d, actor, { uploadId: upload })).toEqual({
      ok: false,
      code: 'INVALID_CONTENT',
    });
  });
  it.each(['download', 'verify', 'publish'])(
    'preserves retryable work when %s is temporarily unavailable',
    async (stage) => {
      const d = deps();
      (stage === 'download'
        ? d.storage.downloadQuarantine
        : stage === 'verify'
          ? d.verify
          : d.storage.publish
      ).mockResolvedValue({ ok: false, code: 'UNAVAILABLE' });
      expect(await completeMediaUpload(d, actor, { uploadId: upload })).toEqual(
        { ok: false, code: 'UNAVAILABLE' },
      );
      expect(d.db.revoke).not.toHaveBeenCalled();
      expect(d.db.finalize).not.toHaveBeenCalled();
    },
  );
  it('does not publish after authorization changes during verification', async () => {
    const d = deps();
    d.db.resolve
      .mockResolvedValueOnce({ ok: true, data: snapshot })
      .mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    expect(await completeMediaUpload(d, actor, { uploadId: upload })).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
    expect(d.storage.publish).not.toHaveBeenCalled();
  });
  it('does not register after authorization changes during immutable publish', async () => {
    const d = deps();
    d.db.finalize.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    expect(await completeMediaUpload(d, actor, { uploadId: upload })).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
    expect(d.storage.removeQuarantine).not.toHaveBeenCalled();
  });
  it('another completion winning while verification runs returns the same media id', async () => {
    const d = deps();
    d.db.resolve
      .mockResolvedValueOnce({ ok: true, data: snapshot })
      .mockResolvedValue({
        ok: true,
        data: { ...snapshot, state: 'completed' },
      });
    expect(await completeMediaUpload(d, actor, { uploadId: upload })).toEqual({
      ok: true,
      data: { mediaId: media },
    });
    expect(d.storage.publish).not.toHaveBeenCalled();
  });
  it('does not misreport committed registration if best-effort quarantine cleanup fails', async () => {
    const d = deps();
    d.storage.removeQuarantine.mockRejectedValue(new Error('private path'));
    expect(await completeMediaUpload(d, actor, { uploadId: upload })).toEqual({
      ok: true,
      data: { mediaId: media },
    });
  });
});
describe('fresh read authorization and short bearer lifetime', () => {
  it.each([true, false])(
    'passes explicit preview=%s and returns only signed browser grant',
    async (preview) => {
      const d = deps();
      const result = await readMediaUrl(d, actor, { mediaId: media, preview });
      expect(result).toEqual({
        ok: true,
        data: {
          url: 'https://storage.example/read?token=fixture',
          expiresAt: new Date(time + 60_000).toISOString(),
          kind: 'photo',
          mimeType: 'image/png',
        },
      });
      expect(d.db.read).toHaveBeenCalledTimes(2);
      expect(d.db.read).toHaveBeenNthCalledWith(1, actor, media, preview);
      expect(d.storage.signRead).toHaveBeenCalledExactlyOnceWith(
        snapshot.object_path,
        60,
      );
    },
  );
  it.each([1000, 1999, 12999, 60000, 180000])(
    'clamps token lifetime to entitlement %sms and rounds down',
    async (ms) => {
      const d = deps();
      d.db.read.mockResolvedValue({
        ok: true,
        data: {
          ...readSnapshot,
          access_expires_at: new Date(time + ms).toISOString(),
        },
      });
      d.storage.signRead.mockResolvedValue({
        ok: true,
        data: {
          signedUrl: 'https://storage.example/read?token=fixture',
          expiresAt: new Date(
            time + Math.min(60, Math.floor(ms / 1000)) * 1000,
          ).toISOString(),
        },
      });
      const result = await readMediaUrl(d, actor, {
        mediaId: media,
        preview: false,
      });
      expect(result.ok).toBe(true);
      expect(d.storage.signRead).toHaveBeenCalledExactlyOnceWith(
        snapshot.object_path,
        Math.min(60, Math.floor(ms / 1000)),
      );
    },
  );
  it.each([-1, 0, 999])(
    'never signs expired/almost expired entitlement %sms',
    async (ms) => {
      const d = deps();
      d.db.read.mockResolvedValue({
        ok: true,
        data: {
          ...readSnapshot,
          access_expires_at: new Date(time + ms).toISOString(),
        },
      });
      expect(
        await readMediaUrl(d, actor, { mediaId: media, preview: false }),
      ).toEqual({ ok: false, code: 'EXPIRED' });
      expect(d.storage.signRead).not.toHaveBeenCalled();
    },
  );
  it('hides URL when access revoked while signer runs', async () => {
    const d = deps();
    d.db.read
      .mockResolvedValueOnce({ ok: true, data: readSnapshot })
      .mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    expect(
      await readMediaUrl(d, actor, { mediaId: media, preview: true }),
    ).toEqual({ ok: false, code: 'FORBIDDEN' });
  });
  it('hides URL when response arrives beyond the conservative signed lifetime', async () => {
    const d = deps();
    d.now.mockReturnValueOnce(time).mockReturnValue(time + 60_000);
    expect(
      await readMediaUrl(d, actor, { mediaId: media, preview: true }),
    ).toEqual({ ok: false, code: 'EXPIRED' });
  });
  it('does not switch object while signing a stable media identifier', async () => {
    const d = deps();
    d.db.read
      .mockResolvedValueOnce({ ok: true, data: readSnapshot })
      .mockResolvedValue({
        ok: true,
        data: { ...readSnapshot, object_path: 'other' },
      });
    expect(
      await readMediaUrl(d, actor, { mediaId: media, preview: true }),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
  it('never caches/falls back to prior access after a denied read', async () => {
    const d = deps();
    d.db.read.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    expect(
      await readMediaUrl(d, actor, { mediaId: media, preview: false }),
    ).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(d.storage.signRead).not.toHaveBeenCalled();
  });
});
describe('revoking unfinished uploads', () => {
  it('revokes DB authority before best-effort quarantine deletion', async () => {
    const d = deps();
    expect(await revokeMediaUpload(d, actor, { uploadId: upload })).toEqual({
      ok: true,
      data: null,
    });
    expect(d.db.revoke).toHaveBeenCalledExactlyOnceWith(actor, upload);
    expect(d.storage.removeQuarantine).toHaveBeenCalledExactlyOnceWith(
      snapshot.quarantine_path,
    );
  });
  it('cannot delete another actors object or a completed registered resource', async () => {
    const d = deps();
    d.db.revoke.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    expect(await revokeMediaUpload(d, actor, { uploadId: upload })).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
    expect(d.storage.removeQuarantine).not.toHaveBeenCalled();
  });
});

describe('provider token expiry is authority, not just client display metadata', () => {
  it('withholds a URL whose provider signing latency crosses a paid entitlement deadline', async () => {
    const d = deps();
    d.db.read.mockResolvedValue({
      ok: true,
      data: {
        ...readSnapshot,
        access_expires_at: new Date(time + 5000).toISOString(),
      },
    });
    d.storage.signRead.mockResolvedValue({
      ok: true,
      data: {
        signedUrl: 'https://storage.example/read?token=must-not-leak',
        expiresAt: new Date(time + 8000).toISOString(),
      },
    });
    d.now.mockReturnValueOnce(time).mockReturnValue(time + 3000);
    expect(
      await readMediaUrl(d, actor, { mediaId: media, preview: false }),
    ).toEqual({ ok: false, code: 'EXPIRED' });
    expect(d.storage.signRead).toHaveBeenCalledExactlyOnceWith(
      snapshot.object_path,
      5,
    );
  });
  it('withholds rather than falsely shortens an already signed token after a paid period shrinks', async () => {
    const d = deps();
    d.db.read
      .mockResolvedValueOnce({ ok: true, data: readSnapshot })
      .mockResolvedValue({
        ok: true,
        data: {
          ...readSnapshot,
          access_expires_at: new Date(time + 30_000).toISOString(),
        },
      });
    expect(
      await readMediaUrl(d, actor, { mediaId: media, preview: false }),
    ).toEqual({ ok: false, code: 'EXPIRED' });
  });
  it('accepts the actual shorter provider expiry and never advertises a longer invented one', async () => {
    const d = deps();
    d.db.read.mockResolvedValue({
      ok: true,
      data: {
        ...readSnapshot,
        access_expires_at: new Date(time + 5000).toISOString(),
      },
    });
    d.storage.signRead.mockResolvedValue({
      ok: true,
      data: {
        signedUrl: 'https://storage.example/read?token=fixture',
        expiresAt: new Date(time + 4000).toISOString(),
      },
    });
    d.now.mockReturnValueOnce(time).mockReturnValue(time + 3000);
    expect(
      await readMediaUrl(d, actor, { mediaId: media, preview: false }),
    ).toMatchObject({
      ok: true,
      data: { expiresAt: new Date(time + 4000).toISOString() },
    });
  });
  it.each(['not-a-date', new Date(time).toISOString()])(
    'rejects malformed/already-expired provider expiry %s',
    async (expiresAt) => {
      const d = deps();
      d.storage.signRead.mockResolvedValue({
        ok: true,
        data: {
          signedUrl: 'https://storage.example/read?token=fixture',
          expiresAt,
        },
      });
      expect(
        await readMediaUrl(d, actor, { mediaId: media, preview: true }),
      ).toEqual({ ok: false, code: 'EXPIRED' });
    },
  );
  it.each(['FORBIDDEN', 'EXPIRED'] as const)(
    'replays an authorized revoke despite resolve cleanup hint %s',
    async (code) => {
      const d = deps();
      d.db.resolve.mockResolvedValue({ ok: false, code });
      expect(await revokeMediaUpload(d, actor, { uploadId: upload })).toEqual({
        ok: true,
        data: null,
      });
      expect(d.db.revoke).toHaveBeenCalledExactlyOnceWith(actor, upload);
      expect(d.storage.removeQuarantine).not.toHaveBeenCalled();
    },
  );
});

it('a shorter old bearer expiry permits a fresh grant until the separate entitlement deadline', async () => {
  const d = deps();
  const entitlementDeadline = time + 4800;
  d.db.read.mockResolvedValue({
    ok: true,
    data: {
      ...readSnapshot,
      access_expires_at: new Date(entitlementDeadline).toISOString(),
    },
  });
  d.now.mockReturnValue(time + 900);
  d.storage.signRead.mockResolvedValue({
    ok: true,
    data: {
      signedUrl: 'https://storage.example/read?token=first-fixture',
      expiresAt: new Date(time + 3000).toISOString(),
    },
  });
  const first = await readMediaUrl(d, actor, {
    mediaId: media,
    preview: false,
  });
  expect(first.ok).toBe(true);
  d.now.mockReturnValue(time + 3100);
  d.storage.signRead.mockResolvedValue({
    ok: true,
    data: {
      signedUrl: 'https://storage.example/read?token=second-fixture',
      expiresAt: new Date(time + 4000).toISOString(),
    },
  });
  expect(first.ok && Date.parse(first.data.expiresAt) < d.now()).toBe(true);
  const renewed = await readMediaUrl(d, actor, {
    mediaId: media,
    preview: false,
  });
  expect(renewed).toMatchObject({
    ok: true,
    data: { expiresAt: new Date(time + 4000).toISOString() },
  });
  expect(d.storage.signRead).toHaveBeenNthCalledWith(
    2,
    snapshot.object_path,
    1,
  );
  d.now.mockReturnValue(entitlementDeadline);
  expect(
    await readMediaUrl(d, actor, { mediaId: media, preview: false }),
  ).toEqual({ ok: false, code: 'EXPIRED' });
  expect(d.storage.signRead).toHaveBeenCalledTimes(2);
  expect(d.verify).not.toHaveBeenCalled();
});
