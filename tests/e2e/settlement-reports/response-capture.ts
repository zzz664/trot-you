import assert from 'node:assert/strict';
import type { Page } from '@playwright/test';
import { SETTLEMENT_REPORTS } from '../../../src/config/settlement-reports';

export type ReportResponseExpectation = {
  url: string;
  method: 'GET' | 'POST';
  actorId: string;
  status: number;
  body?: unknown;
};
export type CapturedReportResponse = {
  status(): number;
  headers(): Record<string, string>;
  body(): Promise<Buffer>;
  json(): Promise<unknown>;
};
type CaptureOutcome =
  | { ok: true; response: CapturedReportResponse }
  | { ok: false; error: unknown };

// Chromium Response bodies can disappear on cancellation/history restoration.
// Observe the exact browser-initiated request's REAL upstream bytes before
// forwarding them. No replay, mock body, redirect, retry or second request.
export async function captureReportResponse(
  page: Pick<Page, 'route'>,
  expected: ReportResponseExpectation,
) {
  let settle!: (outcome: CaptureOutcome) => void;
  const completed = new Promise<CaptureOutcome>((resolve) => {
    settle = resolve;
  });
  await page.route(
    (url) => url.href === expected.url,
    async (route) => {
      let terminalActionStarted = false;
      try {
        const request = route.request();
        assert.equal(request.url(), expected.url, 'Exact report URL required.');
        assert.equal(
          request.method(),
          expected.method,
          'Report method changed.',
        );
        assert.equal(
          request.headers()[SETTLEMENT_REPORTS.actorHeader.toLowerCase()],
          expected.actorId,
          'Current report actor header required.',
        );
        if (expected.method === 'POST')
          assert.deepEqual(request.postDataJSON(), expected.body);
        const upstream = await route.fetch({ maxRedirects: 0, maxRetries: 0 });
        const status = upstream.status();
        const headers = { ...upstream.headers() };
        const body = Buffer.from(await upstream.body());
        assert.equal(status, expected.status, 'Report HTTP status changed.');
        assert.ok(
          headers['cache-control']
            ?.split(',')
            .some((part) => part.trim() === 'no-store'),
          'Report response must not be cached.',
        );
        assert.equal(headers['x-content-type-options'], 'nosniff');
        assert.ok(
          body.length > 0 && body.length <= SETTLEMENT_REPORTS.responseMaxBytes,
        );
        const response: CapturedReportResponse = {
          status: () => status,
          headers: () => ({ ...headers }),
          body: async () => Buffer.from(body),
          json: async () => JSON.parse(body.toString('utf8')) as unknown,
        };
        terminalActionStarted = true;
        await route.fulfill({ response: upstream, body });
        settle({ ok: true, response });
      } catch (error) {
        let failure = error;
        if (!terminalActionStarted) {
          try {
            await route.abort();
          } catch (abortError) {
            failure = new AggregateError(
              [error, abortError],
              'Report response capture and cleanup failed.',
            );
          }
        }
        // Resolve an explicit outcome so a failure before navigation completes
        // cannot become an unhandled rejection or a swallowed test assertion.
        settle({ ok: false, error: failure });
      }
    },
    { times: 1 },
  );
  return {
    async result() {
      const outcome = await completed;
      if (!outcome.ok) throw outcome.error;
      return outcome.response;
    },
  };
}
