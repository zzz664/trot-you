import 'server-only';
import { getServerEnv } from '@/config/env.server';
import { DISPATCH_WORKER_REQUEST_TIMEOUT_MS } from '@/config/message-dispatch';
import { createCheckoutServiceClient } from '@/server/db/checkout-client';
import { createDispatchWorkerPort } from '@/server/db/message-dispatch';
import type { DispatchWorkerPort } from '@/server/services/message-dispatch/worker';

export function createDispatchDependencies(): DispatchWorkerPort | null {
  const parsed = getServerEnv();
  if (
    !parsed.ok ||
    !parsed.data.MESSAGE_DISPATCH_ENABLED ||
    !parsed.data.MESSAGE_DISPATCH_CRON_SECRET
  )
    return null;
  const client = createCheckoutServiceClient(
    DISPATCH_WORKER_REQUEST_TIMEOUT_MS,
  );
  return client ? createDispatchWorkerPort(client) : null;
}
