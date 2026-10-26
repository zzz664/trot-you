import 'server-only';
import type { SettlementReportEnvelope } from '@/config/settlement-reports';
import { validateSettlementReportEnvelope } from './manage';

// Explicit allowlisted report DTO has no fan, subscription, provider or account
// fields. Flatten the complete frozen snapshot, not a recalculated live view.
export function settlementWorkbookModel(input: SettlementReportEnvelope) {
  const checked = validateSettlementReportEnvelope(input);
  if (
    !checked.ok ||
    checked.data.actorRole !== 'admin' ||
    !checked.data.report ||
    checked.data.sources === null
  )
    throw new Error('SETTLEMENT_EXPORT_INVALID');
  const { artist, month, report, sources } = checked.data;
  const summary: [string, string][] = [];
  function append(path: string, value: unknown) {
    if (value === null) summary.push([path, 'null']);
    else if (typeof value === 'object') {
      for (const [key, child] of Object.entries(value))
        append(`${path}.${key}`, child);
    } else if (['string', 'number', 'boolean'].includes(typeof value))
      summary.push([path, String(value)]);
    else throw new Error('SETTLEMENT_EXPORT_INVALID');
  }
  append('artist', artist);
  append('month', month);
  append('report', report);
  return {
    summary,
    events: sources.map(({ id, kind, amountKrw, occurredAt, origin }) => ({
      id,
      kind,
      amountKrw,
      occurredAt,
      origin,
    })),
  };
}
