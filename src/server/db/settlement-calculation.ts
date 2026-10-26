import 'server-only';
import {
  settlementCalculationEnvelopeSchema,
  type SettlementCalculationError,
} from '@/config/settlement-calculation';
import type { SettlementCalculationPort } from '@/server/services/settlement/read';
import type { ActorClient } from './client';

const errors: Record<string, SettlementCalculationError> = {
  SETTLEMENT_ADMIN_REQUIRED: 'FORBIDDEN',
  SETTLEMENT_MONTH_INVALID: 'INVALID_INPUT',
  SETTLEMENT_MONTH_OPEN: 'MONTH_OPEN',
  SETTLEMENT_POLICY_REQUIRED: 'POLICY_REQUIRED',
  SETTLEMENT_CONFIRMED: 'CONFIRMED',
  SETTLEMENT_FULL_MONTH_CONTRACT_REQUIRED: 'FULL_MONTH_CONTRACT_REQUIRED',
  SETTLEMENT_PARTIAL_WEEK_POLICY_REQUIRED: 'PARTIAL_WEEK_POLICY_REQUIRED',
  SETTLEMENT_ADJUSTMENT_POLICY_REQUIRED: 'ADJUSTMENT_POLICY_REQUIRED',
  SETTLEMENT_NEGATIVE_NET_REQUIRES_POLICY: 'NEGATIVE_NET_REQUIRES_POLICY',
  SETTLEMENT_SOURCE_MISMATCH: 'SOURCE_MISMATCH',
  SETTLEMENT_SOURCE_LIMIT_EXCEEDED: 'SOURCE_LIMIT_EXCEEDED',
};

export function createSettlementCalculationPort(
  client: ActorClient,
): SettlementCalculationPort {
  return {
    async read(query) {
      const { data, error } = await client.rpc('settlement_calculation_input', {
        p_artist_id: query.artistId,
        p_month: query.month,
      });
      if (error)
        return {
          ok: false,
          code: Object.hasOwn(errors, error.message)
            ? errors[error.message]!
            : 'UNAVAILABLE',
        };
      const parsed = settlementCalculationEnvelopeSchema.safeParse(data);
      return parsed.success
        ? { ok: true, data: parsed.data }
        : { ok: false, code: 'UNAVAILABLE' };
    },
  };
}
