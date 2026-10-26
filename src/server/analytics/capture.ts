import 'server-only';
import { createMediaServiceClient } from '@/server/db/media-client';
import { createAnalyticsCapturePort } from '@/server/db/analytics-capture';
import type { AnalyticsCapturePort } from '@/server/services/analytics/capture';

export function getAnalyticsCapturePort(): AnalyticsCapturePort | null {
  try {
    const client = createMediaServiceClient();
    return client ? createAnalyticsCapturePort(client) : null;
  } catch {
    return null;
  }
}
