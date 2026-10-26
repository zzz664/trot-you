import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import {
  SETTLEMENT_REPORTS,
  SETTLEMENT_REPORT_ERROR_STATUS,
  type SettlementReportMode,
  type SettlementReportResult,
} from '@/config/settlement-reports';
import { createAuthContext } from '@/server/auth/context';
import { readSession } from '@/server/services/auth/session';
import { isRestricted, isSameOriginPost } from '@/server/services/auth/access';
import { createSettlementReportsPort } from '@/server/db/settlement-reports';
import {
  readSettlementReport,
  calculateSettlementReport,
  confirmSettlementReport,
  readSettlementExport,
} from '@/server/services/settlement-reports/manage';
import { settlementWorkbookModel } from '@/server/services/settlement-reports/workbook';
import { createSettlementWorkbook } from '@/server/adapters/settlement-workbook';
import messages from '@/messages/ko.json';
import { settlementReportBody } from './security';
type Operation = 'read' | 'calculate' | 'confirm' | 'export';
export async function settlementReportsHttp(
  request: NextRequest,
  mode: SettlementReportMode,
  operation: Operation = 'read',
  reportId?: string,
) {
  const context = createAuthContext(request.cookies.getAll());
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    Vary: `Cookie, ${SETTLEMENT_REPORTS.actorHeader}`,
    'Cache-Control': 'private, no-store',
  };
  const respond = (result: SettlementReportResult<unknown>) =>
    context.apply(
      NextResponse.json(result, {
        status: result.ok
          ? SETTLEMENT_REPORTS.httpOk
          : SETTLEMENT_REPORT_ERROR_STATUS[result.code],
        headers,
      }),
    );
  try {
    if (!context.configuration || !context.client || !context.port)
      return respond({ ok: false, code: 'SETUP_NOT_READY' });
    const write = operation === 'calculate' || operation === 'confirm';
    if (
      request.method !== (write ? 'POST' : 'GET') ||
      (mode !== 'admin' && operation !== 'read')
    )
      return respond({ ok: false, code: 'INVALID_INPUT' });
    const params = request.nextUrl.searchParams;
    const keys =
      operation === 'read'
        ? ['artist_id', 'month']
        : operation === 'export'
          ? ['revision']
          : [];
    if (
      [...params.keys()].some(
        (key) => !keys.includes(key) || params.getAll(key).length !== 1,
      )
    )
      return respond({ ok: false, code: 'INVALID_INPUT' });
    if (
      write &&
      !isSameOriginPost(
        request.headers.get('origin'),
        context.configuration.appOrigin,
      )
    )
      return respond({ ok: false, code: 'FORBIDDEN' });
    const state = await readSession(context.port);
    if (state.status !== 'authenticated')
      return respond({
        ok: false,
        code:
          state.status === 'unavailable' ? 'UNAVAILABLE' : 'UNAUTHENTICATED',
      });
    if (
      isRestricted(state.profile) ||
      state.profile.role !== mode ||
      request.headers.get(SETTLEMENT_REPORTS.actorHeader) !== state.profile.id
    )
      return respond({ ok: false, code: 'FORBIDDEN' });
    const port = createSettlementReportsPort(context.client),
      actor = state.profile.id;
    if (operation === 'read')
      return respond(
        await readSettlementReport(
          port,
          { artistId: params.get('artist_id'), month: params.get('month') },
          actor,
          mode,
        ),
      );
    if (operation === 'calculate')
      return respond(
        await calculateSettlementReport(
          port,
          await settlementReportBody(request),
          actor,
        ),
      );
    if (operation === 'confirm')
      return respond(
        await confirmSettlementReport(
          port,
          await settlementReportBody(request),
          actor,
        ),
      );
    const result = await readSettlementExport(
      port,
      { reportId, expectedRevision: params.get('revision') },
      actor,
    );
    if (!result.ok) return respond(result);
    const labels = messages.settlementReports.exportLabels;
    const bytes = createSettlementWorkbook(
      settlementWorkbookModel(result.data),
      {
        ...labels,
        summaryHeaders: [labels.summaryHeaders[0]!, labels.summaryHeaders[1]!],
        eventHeaders: [
          labels.eventHeaders[0]!,
          labels.eventHeaders[1]!,
          labels.eventHeaders[2]!,
          labels.eventHeaders[3]!,
          labels.eventHeaders[4]!,
        ],
      },
    );
    return context.apply(
      new NextResponse(new Uint8Array(bytes), {
        status: SETTLEMENT_REPORTS.httpOk,
        headers: {
          ...headers,
          'Content-Type': SETTLEMENT_REPORTS.workbookContentType,
          'Content-Disposition': `attachment; filename="settlement-${result.data.report!.id}.xlsx"`,
          'Content-Length': String(bytes.byteLength),
          'Content-Security-Policy': "default-src 'none'; sandbox",
        },
      }),
    );
  } catch {
    return respond({ ok: false, code: 'UNAVAILABLE' });
  }
}
