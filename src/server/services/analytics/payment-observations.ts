import 'server-only';
import { AnalyticsEvent } from '@/config/analytics-events';
import type { EnrollmentDbPort } from '@/server/services/enrollment/model';
import type { RenewalDbPort } from '@/server/services/subscription/renewal-model';
import type { ReconciliationDbPort } from '@/server/services/reconciliation/model';
import {
  captureChargeEvent,
  captureServerEvent,
  type AnalyticsCapturePort,
} from './capture';

// Decorate only committed mutation results, never arbitrary reads or provider
// replies. A failed optional observation cannot replace the source result.
export function observeEnrollment(
  port: EnrollmentDbPort,
  analytics: AnalyticsCapturePort | null,
): EnrollmentDbPort {
  return {
    ...port,
    async start(...args) {
      const result = await port.start(...args);
      if (
        result.ok &&
        result.data.user_id === args[0].actorId &&
        result.data.session_id === args[1]
      )
        await captureServerEvent(analytics, {
          actor_id: args[0].actorId,
          event: {
            name: AnalyticsEvent.SUBSCRIBE_START,
            event_key: result.data.session_id,
            properties: { source_id: result.data.subscription_id },
          },
        });
      return result;
    },
    async recordOutcome(...args) {
      const result = await port.recordOutcome(...args);
      if (
        args[3] === 'failed' &&
        result.ok &&
        result.data.user_id === args[0] &&
        result.data.session_id === args[1] &&
        result.data.state === 'failed' &&
        (result.data.stage === 'charge' || result.data.stage === 'approve')
      )
        await captureServerEvent(analytics, {
          actor_id: args[0],
          event: {
            name: AnalyticsEvent.SUBSCRIBE_FAIL,
            event_key: result.data.order_id,
            properties: { source_id: result.data.order_id },
          },
        });
      return result;
    },
    async finalize(...args) {
      const result = await port.finalize(...args);
      if (
        result.ok &&
        result.data.user_id === args[0] &&
        result.data.session_id === args[1] &&
        result.data.state === 'succeeded' &&
        result.data.payment_event_id
      )
        await captureChargeEvent(analytics, result.data.payment_event_id);
      return result;
    },
  };
}
export function observeRenewal(
  port: RenewalDbPort,
  analytics: AnalyticsCapturePort | null,
): RenewalDbPort {
  return {
    ...port,
    async finalize(...args) {
      const result = await port.finalize(...args);
      if (result.ok) await captureChargeEvent(analytics, result.data);
      return result;
    },
  };
}
export function observeReconciliation(
  port: ReconciliationDbPort,
  analytics: AnalyticsCapturePort | null,
): ReconciliationDbPort {
  return {
    ...port,
    async complete(...args) {
      const result = await port.complete(...args);
      if (
        result.ok &&
        result.data.id === args[0] &&
        result.data.state === 'processed' &&
        result.data.kind !== 'refund' &&
        result.data.payment_event_id
      )
        await captureChargeEvent(analytics, result.data.payment_event_id);
      return result;
    },
  };
}
