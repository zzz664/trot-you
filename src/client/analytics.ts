import { AnalyticsEvent } from '@/config/analytics-events';
import {
  ANALYTICS_REQUEST_TIMEOUT_MS,
  voiceInputEventSchema,
  type VoiceInputContext,
} from '@/config/analytics';
import { routes } from '@/config/routes';

// Best effort only. A MicButton supplies one key per accepted recognition
// session; neither transport errors nor the response can trigger another send.
// The server/DB checks current optional consent and approved collection policy.
export async function recordVoiceInput(
  context: VoiceInputContext,
  eventKey: string,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return;
  const parsed = voiceInputEventSchema.safeParse({
    event_key: eventKey,
    name: AnalyticsEvent.VOICE_INPUT_USED,
    properties: { voice_context: context },
  });
  if (!parsed.success) return;
  try {
    const timeout = AbortSignal.timeout(ANALYTICS_REQUEST_TIMEOUT_MS);
    const response = await fetch(routes.analytics, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.data),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    // No response body is needed, persisted, logged, or used to control drafts.
    await response.body?.cancel();
  } catch {
    // Optional measurement must never block, retry, or modify the user's draft.
  }
}
