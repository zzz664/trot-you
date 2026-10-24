import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { originSchema } from '@/config/env';
import { mediaMimeSchema, type MediaMime } from '@/config/media';
import {
  STORAGE_JWT_PARTS,
  STORAGE_JWT_PAYLOAD_INDEX,
  STORAGE_MILLISECONDS_PER_SECOND,
  STORAGE_MAX_BYTES,
  STORAGE_MAX_READ_TTL_SECONDS,
  STORAGE_MEDIA_BUCKET,
  STORAGE_MIME_EXTENSIONS,
  STORAGE_OBJECT_PATH_PATTERN,
  STORAGE_QUARANTINE_BUCKET,
  STORAGE_QUARANTINE_PATH_PATTERN,
  STORAGE_READ_URL_PREFIX,
  STORAGE_SIGNED_TOKEN_MAX_LENGTH,
  STORAGE_TIMEOUT_MS,
  STORAGE_UPLOAD_URL_PREFIX,
} from '@/config/storage';
import type { StoragePort, StorageResult } from './types';

const invalid = { ok: false, code: 'INVALID_MEDIA' } as const;
const unavailable = { ok: false, code: 'UNAVAILABLE' } as const;

function signedUrl(
  value: string,
  origin: string,
  prefix: string,
  path: string,
) {
  try {
    const url = new URL(value);
    const tokens = url.searchParams.getAll('token');
    return url.origin === origin &&
      url.pathname === `${prefix}${path}` &&
      !url.username &&
      !url.password &&
      !url.hash &&
      Array.from(url.searchParams.keys()).length === 1 &&
      tokens.length === 1 &&
      Boolean(tokens[0]) &&
      tokens[0]!.length <= STORAGE_SIGNED_TOKEN_MAX_LENGTH
      ? url.href
      : null;
  } catch {
    return null;
  }
}

// This is not JWT authorization or signature verification. Only the trusted
// provider response is decoded to cap the capability's actual expiry/path;
// Supabase verifies the signature when the browser uses the URL.
function readExpiry(url: string, path: string, requestedSeconds: number) {
  try {
    const token = new URL(url).searchParams.get('token')!;
    const parts = token.split('.');
    if (
      parts.length !== STORAGE_JWT_PARTS ||
      parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))
    )
      return null;
    const payload: unknown = JSON.parse(
      Buffer.from(parts[STORAGE_JWT_PAYLOAD_INDEX]!, 'base64url').toString(
        'utf8',
      ),
    );
    const parsed = z
      .object({
        exp: z.number().int().positive(),
        url: z.literal(`${STORAGE_MEDIA_BUCKET}/${path}`),
        scope: z.literal('download').optional(),
      })
      .safeParse(payload);
    if (!parsed.success) return null;
    const expiresMs = parsed.data.exp * STORAGE_MILLISECONDS_PER_SECOND;
    const now = Date.now();
    if (
      !Number.isSafeInteger(expiresMs) ||
      expiresMs <= now ||
      expiresMs > now + requestedSeconds * STORAGE_MILLISECONDS_PER_SECOND
    )
      return null;
    return new Date(expiresMs).toISOString();
  } catch {
    return null;
  }
}

// Consume the SDK's streaming download rather than .blob(): an attacker can
// lie about metadata/Content-Length, so actual bytes are bounded while reading.
async function boundedBytes(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  signal: AbortSignal,
) {
  const reader = stream.getReader();
  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', abort, { once: true });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    if (signal.aborted) throw new Error('STORAGE_TIMEOUT');
    while (true) {
      const { value, done } = await reader.read();
      if (signal.aborted) throw new Error('STORAGE_TIMEOUT');
      if (done) break;
      if (!(value instanceof Uint8Array))
        throw new Error('INVALID_STORAGE_BODY');
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        return invalid;
      }
      chunks.push(value);
    }
    if (!length) return invalid;
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { ok: true, data: bytes } as const;
  } finally {
    signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}

