import { COMPOSE_RECORDING } from '@/config/compose-capture';

export type CapturePhase = 'requesting' | 'recording' | 'stopping';
export type RecordingError =
  | 'permission'
  | 'unavailable'
  | 'device'
  | 'empty'
  | 'tooLarge'
  | 'timeout'
  | 'busy';
export type ComposeRecording = {
  start(): void;
  stop(): void;
  cancel(): void;
};
export type ComposeRecordingCallbacks = {
  maxDurationMs: number;
  maxBytes: number;
  onPhase: (phase: CapturePhase) => void;
  onElapsed: (elapsedMs: number) => void;
  onResult: (file: File) => void;
  onError: (error: RecordingError) => void;
  onEnd: () => void;
};
let activeRecording: symbol | null = null;
function supportedMime(): string | null {
  if (
    typeof window === 'undefined' ||
    window.isSecureContext !== true ||
    typeof MediaRecorder !== 'function' ||
    typeof MediaRecorder.isTypeSupported !== 'function' ||
    typeof navigator.mediaDevices?.getUserMedia !== 'function'
  )
    return null;
  try {
    return (
      COMPOSE_RECORDING.mimeCandidates.find((mime) =>
        MediaRecorder.isTypeSupported(mime),
      ) ?? null
    );
  } catch {
    return null;
  }
}
export function supportsComposeRecording(): boolean {
  return supportedMime() !== null;
}
function normalizedMime(value: string): 'audio/webm' | 'audio/mp4' | null {
  const base = value.split(';')[0]?.trim().toLowerCase();
  return base === 'audio/webm' || base === 'audio/mp4' ? base : null;
}
function permissionError(error: unknown): RecordingError {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError')
      return 'permission';
    if (error.name === 'NotFoundError' || error.name === 'NotReadableError')
      return 'device';
  }
  return 'unavailable';
}
function stopTracks(stream: MediaStream) {
  stream.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {
      // No diagnostics from browser media devices enter application copy/logs.
    }
  });
}

