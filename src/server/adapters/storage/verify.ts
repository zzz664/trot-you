import 'server-only';
import sharp from 'sharp';
import { mediaInfoFactory, type Track } from 'mediainfo.js';
import { mediaMimeSchema } from '@/config/media';
import {
  STORAGE_CODECS_BY_CONTAINER,
  STORAGE_BINARY,
  STORAGE_IMAGE_QUALITY,
  STORAGE_MAX_AUDIO_CHANNELS,
  STORAGE_MAX_AUDIO_TRACKS,
  STORAGE_MAX_BYTES,
  STORAGE_MAX_DIMENSION,
  STORAGE_MAX_DURATION_MS,
  STORAGE_MAX_FRAME_RATE,
  STORAGE_MAX_PIXELS,
  STORAGE_MAX_VIDEO_TRACKS,
  STORAGE_MEDIA_CHUNK_BYTES,
  STORAGE_MEDIA_MAX_CHUNKS,
  STORAGE_MEDIA_METADATA_MAX_DEPTH,
  STORAGE_MEDIA_METADATA_MAX_NODES,
  STORAGE_MILLISECONDS_PER_SECOND,
  STORAGE_MP4_TOP_LEVEL_BOXES,
  STORAGE_MP4_REFERENCE_CONTAINERS,
  STORAGE_MP4_EXTERNAL_REFERENCE_BOXES,
  STORAGE_MP4_EDITS,
  STORAGE_MP4_FULL_BOX_HEADER_BYTES,
  STORAGE_MP4_SELF_CONTAINED_ENTRY_BYTES,
  STORAGE_SIGNATURES,
} from '@/config/storage';
import { probePacketDuration } from './timing';
import type {
  MediaVerificationInput,
  MediaVerifier,
  StorageResult,
  VerifiedMedia,
} from './types';

const invalid = { ok: false, code: 'INVALID_MEDIA' } as const;
function starts(bytes: Uint8Array, signature: readonly number[]) {
  return (
    bytes.length >= signature.length &&
    signature.every((value, index) => bytes[index] === value)
  );
}
function ascii(bytes: Uint8Array, offset: number, length: number) {
  return Buffer.from(bytes.subarray(offset, offset + length)).toString('ascii');
}
function dimensions(width: unknown, height: unknown): width is number {
  return (
    typeof width === 'number' &&
    typeof height === 'number' &&
    Number.isSafeInteger(width) &&
    Number.isSafeInteger(height) &&
    width > 0 &&
    height > 0 &&
    width <= STORAGE_MAX_DIMENSION &&
    height <= STORAGE_MAX_DIMENSION &&
    width * height <= STORAGE_MAX_PIXELS
  );
}
function signatureMatches(bytes: Uint8Array, input: MediaVerificationInput) {
  switch (input.mimeType) {
    case 'image/jpeg':
      return input.kind === 'photo' && starts(bytes, STORAGE_SIGNATURES.jpeg);
    case 'image/png':
      return input.kind === 'photo' && starts(bytes, STORAGE_SIGNATURES.png);
    case 'image/webp':
      return (
        input.kind === 'photo' &&
        ascii(bytes, 0, STORAGE_BINARY.uint32Bytes) ===
          STORAGE_SIGNATURES.riff &&
        ascii(
          bytes,
          STORAGE_BINARY.webpTypeStart,
          STORAGE_BINARY.uint32Bytes,
        ) === STORAGE_SIGNATURES.webp
      );
    case 'audio/mpeg':
      return (
        input.kind === 'voice' &&
        (ascii(bytes, 0, STORAGE_SIGNATURES.id3.length) ===
          STORAGE_SIGNATURES.id3 ||
          (bytes.length >= STORAGE_BINARY.mp3HeaderBytes &&
            bytes[0] === STORAGE_BINARY.mp3SyncFirst &&
            (bytes[1]! & STORAGE_BINARY.mp3SyncMask) ===
              STORAGE_BINARY.mp3SyncMask))
      );
    case 'audio/mp4':
    case 'video/mp4':
      return (
        input.kind === (input.mimeType === 'audio/mp4' ? 'voice' : 'video') &&
        validMp4Boxes(bytes)
      );
    case 'audio/webm':
    case 'video/webm':
      return (
        input.kind === (input.mimeType === 'audio/webm' ? 'voice' : 'video') &&
        starts(bytes, STORAGE_SIGNATURES.ebml)
      );
  }
}
function validEditList(view: DataView, payload: number, length: number) {
  if (length < STORAGE_MP4_FULL_BOX_HEADER_BYTES) return false;
  const flags = view.getUint32(payload);
  if (flags !== 0 && flags !== STORAGE_MP4_EDITS.version1Flags) return false;
  const version1 = flags === STORAGE_MP4_EDITS.version1Flags;
  const entryBytes = version1
    ? STORAGE_MP4_EDITS.version1EntryBytes
    : STORAGE_MP4_EDITS.version0EntryBytes;
  const count = view.getUint32(payload + STORAGE_BINARY.uint32Bytes);
  if (
    !count ||
    count > STORAGE_MP4_EDITS.maximumEntries ||
    length !== STORAGE_MP4_FULL_BOX_HEADER_BYTES + count * entryBytes
  )
    return false;
  let content = false;
  for (let index = 0; index < count; index += 1) {
    const entry =
      payload + STORAGE_MP4_FULL_BOX_HEADER_BYTES + index * entryBytes;
    const timeBytes = version1
      ? STORAGE_BINARY.uint64Bytes
      : STORAGE_BINARY.uint32Bytes;
    const duration = version1
      ? Number(view.getBigUint64(entry))
      : view.getUint32(entry);
    const mediaTime = version1
      ? Number(view.getBigInt64(entry + timeBytes))
      : view.getInt32(entry + timeBytes);
    if (
      !Number.isSafeInteger(duration) ||
      !Number.isSafeInteger(mediaTime) ||
      duration <= 0 ||
      view.getUint32(entry + entryBytes - STORAGE_BINARY.uint32Bytes) !==
        STORAGE_MP4_EDITS.mediaRateOne ||
      content
    )
      return false;
    if (mediaTime >= 0) content = true;
    else if (mediaTime !== -1) return false;
  }
  return content;
}

