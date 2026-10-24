import 'server-only';
import { ERROR_HTTP_STATUS } from '@/config/errors';
import { failure } from '@/lib/result';

export type { ErrorCode } from '@/config/errors';
export { ERROR_HTTP_STATUS };

// Unexpected errors must not serialize stack/cause/provider payload to clients.
// Log only allowlisted operational metadata through server/logging/logger.
export function internalFailure() {
  return failure('INTERNAL');
}
