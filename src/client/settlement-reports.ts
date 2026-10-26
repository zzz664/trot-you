import { z } from 'zod';
import {
  SETTLEMENT_REPORTS,
  SETTLEMENT_REPORT_ERROR_STATUS,
  settlementReportCalculateSchema,
  settlementReportConfirmSchema,
  settlementReportEnvelopeSchema,
  settlementReportQuerySchema,
  type SettlementReportEnvelope,
  type SettlementReportError,
  type SettlementReportMode,
  type SettlementReportQuery,
  type SettlementReportResult,
} from '@/config/settlement-reports';
import {
  settlementReportActionPath,
  settlementReportExportPath,
  settlementReportsPath,
} from '@/config/routes';

type CalculateInput = z.output<typeof settlementReportCalculateSchema>;
type ConfirmInput = z.output<typeof settlementReportConfirmSchema>;
const unavailable = { ok: false, code: 'UNAVAILABLE' } as const;
async function readBytes(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return null;
  let size = 0;
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > SETTLEMENT_REPORTS.responseMaxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(new Uint8Array(value));
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
function parseFailure(value: unknown, status: number) {
  const result = z
    .strictObject({ ok: z.literal(false), code: z.string() })
    .safeParse(value);
  if (
    result.success &&
    Object.hasOwn(SETTLEMENT_REPORT_ERROR_STATUS, result.data.code)
  ) {
    const code = result.data.code as SettlementReportError;
    if (status === SETTLEMENT_REPORT_ERROR_STATUS[code])
      return { ok: false, code } as const;
  }
  return unavailable;
}
async function request(
  path: string,
  actorKey: string | undefined,
  signal: AbortSignal | undefined,
  body?: unknown,
): Promise<SettlementReportResult<SettlementReportEnvelope>> {
  const actor = z.uuid().toLowerCase().safeParse(actorKey);
  if (!actor.success) return { ok: false, code: 'FORBIDDEN' };
  if (signal?.aborted) return unavailable;
  try {
    const timeout = AbortSignal.timeout(SETTLEMENT_REPORTS.requestTimeoutMs);
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        [SETTLEMENT_REPORTS.actorHeader]: actor.data,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (
      response.headers.get('content-type')?.split(';')[0]?.trim() !==
      'application/json'
    )
      return unavailable;
    const bytes = await readBytes(response);
    if (!bytes || signal?.aborted || timeout.aborted) return unavailable;
    const value: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    );
    const parsed = z
      .strictObject({
        ok: z.literal(true),
        data: settlementReportEnvelopeSchema,
      })
      .safeParse(value);
    if (!parsed.success) return parseFailure(value, response.status);
    return response.status === SETTLEMENT_REPORTS.httpOk &&
      parsed.data.data.actorId === actor.data &&
      parsed.data.data.sources === null
      ? parsed.data
      : unavailable;
  } catch {
    // Never log report sources, private identities, SQL or authentication data.
    return unavailable;
  }
}
export async function fetchSettlementReport(
  query: SettlementReportQuery,
  mode: SettlementReportMode,
  signal?: AbortSignal,
  actorKey?: string,
): Promise<SettlementReportResult<SettlementReportEnvelope>> {
  const parsed = settlementReportQuerySchema.safeParse(query);
  if (!parsed.success || !['admin', 'artist'].includes(mode))
    return { ok: false, code: 'INVALID_INPUT' };
  const result = await request(
    settlementReportsPath(parsed.data, mode === 'artist', true),
    actorKey,
    signal,
  );
  return !result.ok ||
    (result.data.actorRole === mode &&
      result.data.artist.id === parsed.data.artistId &&
      result.data.month === parsed.data.month)
    ? result
    : unavailable;
}
export async function calculateSettlementReport(
  input: CalculateInput,
  signal?: AbortSignal,
  actorKey?: string,
): Promise<SettlementReportResult<SettlementReportEnvelope>> {
  const parsed = settlementReportCalculateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  const result = await request(
    settlementReportActionPath('calculate'),
    actorKey,
    signal,
    parsed.data,
  );
  return !result.ok ||
    (result.data.actorRole === 'admin' &&
      result.data.artist.id === parsed.data.artistId &&
      result.data.month === parsed.data.month &&
      result.data.report?.status === 'draft')
    ? result
    : unavailable;
}
export async function confirmSettlementReport(
  input: ConfirmInput,
  signal?: AbortSignal,
  actorKey?: string,
): Promise<SettlementReportResult<SettlementReportEnvelope>> {
  const parsed = settlementReportConfirmSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  const result = await request(
    settlementReportActionPath('confirm'),
    actorKey,
    signal,
    parsed.data,
  );
  return !result.ok ||
    (result.data.actorRole === 'admin' &&
      result.data.report?.id === parsed.data.reportId &&
      result.data.report.revision === parsed.data.expectedRevision &&
      result.data.report.status === 'confirmed')
    ? result
    : unavailable;
}
export async function exportSettlementReport(
  input: ConfirmInput,
  signal?: AbortSignal,
  actorKey?: string,
): Promise<SettlementReportResult<{ blob: Blob; filename: string }>> {
  const parsed = settlementReportConfirmSchema.safeParse(input);
  const actor = z.uuid().toLowerCase().safeParse(actorKey);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  if (!actor.success) return { ok: false, code: 'FORBIDDEN' };
  if (signal?.aborted) return unavailable;
  try {
    const timeout = AbortSignal.timeout(SETTLEMENT_REPORTS.requestTimeoutMs);
    const response = await fetch(
      settlementReportExportPath(
        parsed.data.reportId,
        parsed.data.expectedRevision,
      ),
      {
        method: 'GET',
        headers: { [SETTLEMENT_REPORTS.actorHeader]: actor.data },
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      },
    );
    const mime = response.headers.get('content-type')?.split(';')[0]?.trim();
    const bytes = await readBytes(response);
    if (!bytes || signal?.aborted || timeout.aborted) return unavailable;
    if (mime === 'application/json')
      return parseFailure(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
        response.status,
      );
    const filename = `settlement-${parsed.data.reportId}.xlsx`;
    if (
      response.status !== SETTLEMENT_REPORTS.httpOk ||
      mime !== SETTLEMENT_REPORTS.workbookContentType ||
      response.headers.get('content-disposition') !==
        `attachment; filename="${filename}"` ||
      response.headers.get('x-content-type-options') !== 'nosniff' ||
      !response.headers
        .get('cache-control')
        ?.split(',')
        .some((value) => value.trim() === 'no-store') ||
      bytes.byteLength === 0
    )
      return unavailable;
    return {
      ok: true,
      data: { blob: new Blob([bytes], { type: mime }), filename },
    };
  } catch {
    return unavailable;
  }
}
