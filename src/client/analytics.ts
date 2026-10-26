import {
  AnalyticsEvent,
  clientAnalyticsEventSchema,
} from '@/config/analytics-events';
import {
  ANALYTICS_REQUEST_TIMEOUT_MS,
  ANALYTICS_PREVIEW_ACTOR_HEADER,
  previewAnalyticsActorSchema,
  previewAnalyticsSchema,
  voiceInputEventSchema,
  type VoiceInputContext,
} from '@/config/analytics';
import { routes } from '@/config/routes';

// Best effort only. Keys belong to the committing UI lifecycle, never a retry
// loop. Current optional consent and source access are checked by the database.
async function sendObservation(
  path: string,
  input: unknown,
  signal?: AbortSignal,
  expectedActor?: string,
): Promise<void> {
  if (signal?.aborted) return;
  try {
    const timeout = AbortSignal.timeout(ANALYTICS_REQUEST_TIMEOUT_MS);
    const response = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        ...(expectedActor
          ? { [ANALYTICS_PREVIEW_ACTOR_HEADER]: expectedActor }
          : {}),
      },
      body: JSON.stringify(input),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    // No response is retained, logged or used to alter the user's business state.
    await response.body?.cancel();
  } catch {
    // Aborts/unknown outcomes never trigger a resend or a source-operation retry.
  }
}
export async function recordVoiceInput(
  context: VoiceInputContext,
  eventKey: string,
  signal?: AbortSignal,
): Promise<void> {
  const parsed = voiceInputEventSchema.safeParse({
    event_key: eventKey,
    name: AnalyticsEvent.VOICE_INPUT_USED,
    properties: { voice_context: context },
  });
  if (parsed.success)
    await sendObservation(routes.analytics, parsed.data, signal);
}
export async function recordMessageOpen(
  sourceId: string,
  eventKey: string,
  signal?: AbortSignal,
): Promise<void> {
  const parsed = clientAnalyticsEventSchema.safeParse({
    event_key: eventKey,
    name: AnalyticsEvent.MESSAGE_OPEN,
    properties: { source_id: sourceId },
  });
  if (parsed.success)
    await sendObservation(routes.analytics, parsed.data, signal);
}
export async function recordPreviewRender(
  sourceId: string,
  eventKey: string,
  expectedActor: string,
  signal?: AbortSignal,
): Promise<void> {
  const parsed = previewAnalyticsSchema.safeParse({
    event_key: eventKey,
    source_id: sourceId,
  });
  const actor = previewAnalyticsActorSchema.safeParse(expectedActor);
  if (parsed.success && actor.success)
    await sendObservation(
      routes.analyticsPreview,
      parsed.data,
      signal,
      actor.data,
    );
}
