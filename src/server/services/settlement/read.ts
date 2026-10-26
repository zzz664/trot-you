import 'server-only';
import { z } from 'zod';
import {
  settlementCalculationEnvelopeSchema,
  settlementCalculationQuerySchema,
  type SettlementCalculationEnvelope,
  type SettlementCalculationQuery,
  type SettlementBreakdown,
  type SettlementCalculationResult,
} from '@/config/settlement-calculation';
import { calculateSettlement } from './calculate';

export type SettlementCalculationPort = {
  read(
    query: SettlementCalculationQuery,
  ): Promise<SettlementCalculationResult<SettlementCalculationEnvelope>>;
};

// This is a preview only: no report/adjustment write, provider or scheduler port.
// Never trust an earlier preview as authority to confirm or persist a report.
export async function previewSettlement(
  port: SettlementCalculationPort,
  input: unknown,
  actorId: string,
): Promise<SettlementCalculationResult<SettlementBreakdown>> {
  const query = settlementCalculationQuerySchema.safeParse(input);
  const actor = z.uuid().toLowerCase().safeParse(actorId);
  if (!query.success || !actor.success)
    return { ok: false, code: 'INVALID_INPUT' };
  try {
    const result = await port.read(query.data);
    if (!result.ok) return result;
    const checked = settlementCalculationEnvelopeSchema.safeParse(result.data);
    if (
      !checked.success ||
      checked.data.actorId !== actor.data ||
      checked.data.input.artistId !== query.data.artistId ||
      checked.data.input.month !== query.data.month
    )
      return { ok: false, code: 'UNAVAILABLE' };
    return calculateSettlement(checked.data.input);
  } catch {
    // No SQL, provider details, source contents or thrown message is returned.
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
