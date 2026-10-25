// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  beginCommunityImage,
  completeCommunityImage,
  readCommunityImage,
  revokeCommunityImage,
  type CommunityMediaDependencies,
} from '@/server/services/community-posts/media';
import {
  communityUploadSnapshotSchema,
  communityReadSnapshotSchema,
} from '@/server/services/community-posts/media-model';

const actor = 'd0340000-0000-4000-8000-000000000001';
const artist = 'd0340000-0000-4000-8000-000000000002';
const post = 'd0340000-0000-4000-8000-000000000003';
const upload = 'd0340000-0000-4000-8000-000000000004';
const image = 'd0340000-0000-4000-8000-000000000005';
const other = 'd0340000-0000-4000-8000-000000000006';
const now = Date.parse('2026-10-25T10:00:00Z');
const expires = new Date(now + 7200000).toISOString();
const readExpires = new Date(now + 60000).toISOString();
const bytes = new Uint8Array([1, 2, 3]);
const snapshot = {
  upload_id: upload,
  image_id: image,
  actor_id: actor,
  artist_id: artist,
  post_id: post,
  mime_type: 'image/png' as const,
  byte_size: 3,
  quarantine_path: `${artist}/${post}/${upload}.png`,
  object_path: `${artist}/${post}/${image}.png`,
  expires_at: expires,
  state: 'pending' as const,
  max_bytes: 1000,
  max_count: 3,
  max_long_edge: 100,
};
const read = {
  image_id: image,
  post_id: post,
  mime_type: 'image/png' as const,
  byte_size: 3,
  width: 2,
  height: 2,
  object_path: snapshot.object_path,
  bucket_id: 'board-media' as const,
  access_expires_at: readExpires,
};
const input = {
  requestId: other,
  artistId: artist,
  postId: post,
  mimeType: 'image/png' as const,
  byteSize: 3,
};
const ok = <T>(data: T) => ({ ok: true as const, data });
const unavailable = { ok: false, code: 'UNAVAILABLE' } as const;
function fixture() {
  const db = {
    begin: vi.fn().mockResolvedValue(ok(snapshot)),
    resolve: vi.fn().mockResolvedValue(ok(snapshot)),
    finalize: vi.fn().mockResolvedValue(ok(image)),
    revoke: vi.fn().mockResolvedValue(ok(null)),
    read: vi.fn().mockResolvedValue(ok(read)),
  };
  const storage = {
    signUpload: vi
      .fn()
      .mockResolvedValue(ok({ signedUrl: 'https://example.invalid/upload' })),
    downloadQuarantine: vi.fn().mockResolvedValue(ok(bytes)),
    publish: vi.fn().mockResolvedValue(ok({ objectId: other })),
    removeQuarantine: vi.fn().mockResolvedValue(ok(null)),
    signRead: vi.fn().mockResolvedValue(
      ok({
        signedUrl: 'https://example.invalid/read',
        expiresAt: readExpires,
      }),
    ),
  };
  const verify = vi.fn().mockResolvedValue(
    ok({
      bytes,
      byteSize: 3,
      mimeType: 'image/png',
      width: 2,
      height: 2,
      durationMs: null,
    }),
  );
  const deps = {
    db,
    storage,
    verify,
    now: () => now,
  } satisfies CommunityMediaDependencies;
  return deps;
}
describe('community image orchestration', () => {
  it.each([
    beginCommunityImage,
    completeCommunityImage,
    revokeCommunityImage,
    readCommunityImage,
  ])('rejects invalid actor and input before I/O', async (operation) => {
    const deps = fixture();
    expect(await operation(deps, 'bad', {})).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
    expect(await operation(deps, actor, {})).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(deps.db.begin).not.toHaveBeenCalled();
    expect(deps.db.resolve).not.toHaveBeenCalled();
    expect(deps.db.read).not.toHaveBeenCalled();
  });
  it('starts private upload only after initial and post-sign current authorization', async () => {
    const deps = fixture();
    expect(await beginCommunityImage(deps, actor, input)).toEqual(
      ok({
        uploadId: upload,
        uploadUrl: 'https://example.invalid/upload',
        expiresAt: expires,
      }),
    );
    expect(deps.db.begin).toHaveBeenCalledWith(actor, input);
    expect(deps.db.resolve).toHaveBeenCalledWith(actor, upload);
    expect(deps.storage.signUpload).toHaveBeenCalledWith(
      snapshot.quarantine_path,
    );
  });
  it.each([
    'actor_id',
    'artist_id',
    'post_id',
    'mime_type',
    'byte_size',
  ] as const)('rejects mismatched initial %s', async (key) => {
    const deps = fixture();
    deps.db.begin.mockResolvedValue(
      ok({ ...snapshot, [key]: key === 'byte_size' ? 4 : other }),
    );
    expect(await beginCommunityImage(deps, actor, input)).toEqual(unavailable);
    expect(deps.storage.signUpload).not.toHaveBeenCalled();
  });
  it.each([
    'upload_id',
    'image_id',
    'actor_id',
    'artist_id',
    'post_id',
    'mime_type',
    'byte_size',
    'quarantine_path',
    'object_path',
    'expires_at',
  ] as const)(
    'does not reveal capability after intent %s changed',
    async (key) => {
      const deps = fixture();
      deps.db.resolve.mockResolvedValue(
        ok({ ...snapshot, [key]: key === 'byte_size' ? 4 : other }),
      );
      expect(await beginCommunityImage(deps, actor, input)).toEqual(
        unavailable,
      );
    },
  );
  it.each([
    { state: 'completed' },
    { expires_at: new Date(now).toISOString() },
  ])('rejects expired/completed upload grant %j', async (change) => {
    const deps = fixture();
    deps.db.begin.mockResolvedValue(ok({ ...snapshot, ...change }));
    expect(await beginCommunityImage(deps, actor, input)).toEqual({
      ok: false,
      code: 'EXPIRED',
    });
  });
  it('honors a lowered image policy before grant disclosure', async () => {
    const deps = fixture();
    deps.db.resolve.mockResolvedValue(ok({ ...snapshot, max_bytes: 2 }));
    expect(await beginCommunityImage(deps, actor, input)).toEqual({
      ok: false,
      code: 'LIMIT_EXCEEDED',
    });
  });
  it('verifies bounded original bytes then publishes sanitized image and finalizes', async () => {
    const deps = fixture();
    expect(
      await completeCommunityImage(deps, actor, { uploadId: upload }),
    ).toEqual(ok({ imageId: image }));
    expect(deps.storage.downloadQuarantine).toHaveBeenCalledWith(
      snapshot.quarantine_path,
      3,
    );
    expect(deps.verify).toHaveBeenCalledWith(bytes, {
      kind: 'photo',
      mimeType: 'image/png',
      maxBytes: 1000,
      maxDurationMs: null,
    });
    expect(deps.db.finalize).toHaveBeenCalledWith(actor, upload, other, {
      width: 2,
      height: 2,
    });
    expect(deps.storage.removeQuarantine).toHaveBeenCalledWith(
      snapshot.quarantine_path,
    );
  });
  it('recovers already-completed upload without reupload, byte inspection or publication', async () => {
    const deps = fixture();
    deps.db.resolve.mockResolvedValue(ok({ ...snapshot, state: 'completed' }));
    expect(
      await completeCommunityImage(deps, actor, { uploadId: upload }),
    ).toEqual(ok({ imageId: image }));
    expect(deps.storage.publish).not.toHaveBeenCalled();
    expect(deps.verify).not.toHaveBeenCalled();
  });
  it('recovers a completion performed concurrently before publish', async () => {
    const deps = fixture();
    deps.db.resolve
      .mockResolvedValueOnce(ok(snapshot))
      .mockResolvedValueOnce(ok({ ...snapshot, state: 'completed' }));
    expect(
      await completeCommunityImage(deps, actor, { uploadId: upload }),
    ).toEqual(ok({ imageId: image }));
    expect(deps.storage.publish).not.toHaveBeenCalled();
  });
  it.each([
    { width: null },
    { height: 0 },
    { width: 101 },
    { mimeType: 'image/jpeg' },
    { durationMs: 3 },
    { byteSize: 4 },
  ])('rejects invalid sanitized photo metadata %j', async (change) => {
    const deps = fixture();
    deps.verify.mockResolvedValue(
      ok({
        bytes,
        byteSize: 3,
        mimeType: 'image/png',
        width: 2,
        height: 2,
        durationMs: null,
        ...change,
      }),
    );
    expect(
      await completeCommunityImage(deps, actor, { uploadId: upload }),
    ).toEqual({ ok: false, code: 'INVALID_CONTENT' });
    expect(deps.db.revoke).toHaveBeenCalledWith(actor, upload);
    expect(deps.storage.publish).not.toHaveBeenCalled();
  });
  it('does not accept a changed object registration ID after finalization', async () => {
    const deps = fixture();
    deps.db.finalize.mockResolvedValue(ok(other));
    expect(
      await completeCommunityImage(deps, actor, { uploadId: upload }),
    ).toEqual(unavailable);
  });
  it('keeps transient verification failures recoverable without revocation', async () => {
    const deps = fixture();
    deps.verify.mockResolvedValue(unavailable);
    expect(
      await completeCommunityImage(deps, actor, { uploadId: upload }),
    ).toEqual(unavailable);
    expect(deps.db.revoke).not.toHaveBeenCalled();
  });
  it('rechecks reduced policy limits before publication', async () => {
    const deps = fixture();
    deps.db.resolve
      .mockResolvedValueOnce(ok(snapshot))
      .mockResolvedValueOnce(ok({ ...snapshot, max_long_edge: 1 }));
    expect(
      await completeCommunityImage(deps, actor, { uploadId: upload }),
    ).toEqual({ ok: false, code: 'LIMIT_EXCEEDED' });
    expect(deps.storage.publish).not.toHaveBeenCalled();
  });
  it('rejects declared byte mismatch and never publishes', async () => {
    const deps = fixture();
    deps.storage.downloadQuarantine.mockResolvedValue(ok(new Uint8Array([1])));
    expect(
      await completeCommunityImage(deps, actor, { uploadId: upload }),
    ).toEqual({ ok: false, code: 'INVALID_CONTENT' });
    expect(deps.db.revoke).toHaveBeenCalled();
    expect(deps.storage.publish).not.toHaveBeenCalled();
  });
  it('keeps revoke independent of expired or missing cleanup lookup', async () => {
    const deps = fixture();
    deps.db.resolve.mockResolvedValue({ ok: false, code: 'EXPIRED' });
    expect(
      await revokeCommunityImage(deps, actor, { uploadId: upload }),
    ).toEqual(ok(null));
    expect(deps.db.revoke).toHaveBeenCalledWith(actor, upload);
    expect(deps.storage.removeQuarantine).not.toHaveBeenCalled();
  });
  it('does not claim revocation when database refuses attached media', async () => {
    const deps = fixture();
    deps.db.revoke.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    expect(
      await revokeCommunityImage(deps, actor, { uploadId: upload }),
    ).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(deps.storage.removeQuarantine).not.toHaveBeenCalled();
  });
  it('signs only active-post images with a current capped expiry', async () => {
    const deps = fixture();
    expect(
      await readCommunityImage(deps, actor, { imageId: image, postId: post }),
    ).toEqual(
      ok({
        url: 'https://example.invalid/read',
        expiresAt: readExpires,
        mimeType: 'image/png',
      }),
    );
    expect(deps.storage.signRead).toHaveBeenCalledWith(
      snapshot.object_path,
      60,
    );
    expect(deps.db.read).toHaveBeenCalledTimes(2);
  });
  it.each(['post_id', 'image_id'] as const)(
    'rejects initial read %s binding',
    async (key) => {
      const deps = fixture();
      deps.db.read.mockResolvedValue(ok({ ...read, [key]: other }));
      expect(
        await readCommunityImage(deps, actor, { imageId: image, postId: post }),
      ).toEqual(unavailable);
      expect(deps.storage.signRead).not.toHaveBeenCalled();
    },
  );
  it('never discloses a read grant after deletion/restriction', async () => {
    const deps = fixture();
    deps.db.read
      .mockResolvedValueOnce(ok(read))
      .mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' });
    expect(
      await readCommunityImage(deps, actor, { imageId: image, postId: post }),
    ).toEqual({ ok: false, code: 'NOT_FOUND' });
  });
  it.each([now, now + 61000, NaN])(
    'rejects provider expiry %s',
    async (stamp) => {
      const deps = fixture();
      deps.storage.signRead.mockResolvedValue(
        ok({
          signedUrl: 'https://example.invalid/read',
          expiresAt: Number.isFinite(stamp)
            ? new Date(stamp).toISOString()
            : 'bad',
        }),
      );
      expect(
        await readCommunityImage(deps, actor, { imageId: image, postId: post }),
      ).toEqual({ ok: false, code: 'EXPIRED' });
    },
  );
  it.each(['image_id', 'post_id', 'object_path', 'mime_type'] as const)(
    'rejects changed current read %s',
    async (key) => {
      const deps = fixture();
      deps.db.read
        .mockResolvedValueOnce(ok(read))
        .mockResolvedValueOnce(ok({ ...read, [key]: other }));
      expect(
        await readCommunityImage(deps, actor, { imageId: image, postId: post }),
      ).toEqual(unavailable);
    },
  );
  it('validates canonical board snapshot paths without exposing storage fields publicly', () => {
    expect(communityUploadSnapshotSchema.safeParse(snapshot).success).toBe(
      true,
    );
    expect(communityReadSnapshotSchema.safeParse(read).success).toBe(true);
    expect(
      communityUploadSnapshotSchema.safeParse({
        ...snapshot,
        object_path: snapshot.quarantine_path,
      }).success,
    ).toBe(false);
    expect(
      communityReadSnapshotSchema.safeParse({
        ...read,
        bucket_id: 'message-media',
      }).success,
    ).toBe(false);
  });
});