function validLocalReferences(
  bytes: Uint8Array,
  start: number,
  end: number,
  depth = 0,
): boolean {
  if (depth > STORAGE_MEDIA_METADATA_MAX_DEPTH) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = start;
  while (offset < end) {
    if (end - offset < STORAGE_BINARY.mp4HeaderBytes) return false;
    const length = view.getUint32(offset);
    if (length < STORAGE_BINARY.mp4HeaderBytes || length > end - offset)
      return false;
    const type = ascii(
      bytes,
      offset + STORAGE_BINARY.mp4TypeStart,
      STORAGE_BINARY.uint32Bytes,
    );
    const payload = offset + STORAGE_BINARY.mp4HeaderBytes;
    if (STORAGE_MP4_EXTERNAL_REFERENCE_BOXES.some((name) => name === type))
      return false;
    if (
      STORAGE_MP4_REFERENCE_CONTAINERS.some((name) => name === type) &&
      !validLocalReferences(bytes, payload, offset + length, depth + 1)
    )
      return false;
    if (
      type === 'elst' &&
      !validEditList(view, payload, length - STORAGE_BINARY.mp4HeaderBytes)
    )
      return false;
    if (type === 'dref') {
      if (
        length !==
          STORAGE_BINARY.mp4HeaderBytes +
            STORAGE_MP4_FULL_BOX_HEADER_BYTES +
            STORAGE_MP4_SELF_CONTAINED_ENTRY_BYTES ||
        view.getUint32(payload) !== 0 ||
        view.getUint32(payload + STORAGE_BINARY.uint32Bytes) !== 1
      )
        return false;
      const entry = payload + STORAGE_MP4_FULL_BOX_HEADER_BYTES;
      // Only one self-contained data entry. URL/URN payloads, reference movies
      // and remote-track sources are rejected even though our parser never fetches.
      if (
        view.getUint32(entry) !== STORAGE_MP4_SELF_CONTAINED_ENTRY_BYTES ||
        ascii(
          bytes,
          entry + STORAGE_BINARY.mp4TypeStart,
          STORAGE_BINARY.uint32Bytes,
        ) !== 'url ' ||
        view.getUint32(entry + STORAGE_BINARY.mp4HeaderBytes) !== 1
      )
        return false;
    }
    offset += length;
  }
  return offset === end;
}

