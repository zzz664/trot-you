// Fixed storage routes and technical parser safety limits. Business upload,
// duration and file-count limits are checked against the private policy RPC.
export const STORAGE_QUARANTINE_BUCKET = 'media-quarantine';
export const STORAGE_MEDIA_BUCKET = 'message-media';
export const STORAGE_UPLOAD_URL_PREFIX =
  '/storage/v1/object/upload/sign/media-quarantine/';
export const STORAGE_READ_URL_PREFIX = '/storage/v1/object/sign/message-media/';
export const STORAGE_TIMEOUT_MS = 30_000;
export const STORAGE_MAX_BYTES = 104_857_600;
export const STORAGE_MAX_READ_TTL_SECONDS = 60;
export const STORAGE_MAX_PIXELS = 40_000_000;
export const STORAGE_MAX_DIMENSION = 10_000;
export const STORAGE_MEDIA_CHUNK_BYTES = 262_144;
export const STORAGE_MEDIA_MAX_CHUNKS = 1600;
export const STORAGE_MILLISECONDS_PER_SECOND = 1000;
export const STORAGE_IMAGE_QUALITY = 90;
export const STORAGE_MAX_DURATION_MS = 86_400_000;
export const STORAGE_MAX_AUDIO_CHANNELS = 8;
export const STORAGE_MAX_AUDIO_TRACKS = 1;
export const STORAGE_MAX_VIDEO_TRACKS = 1;
export const STORAGE_MAX_FRAME_RATE = 240;
export const STORAGE_UUID_SOURCE =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
export const STORAGE_OBJECT_PATH_PATTERN = new RegExp(
  `^${STORAGE_UUID_SOURCE}/${STORAGE_UUID_SOURCE}/${STORAGE_UUID_SOURCE}\\.(?:jpg|png|webp|mp3|m4a|webm|mp4)$`,
);
export const STORAGE_QUARANTINE_PATH_PATTERN = STORAGE_OBJECT_PATH_PATTERN;
export const STORAGE_MIME_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/webm': 'webm',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
} as const;
export const STORAGE_SIGNATURES = {
  jpeg: [0xff, 0xd8, 0xff],
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  ebml: [0x1a, 0x45, 0xdf, 0xa3],
  riff: 'RIFF',
  webp: 'WEBP',
  id3: 'ID3',
  ftyp: 'ftyp',
} as const;
export const STORAGE_BINARY = {
  uint32Bytes: 4,
  uint64Bytes: 8,
  mp4HeaderBytes: 8,
  mp4LargeHeaderBytes: 16,
  mp4TypeStart: 4,
  webpTypeStart: 8,
  webpHeaderBytes: 12,
  mp3SyncMask: 0xe0,
  mp3SyncFirst: 0xff,
  mp3HeaderBytes: 4,
} as const;
export const STORAGE_MP4_TOP_LEVEL_BOXES = [
  'ftyp',
  'free',
  'skip',
  'wide',
  'mdat',
  'moov',
] as const;
export const STORAGE_AUDIO_FORMATS = [
  'MPEG Audio',
  'AAC',
  'Opus',
  'Vorbis',
] as const;
export const STORAGE_VIDEO_FORMATS = [
  'AVC',
  'HEVC',
  'VP8',
  'VP9',
  'AV1',
] as const;

export const STORAGE_SIGNED_TOKEN_MAX_LENGTH = 8192;

export const STORAGE_JWT_PARTS = 3;
export const STORAGE_JWT_PAYLOAD_INDEX = 1;

export const STORAGE_MEDIA_METADATA_MAX_DEPTH = 64;
export const STORAGE_MEDIA_METADATA_MAX_NODES = 10_000;
export const STORAGE_MP4_REFERENCE_CONTAINERS = [
  'moov',
  'trak',
  'mdia',
  'minf',
  'dinf',
  'edts',
] as const;
export const STORAGE_MP4_EXTERNAL_REFERENCE_BOXES = [
  'rmra',
  'rmda',
  'rdrf',
] as const;
export const STORAGE_MP4_FULL_BOX_HEADER_BYTES = 8;
export const STORAGE_MP4_SELF_CONTAINED_ENTRY_BYTES = 12;
export const STORAGE_CODECS_BY_CONTAINER = {
  'MPEG Audio': { audio: ['MPEG Audio'], video: [] },
  'MPEG-4': { audio: ['AAC'], video: ['AVC'] },
  WebM: { audio: ['Opus', 'Vorbis'], video: ['VP8', 'VP9', 'AV1'] },
} as const;
export const STORAGE_PACKET_MAX_COUNT = 100_000;
export const STORAGE_PACKET_TIMEOUT_MS = 5000;
export const STORAGE_PACKET_BYTE_MULTIPLIER = 2;
export const STORAGE_AAC_LC_SAMPLES_PER_PACKET = 1024;
export const STORAGE_OPUS = {
  configShift: 3,
  frameCodeMask: 3,
  frameCountMask: 63,
  silkConfigEnd: 12,
  hybridConfigEnd: 16,
  silkDurationModulo: 4,
  hybridDurationModulo: 2,
  silkDurationsMs: [10, 20, 40, 60],
  hybridDurationsMs: [10, 20],
  celtDurationsMs: [2.5, 5, 10, 20],
  twoFramesCode: 2,
  variableFramesCode: 3,
  maxPacketDurationMs: 120,
} as const;
export const STORAGE_MP4_EDITS = {
  version1Flags: 0x01000000,
  version0EntryBytes: 12,
  version1EntryBytes: 20,
  maximumEntries: 2,
  mediaRateOne: 0x00010000,
} as const;
