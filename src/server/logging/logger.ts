import 'server-only';
import { ERROR_HTTP_STATUS } from '@/config/errors';
import {
  LOG_EVENTS,
  LOG_HTTP_STATUS_MAX,
  LOG_HTTP_STATUS_MIN,
  LOG_METADATA_FIELDS,
  LOG_MODES,
  LOG_OUTCOMES,
  LOG_PROVIDERS,
  type LogEvent,
  type LogLevel,
} from '@/config/logging';

type SafeMetadata = Record<string, string | number | boolean>;
export type LogSink = (line: string, level: LogLevel) => void;

function isMember(value: unknown, values: readonly string[]): value is string {
  return typeof value === 'string' && values.includes(value);
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * A projection, not a blacklist: unrecognized fields, nested objects, URLs,
 * free text, payloads, names, headers and credentials are never serialized.
 * Descriptor reads do not execute getters; no traversal means cycles are safe.
 * Errors contribute only a fixed marker, never their name/message/stack/cause.
 */
export function redactLogMetadata(input: unknown): SafeMetadata {
  if (input === undefined) return { redacted: false };
  try {
    if (input instanceof Error) {
      return { errorType: 'exception', redacted: true };
    }
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return { redacted: true };
    }

    const fields: SafeMetadata = { redacted: false };
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const unknownKeys = Reflect.ownKeys(descriptors).some(
      (key) => !isMember(key, LOG_METADATA_FIELDS),
    );
    fields.redacted = unknownKeys;

    for (const key of LOG_METADATA_FIELDS) {
      const descriptor = descriptors[key];
      if (!descriptor) continue;
      if (!Object.hasOwn(descriptor, 'value')) {
        fields.redacted = true;
        continue;
      }
      const value: unknown = descriptor.value;
      if (key === 'error') {
        fields.errorType = value instanceof Error ? 'exception' : 'unknown';
        fields.redacted = true;
      } else if (
        (key === 'provider' && isMember(value, LOG_PROVIDERS)) ||
        (key === 'mode' && isMember(value, LOG_MODES)) ||
        (key === 'outcome' && isMember(value, LOG_OUTCOMES)) ||
        (key === 'errorCode' &&
          typeof value === 'string' &&
          Object.hasOwn(ERROR_HTTP_STATUS, value))
      ) {
        fields[key] = value as string;
      } else if (
        isNonnegativeInteger(value) &&
        (key === 'durationMs' ||
          key === 'attemptCount' ||
          (key === 'statusCode' &&
            value >= LOG_HTTP_STATUS_MIN &&
            value <= LOG_HTTP_STATUS_MAX))
      ) {
        fields[key] = value;
      } else {
        fields.redacted = true;
      }
    }
    return fields;
  } catch {
    // Revoked proxies or hostile reflection traps are not loggable metadata.
    return { redacted: true };
  }
}

const defaultSink: LogSink = (line, level) => {
  console[level](line);
};

/** A sink receives only sanitized JSON; sink failures cannot expose raw input. */
export function createLogger(sink: LogSink = defaultSink) {
  function write(
    level: LogLevel,
    event: LogEvent,
    metadata?: unknown,
  ): boolean {
    const validEvent = isMember(event, LOG_EVENTS);
    const fields = redactLogMetadata(metadata);
    const record = {
      timestamp: new Date().toISOString(),
      level,
      event: validEvent ? event : 'log.input_rejected',
      ...fields,
      redacted: !validEvent || fields.redacted === true,
    };
    try {
      sink(JSON.stringify(record), level);
      return true;
    } catch {
      // Callers may observe failed delivery without reflecting a sink exception.
      return false;
    }
  }

  return {
    info: (event: LogEvent, metadata?: unknown) =>
      write('info', event, metadata),
    warn: (event: LogEvent, metadata?: unknown) =>
      write('warn', event, metadata),
    error: (event: LogEvent, metadata?: unknown) =>
      write('error', event, metadata),
  };
}

export const logger = createLogger();