// Reject truncated/overlapping containers and arbitrary appended active content.
// No external URL, path, playlist or streaming input ever reaches the parser.
function validMp4Boxes(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const boxes = new Set<string>();
  while (offset < bytes.byteLength) {
    if (bytes.byteLength - offset < STORAGE_BINARY.mp4HeaderBytes) return false;
    let length = view.getUint32(offset);
    const type = ascii(
      bytes,
      offset + STORAGE_BINARY.mp4TypeStart,
      STORAGE_BINARY.uint32Bytes,
    );
    let headerLength: number = STORAGE_BINARY.mp4HeaderBytes;
    if (!STORAGE_MP4_TOP_LEVEL_BOXES.some((allowed) => type === allowed))
      return false;
    if (length === 1) {
      if (bytes.byteLength - offset < STORAGE_BINARY.mp4LargeHeaderBytes)
        return false;
      const bigLength = view.getBigUint64(
        offset + STORAGE_BINARY.mp4HeaderBytes,
      );
      if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) return false;
      length = Number(bigLength);
      headerLength = STORAGE_BINARY.mp4LargeHeaderBytes;
    }
    if (length === 0) length = bytes.byteLength - offset;
    if (length < headerLength || length > bytes.byteLength - offset)
      return false;
    if (offset === 0 && type !== STORAGE_SIGNATURES.ftyp) return false;
    if (
      type === 'moov' &&
      !validLocalReferences(bytes, offset + headerLength, offset + length)
    )
      return false;
    boxes.add(type);
    offset += length;
  }
  return boxes.has('ftyp') && boxes.has('moov') && boxes.has('mdat');
}
async function verifyPhoto(
  bytes: Uint8Array,
  input: MediaVerificationInput,
): Promise<StorageResult<VerifiedMedia>> {
  const format =
    input.mimeType === 'image/jpeg'
      ? 'jpeg'
      : input.mimeType === 'image/png'
        ? 'png'
        : 'webp';
  const image = sharp(bytes, {
    failOn: 'warning',
    limitInputPixels: STORAGE_MAX_PIXELS,
    sequentialRead: true,
  });
  const metadata = await image.metadata();
  if (
    metadata.format !== format ||
    (metadata.pages ?? 1) !== 1 ||
    !dimensions(metadata.width, metadata.height)
  )
    return invalid;
  // Full decode and same-format re-encode, not merely header sniffing. EXIF/GPS,
  // comments, appended bytes and other input metadata are not copied to output.
  const output = await image
    .rotate()
    .toColourspace('srgb')
    .toFormat(format, { quality: STORAGE_IMAGE_QUALITY })
    .toBuffer({ resolveWithObject: true });
  if (
    !output.data.byteLength ||
    output.data.byteLength > input.maxBytes ||
    !dimensions(output.info.width, output.info.height)
  )
    return invalid;
  return {
    ok: true,
    data: {
      bytes: output.data,
      mimeType: input.mimeType,
      byteSize: output.data.byteLength,
      width: output.info.width,
      height: output.info.height,
      durationMs: null,
    },
  };
}
function numericTrack(track: Track, key: string) {
  const value = (track as unknown as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}
function measuredDuration(track: Track) {
  const durations = ['Duration', 'Source_Duration'].flatMap((key) => {
    const value = numericTrack(track, key);
    return value === null ? [] : [value];
  });
  const frames = numericTrack(track, 'FrameCount');
  const frameRate = numericTrack(track, 'FrameRate');
  if (frames && frameRate) durations.push(frames / frameRate);
  const samples = numericTrack(track, 'SamplingCount');
  const sampleRate = numericTrack(track, 'SamplingRate');
  if (samples && sampleRate) durations.push(samples / sampleRate);
  return durations.length ? Math.max(...durations) : null;
}
// MediaInfo intentionally returns partial metadata for corrupt files; having
// plausible tracks is not success. Reject its nested parser diagnostics too.
function hasCorruption(
  value: unknown,
  state = { nodes: 0 },
  depth = 0,
): boolean {
  state.nodes += 1;
  if (
    depth > STORAGE_MEDIA_METADATA_MAX_DEPTH ||
    state.nodes > STORAGE_MEDIA_METADATA_MAX_NODES
  )
    return true;
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value))
    return value.some((entry) => hasCorruption(entry, state, depth + 1));
  return Object.entries(value).some(([key, entry]) => {
    if (
      (key === 'ConformanceErrors' || key === 'ConformanceWarnings') &&
      entry !== null &&
      entry !== '' &&
      !(Array.isArray(entry) && entry.length === 0)
    )
      return true;
    if (key === 'IsTruncated' && entry !== 'No' && entry !== false) return true;
    return hasCorruption(entry, state, depth + 1);
  });
}