/** Service-only Storage capability. No caller-controlled bucket or URL is accepted. */
export function createSupabaseStorageAdapter(input: {
  url: string;
  serviceRoleKey: string;
  transport?: typeof fetch;
}): StoragePort {
  const parsedOrigin = originSchema.safeParse(input.url);
  if (!parsedOrigin.success || !input.serviceRoleKey)
    throw new Error('INVALID_STORAGE_CONFIGURATION');
  const origin = new URL(parsedOrigin.data).origin;
  const transport = input.transport ?? fetch;
  const client = createClient(origin, input.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (url, init) => {
        const target = new URL(
          typeof url === 'string'
            ? url
            : url instanceof URL
              ? url.href
              : url.url,
        );
        if (
          target.origin !== origin ||
          !target.pathname.startsWith('/storage/v1/') ||
          target.username ||
          target.password
        )
          throw new Error('INVALID_STORAGE_TARGET');
        const timeout = AbortSignal.timeout(STORAGE_TIMEOUT_MS);
        return transport(url, {
          ...init,
          redirect: 'error',
          cache: 'no-store',
          credentials: 'omit',
          signal: init?.signal
            ? AbortSignal.any([init.signal, timeout])
            : timeout,
        });
      },
    },
  });
  const quarantine = client.storage.from(STORAGE_QUARANTINE_BUCKET);
  const media = client.storage.from(STORAGE_MEDIA_BUCKET);
  async function download(
    bucket: typeof media,
    path: string,
    maxBytes: number,
  ): Promise<StorageResult<Uint8Array>> {
    if (
      !Number.isSafeInteger(maxBytes) ||
      maxBytes <= 0 ||
      maxBytes > STORAGE_MAX_BYTES
    )
      return invalid;
    try {
      const signal = AbortSignal.timeout(STORAGE_TIMEOUT_MS);
      const result = await bucket
        .download(path, {}, { signal, cache: 'no-store' })
        .asStream();
      if (result.error || !result.data) return unavailable;
      return await boundedBytes(
        result.data as ReadableStream<Uint8Array>,
        maxBytes,
        signal,
      );
    } catch {
      return unavailable;
    }
  }
  return {
    async signUpload(path) {
      if (!STORAGE_QUARANTINE_PATH_PATTERN.test(path)) return invalid;
      try {
        const result = await quarantine.createSignedUploadUrl(path, {
          upsert: false,
        });
        if (result.error || !result.data || result.data.path !== path)
          return unavailable;
        const url = signedUrl(
          result.data.signedUrl,
          origin,
          STORAGE_UPLOAD_URL_PREFIX,
          path,
        );
        return url ? { ok: true, data: { signedUrl: url } } : unavailable;
      } catch {
        return unavailable;
      }
    },
    async downloadQuarantine(path, maxBytes) {
      if (!STORAGE_QUARANTINE_PATH_PATTERN.test(path)) return invalid;
      return download(quarantine, path, maxBytes);
    },
    async publish(path, bytes, mimeType: MediaMime) {
      if (
        !STORAGE_OBJECT_PATH_PATTERN.test(path) ||
        !mediaMimeSchema.safeParse(mimeType).success ||
        !path.endsWith(`.${STORAGE_MIME_EXTENSIONS[mimeType]}`) ||
        !bytes.byteLength ||
        bytes.byteLength > STORAGE_MAX_BYTES
      )
        return invalid;
      try {
        const result = await media.upload(path, bytes, {
          upsert: false,
          contentType: mimeType,
          cacheControl: '0',
        });
        if (
          !result.error &&
          result.data &&
          result.data.path === path &&
          z.uuid().safeParse(result.data.id).success
        )
          return { ok: true, data: { objectId: result.data.id } };
        // A prior immutable upload can succeed before its response is lost. Never
        // overwrite it: retry is successful only after exact byte+MIME verification.
        const info = await media.info(path);
        if (
          info.error ||
          !info.data ||
          info.data.name !== path ||
          info.data.bucketId !== STORAGE_MEDIA_BUCKET ||
          info.data.contentType !== mimeType ||
          info.data.size !== bytes.byteLength ||
          !z.uuid().safeParse(info.data.id).success
        )
          return unavailable;
        const existing = await download(media, path, bytes.byteLength);
        if (!existing.ok || existing.data.byteLength !== bytes.byteLength)
          return unavailable;
        const expected = createHash('sha256').update(bytes).digest();
        const actual = createHash('sha256').update(existing.data).digest();
        return timingSafeEqual(expected, actual)
          ? { ok: true, data: { objectId: info.data.id } }
          : unavailable;
      } catch {
        return unavailable;
      }
    },
    async removeQuarantine(path) {
      if (!STORAGE_QUARANTINE_PATH_PATTERN.test(path)) return invalid;
      try {
        const result = await quarantine.remove([path]);
        return result.error ? unavailable : { ok: true, data: null };
      } catch {
        return unavailable;
      }
    },
    async signRead(path, expiresInSeconds) {
      if (
        !STORAGE_OBJECT_PATH_PATTERN.test(path) ||
        !Number.isSafeInteger(expiresInSeconds) ||
        expiresInSeconds <= 0 ||
        expiresInSeconds > STORAGE_MAX_READ_TTL_SECONDS
      )
        return invalid;
      try {
        const result = await media.createSignedUrl(path, expiresInSeconds);
        if (result.error || !result.data) return unavailable;
        const url = signedUrl(
          result.data.signedUrl,
          origin,
          STORAGE_READ_URL_PREFIX,
          path,
        );
        const expiresAt = url ? readExpiry(url, path, expiresInSeconds) : null;
        return url && expiresAt
          ? { ok: true, data: { signedUrl: url, expiresAt } }
          : unavailable;
      } catch {
        return unavailable;
      }
    },
  };
}
