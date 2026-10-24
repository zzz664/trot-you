import 'server-only';
import {
  BufferSource,
  EncodedPacketSink,
  Input,
  Logging,
  LogLevel,
  MP3,
  MP4,
  WEBM,
} from 'mediabunny';
import type { MediaKind } from '@/config/media';
import {
  STORAGE_AAC_LC_SAMPLES_PER_PACKET,
  STORAGE_OPUS,
  STORAGE_MAX_AUDIO_TRACKS,
  STORAGE_MAX_VIDEO_TRACKS,
  STORAGE_MILLISECONDS_PER_SECOND,
  STORAGE_PACKET_BYTE_MULTIPLIER,
  STORAGE_PACKET_MAX_COUNT,
  STORAGE_PACKET_TIMEOUT_MS,
} from '@/config/storage';

// Parser warnings can include untrusted metadata. Never send them to logs.
Logging.level = LogLevel.Silent;

function opusDurationSeconds(bytes: Uint8Array): number | null {
  const toc = bytes[0];
  if (toc === undefined) return null;
  const config = toc >> STORAGE_OPUS.configShift;
  const frameCode = toc & STORAGE_OPUS.frameCodeMask;
  const frameCount =
    frameCode === 0
      ? 1
      : frameCode === STORAGE_OPUS.variableFramesCode
        ? (bytes[1] ?? 0) & STORAGE_OPUS.frameCountMask
        : STORAGE_OPUS.twoFramesCode;
  const frameMs =
    config < STORAGE_OPUS.silkConfigEnd
      ? STORAGE_OPUS.silkDurationsMs[config % STORAGE_OPUS.silkDurationModulo]
      : config < STORAGE_OPUS.hybridConfigEnd
        ? STORAGE_OPUS.hybridDurationsMs[
            config % STORAGE_OPUS.hybridDurationModulo
          ]
        : STORAGE_OPUS.celtDurationsMs[
            config % STORAGE_OPUS.silkDurationModulo
          ];
  if (!frameCount || frameMs === undefined) return null;
  const ms = frameCount * frameMs;
  return ms > 0 && ms <= STORAGE_OPUS.maxPacketDurationMs
    ? ms / STORAGE_MILLISECONDS_PER_SECOND
    : null;
}

/**
 * Full bounded packet traversal, independent of Info/Xing/mvhd duration hints.
 * BufferSource is the only input: no network/file sources, playlists or decoders.
 */
export async function probePacketDuration(
  bytes: Uint8Array,
  kind: MediaKind,
  maxDurationMs: number,
): Promise<number | null> {
  const input = new Input({
    source: new BufferSource(bytes),
    formats: [MP3, MP4, WEBM],
  });
  const deadline = Date.now() + STORAGE_PACKET_TIMEOUT_MS;
  let packetCount = 0;
  let packetBytes = 0;
  let measuredSeconds = 0;
  try {
    const tracks = await input.getTracks();
    const audio = tracks.filter((track) => track.isAudioTrack());
    const video = tracks.filter((track) => track.isVideoTrack());
    if (
      tracks.length !== audio.length + video.length ||
      audio.length > STORAGE_MAX_AUDIO_TRACKS ||
      video.length > STORAGE_MAX_VIDEO_TRACKS ||
      (kind === 'voice'
        ? audio.length !== 1 || video.length !== 0
        : video.length !== 1)
    )
      return null;
    for (const track of tracks) {
      let trackDuration = 0;
      let trackPackets = 0;
      const sink = new EncodedPacketSink(track);
      const codec = await track.getCodec();
      const sampleRate = track.isAudioTrack()
        ? await track.getSampleRate()
        : null;
      let longestPacketDuration = 0;
      // Do not use getDurationFromMetadata, metadataOnly or a fast last-packet
      // seek: stale indexes and non-monotonic presentation order are untrusted.
      for await (const packet of sink.packets()) {
        packetCount += 1;
        trackPackets += 1;
        packetBytes += packet.byteLength;
        if (
          packetCount > STORAGE_PACKET_MAX_COUNT ||
          Date.now() > deadline ||
          packetBytes > bytes.byteLength * STORAGE_PACKET_BYTE_MULTIPLIER ||
          !Number.isFinite(packet.timestamp) ||
          !Number.isFinite(packet.duration) ||
          packet.duration < 0 ||
          !packet.byteLength ||
          packet.byteLength !== packet.data.byteLength ||
          packet.sideData.alpha ||
          packet.sideData.alphaByteLength
        )
          return null;
        const codecDuration =
          codec === 'opus'
            ? opusDurationSeconds(packet.data)
            : codec === 'aac' &&
                sampleRate &&
                Number.isFinite(sampleRate) &&
                sampleRate > 0
              ? STORAGE_AAC_LC_SAMPLES_PER_PACKET / sampleRate
              : 0;
        if (codecDuration === null) return null;
        // Live WebM often omits the last BlockDuration. Opus TOC gives exact
        // encoded frame duration. Video without it uses the largest observed
        // packet interval; unknown single-frame timing fails closed.
        const duration = Math.max(
          packet.duration,
          codecDuration,
          track.isVideoTrack() && packet.duration === 0
            ? longestPacketDuration
            : 0,
        );
        if (!duration) return null;
        longestPacketDuration = Math.max(longestPacketDuration, duration);
        trackDuration += duration;
        measuredSeconds = Math.max(
          measuredSeconds,
          trackDuration,
          packet.timestamp + duration,
        );
        if (measuredSeconds * STORAGE_MILLISECONDS_PER_SECOND > maxDurationMs)
          return null;
      }
      if (!trackPackets) return null;
    }
    const durationMs = Math.ceil(
      measuredSeconds * STORAGE_MILLISECONDS_PER_SECOND,
    );
    return Number.isSafeInteger(durationMs) &&
      durationMs > 0 &&
      durationMs <= maxDurationMs
      ? durationMs
      : null;
  } catch {
    return null;
  } finally {
    input.dispose();
  }
}