async function verifyTimeMedia(
  bytes: Uint8Array,
  input: MediaVerificationInput,
): Promise<StorageResult<VerifiedMedia>> {
  let parser;
  try {
    parser = await mediaInfoFactory({
      format: 'object',
      chunkSize: STORAGE_MEDIA_CHUNK_BYTES,
      coverData: false,
      full: false,
    });
  } catch {
    // Missing/unloadable deployment assets are infrastructure failures, not a
    // permanent content rejection. Keep the private intent available to retry.
    return { ok: false, code: 'UNAVAILABLE' };
  }
  try {
    let chunks = 0;
    const result = await parser.analyzeData(
      bytes.byteLength,
      (size, offset) => {
        chunks += 1;
        if (
          chunks > STORAGE_MEDIA_MAX_CHUNKS ||
          !Number.isSafeInteger(size) ||
          !Number.isSafeInteger(offset) ||
          size < 0 ||
          size > STORAGE_MEDIA_CHUNK_BYTES ||
          offset < 0 ||
          offset > bytes.byteLength
        )
          throw new Error('INVALID_MEDIA_READ');
        return bytes.subarray(
          offset,
          Math.min(offset + size, bytes.byteLength),
        );
      },
    );
    if (hasCorruption(result)) return invalid;
    const tracks = result.media?.track;
    if (!tracks?.length) return invalid;
    const general = tracks.filter((track) => track['@type'] === 'General');
    const audio = tracks.filter((track) => track['@type'] === 'Audio');
    const video = tracks.filter((track) => track['@type'] === 'Video');
    if (
      general.length !== 1 ||
      tracks.length !== general.length + audio.length + video.length ||
      audio.length > STORAGE_MAX_AUDIO_TRACKS ||
      video.length > STORAGE_MAX_VIDEO_TRACKS ||
      (input.kind === 'voice'
        ? audio.length !== 1 || video.length !== 0
        : video.length !== 1)
    )
      return invalid;
    const container = general[0]!;
    const expectedFormat = input.mimeType.endsWith('/mp4')
      ? 'MPEG-4'
      : input.mimeType.endsWith('/webm')
        ? 'WebM'
        : 'MPEG Audio';
    if (
      container.Format !== expectedFormat ||
      Number(container.FileSize) !== bytes.byteLength
    )
      return invalid;
    const codecs = STORAGE_CODECS_BY_CONTAINER[expectedFormat];
    if (
      tracks.some((track) => 'Encryption' in track && Boolean(track.Encryption))
    )
      return invalid;
    if (
      audio.some(
        (track) =>
          !codecs.audio.some((format) => track.Format === format) ||
          (track.Format === 'AAC' &&
            track.Format_AdditionalFeatures !== 'LC') ||
          !track.Channels ||
          track.Channels > STORAGE_MAX_AUDIO_CHANNELS ||
          !numericTrack(track, 'SamplingRate'),
      )
    )
      return invalid;
    if (
      video.some(
        (track) =>
          !codecs.video.some((format) => track.Format === format) ||
          !dimensions(track.Width, track.Height) ||
          (track.FrameRate !== undefined &&
            (!Number.isFinite(track.FrameRate) ||
              track.FrameRate <= 0 ||
              track.FrameRate > STORAGE_MAX_FRAME_RATE)),
      )
    )
      return invalid;
    // Take the longest parsed container/track/sample duration. Client duration
    // is never used, and an undecidable duration fails closed.
    const durations = tracks
      .map(measuredDuration)
      .filter((duration): duration is number => duration !== null);
    const packetDurationMs = input.maxDurationMs
      ? await probePacketDuration(bytes, input.kind, input.maxDurationMs)
      : null;
    if (packetDurationMs === null) return invalid;
    const durationMs = Math.max(
      packetDurationMs,
      Math.ceil(Math.max(0, ...durations) * STORAGE_MILLISECONDS_PER_SECOND),
    );
    if (
      !input.maxDurationMs ||
      !Number.isSafeInteger(durationMs) ||
      durationMs <= 0 ||
      durationMs > input.maxDurationMs
    )
      return invalid;
    return {
      ok: true,
      data: {
        bytes,
        mimeType: input.mimeType,
        byteSize: bytes.byteLength,
        width: video[0]?.Width ?? null,
        height: video[0]?.Height ?? null,
        durationMs,
      },
    };
  } finally {
    parser.close();
  }
}

/** Parses actual bounded bytes, never filename, client dimensions or client duration. */
export const verifyMedia: MediaVerifier = async (bytes, input) => {
  try {
    if (
      !(bytes instanceof Uint8Array) ||
      !bytes.byteLength ||
      !Number.isSafeInteger(input.maxBytes) ||
      input.maxBytes <= 0 ||
      input.maxBytes > STORAGE_MAX_BYTES ||
      bytes.byteLength > input.maxBytes ||
      !mediaMimeSchema.safeParse(input.mimeType).success ||
      (input.kind === 'photo'
        ? input.maxDurationMs !== null
        : !Number.isSafeInteger(input.maxDurationMs) ||
          input.maxDurationMs! <= 0 ||
          input.maxDurationMs! > STORAGE_MAX_DURATION_MS) ||
      !signatureMatches(bytes, input)
    )
      return invalid;
    return input.kind === 'photo'
      ? await verifyPhoto(bytes, input)
      : await verifyTimeMedia(bytes, input);
  } catch {
    // Native/WASM exception text can contain input metadata; do not expose it.
    return invalid;
  }
};
