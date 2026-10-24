import type { ErrorCode } from '@/config/errors';
import messages from '@/messages/ko.json';

export type Result<T, E extends ErrorCode = ErrorCode> =
  | {
      readonly ok: true;
      readonly data: T;
      readonly meta?: { readonly nextCursor?: string };
    }
  | {
      readonly ok: false;
      readonly error: { readonly code: E; readonly message: string };
    };

export function success<T>(data: T): Result<T, never> {
  return { ok: true, data };
}

// No arbitrary exception, provider message or raw details enter a public error.
export function failure<E extends ErrorCode>(code: E): Result<never, E> {
  return { ok: false, error: { code, message: messages.errors[code] } };
}
