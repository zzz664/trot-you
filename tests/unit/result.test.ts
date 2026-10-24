import { describe, expect, expectTypeOf, it } from 'vitest';
import { ERROR_HTTP_STATUS, type ErrorCode } from '@/config/errors';
import { failure, success, type Result } from '@/lib/result';
import messages from '@/messages/ko.json';
import { internalFailure } from '@/server/errors';

describe('typed Result and error taxonomy', () => {
  it('narrows success payload and failure subset without throwing', () => {
    const result: Result<{ id: string }, 'NOT_FOUND'> = success({
      id: 'fixture',
    });
    if (result.ok) expectTypeOf(result.data).toEqualTypeOf<{ id: string }>();
    const missing = failure('NOT_FOUND');
    if (!missing.ok)
      expectTypeOf(missing.error.code).toEqualTypeOf<'NOT_FOUND'>();
    expect(missing).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: messages.errors.NOT_FOUND },
    });
  });
  it('has a localized safe message and HTTP mapping for every code', () => {
    expect(Object.keys(messages.errors).sort()).toEqual(
      Object.keys(ERROR_HTTP_STATUS).sort(),
    );
    for (const code of Object.keys(ERROR_HTTP_STATUS) as ErrorCode[]) {
      expect(failure(code)).toMatchObject({
        ok: false,
        error: { code, message: messages.errors[code] },
      });
      expect(ERROR_HTTP_STATUS[code]).toBeGreaterThanOrEqual(400);
    }
  });
  it('exposes neither internal exceptions nor provider details', () => {
    expect(internalFailure()).toEqual({
      ok: false,
      error: { code: 'INTERNAL', message: messages.errors.INTERNAL },
    });
    expect(failure('PAYMENT_FAILED')).not.toHaveProperty('error.details');
  });
});
