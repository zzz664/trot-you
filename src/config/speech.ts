// Technical lifecycle/resource bounds, not a new product content policy.
export const SPEECH_LANGUAGE = 'ko-KR';
export const SPEECH_START_TIMEOUT_MS = 15_000;
export const SPEECH_SESSION_TIMEOUT_MS = 60_000;
export const SPEECH_STOP_TIMEOUT_MS = 5_000;
export const SPEECH_MAX_RESULTS = 128;
export const SPEECH_MAX_TRANSCRIPT_LENGTH = 10_000;
export const SPEECH_MAX_TRANSCRIPT_CODE_UNITS =
  SPEECH_MAX_TRANSCRIPT_LENGTH * 2;
export type SpeechPhase = 'starting' | 'listening' | 'stopping';
export type SpeechError =
  | 'permission'
  | 'noSpeech'
  | 'network'
  | 'audio'
  | 'language'
  | 'unavailable'
  | 'tooLong'
  | 'timeout';