// Construction performs no permission request or capture. The disclosure UI
// must call start only after an explicit click. This helper never uploads,
// persists, logs, or generates an object URL for the local recording.
export function createComposeRecording(
  callbacks: ComposeRecordingCallbacks,
): ComposeRecording {
  const token = Symbol();
  let started = false;
  let finished = false;
  let acquiring = false;
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: Blob[] = [];
  let totalBytes = 0;
  let phase: CapturePhase = 'requesting';
  let startAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  const release = () => {
    // getUserMedia itself cannot be canceled. A canceled permission request
    // holds the single-flight slot until it settles, preventing duplicate
    // prompts/streams; late grants are immediately stopped, never recorded.
    if (!acquiring && activeRecording === token) activeRecording = null;
  };
  const detachTracks = () => {
    stream
      ?.getTracks()
      .forEach((track) => track.removeEventListener('ended', deviceEnded));
  };
  const detach = () => {
    clearTimeout(timer);
    clearInterval(interval);
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', cancel);
      window.removeEventListener('popstate', cancel);
      document.removeEventListener('visibilitychange', hidden);
    }
    detachTracks();
    if (recorder) {
      recorder.onstart = null;
      recorder.ondataavailable = null;
      recorder.onerror = null;
      recorder.onstop = null;
    }
  };
  const finish = (error?: RecordingError, file?: File) => {
    if (finished) return;
    finished = true;
    detach();
    try {
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    } catch {
      // A device may already have stopped between checking and stopping.
    }
    if (stream) stopTracks(stream);
    stream = null;
    recorder = null;
    chunks = [];
    totalBytes = 0;
    release();
    try {
      if (error) callbacks.onError(error);
      else if (file) callbacks.onResult(file);
    } finally {
      callbacks.onEnd();
    }
  };
  const cancel = () => finish();
  const hidden = () => {
    if (document.visibilityState === 'hidden') cancel();
  };
  const deviceEnded = () => finish('device');
  const deadline = (duration: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => finish('timeout'), duration);
  };
  const stop = () => {
    if (finished || !started || phase !== 'recording' || !recorder) return;
    phase = 'stopping';
    clearInterval(interval);
    callbacks.onElapsed(
      Math.min(
        callbacks.maxDurationMs,
        Math.max(0, performance.now() - startAt),
      ),
    );
    callbacks.onPhase(phase);
    deadline(COMPOSE_RECORDING.stopTimeoutMs);
    // Native stop queues the final dataavailable followed by stop. Detach the
    // track-ended listener before releasing the microphone immediately.
    detachTracks();
    try {
      recorder.stop();
      if (stream) stopTracks(stream);
    } catch {
      finish('unavailable');
    }
  };
  const acquire = async (mimeType: string) => {
    acquiring = true;
    try {
      const granted = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      acquiring = false;
      if (finished) {
        stopTracks(granted);
        release();
        return;
      }
      stream = granted;
      if (
        stream.getAudioTracks().length !== 1 ||
        stream.getTracks().some((track) => track.kind !== 'audio') ||
        stream.getAudioTracks()[0]?.readyState !== 'live'
      ) {
        finish('device');
        return;
      }
      recorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: COMPOSE_RECORDING.audioBitsPerSecond,
      });
      const outputMime = normalizedMime(recorder.mimeType);
      if (outputMime === null || outputMime !== normalizedMime(mimeType)) {
        finish('unavailable');
        return;
      }
      stream
        .getTracks()
        .forEach((track) => track.addEventListener('ended', deviceEnded));
      recorder.onstart = () => {
        if (finished || phase !== 'requesting') return;
        phase = 'recording';
        startAt = performance.now();
        callbacks.onPhase(phase);
        if (finished) return;
        callbacks.onElapsed(0);
        if (finished) return;
        clearTimeout(timer);
        timer = setTimeout(stop, callbacks.maxDurationMs);
        interval = setInterval(() => {
          if (finished || phase !== 'recording') return;
          const elapsed = performance.now() - startAt;
          callbacks.onElapsed(Math.min(callbacks.maxDurationMs, elapsed));
          if (elapsed >= callbacks.maxDurationMs) stop();
        }, COMPOSE_RECORDING.elapsedIntervalMs);
      };
      recorder.ondataavailable = (event) => {
        if (finished) return;
        const chunk = event.data;
        if (!chunk || !Number.isSafeInteger(chunk.size) || chunk.size < 0) {
          finish('unavailable');
          return;
        }
        if (chunk.size === 0) return;
        if (
          chunks.length >= COMPOSE_RECORDING.maxChunks ||
          totalBytes + chunk.size > callbacks.maxBytes
        ) {
          finish('tooLarge');
          return;
        }
        totalBytes += chunk.size;
        chunks.push(chunk);
      };
      recorder.onerror = () => finish('unavailable');
      recorder.onstop = () => {
        if (finished) return;
        if (phase !== 'stopping') {
          finish('device');
          return;
        }
        if (totalBytes <= 0) {
          finish('empty');
          return;
        }
        const file = new File(
          chunks,
          outputMime === 'audio/webm'
            ? COMPOSE_RECORDING.webmFilename
            : COMPOSE_RECORDING.mp4Filename,
          { type: outputMime, lastModified: 0 },
        );
        finish(undefined, file);
      };
      deadline(COMPOSE_RECORDING.requestTimeoutMs);
      recorder.start(COMPOSE_RECORDING.timesliceMs);
    } catch (error) {
      acquiring = false;
      if (!finished) finish(permissionError(error));
      else release();
    }
  };
  return {
    start() {
      if (started || finished) return;
      started = true;
      if (
        !Number.isSafeInteger(callbacks.maxDurationMs) ||
        callbacks.maxDurationMs <= 0 ||
        callbacks.maxDurationMs > COMPOSE_RECORDING.maxDurationMs ||
        !Number.isSafeInteger(callbacks.maxBytes) ||
        callbacks.maxBytes <= 0 ||
        callbacks.maxBytes > COMPOSE_RECORDING.maxBytes
      ) {
        finish('unavailable');
        return;
      }
      const mimeType = supportedMime();
      if (!mimeType) {
        finish('unavailable');
        return;
      }
      if (activeRecording !== null) {
        finish('busy');
        return;
      }
      activeRecording = token;
      window.addEventListener('pagehide', cancel);
      window.addEventListener('popstate', cancel);
      document.addEventListener('visibilitychange', hidden);
      callbacks.onPhase(phase);
      if (finished) return;
      deadline(COMPOSE_RECORDING.requestTimeoutMs);
      void acquire(mimeType);
    },
    stop,
    cancel,
  };
}
