import 'server-only';
import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import type { ClientRequest } from 'node:http';
import { WEBPUSH_PROTOCOL as P } from '@/config/webpush-protocol';
import { isPublicWebPushAddress } from './address';
import { isAllowedWebPushEndpoint } from './validation';
import type { WebPushHttpRequest, WebPushTransportResult } from './types';

/** No redirects, proxy environment, cookie jar, raw response body or retries. */
export function sendPinnedWebPushRequest(
  input: WebPushHttpRequest,
): Promise<WebPushTransportResult> {
  if (
    !isAllowedWebPushEndpoint(input.endpoint) ||
    !Number.isInteger(input.timeoutMs) ||
    input.timeoutMs < P.timeoutMinMs ||
    input.timeoutMs > P.timeoutMaxMs
  )
    return Promise.resolve({ kind: 'not_sent' });
  return new Promise((resolve) => {
    const deadline = Date.now() + input.timeoutMs;
    let settled = false;
    let request: ClientRequest | undefined;
    const finish = (result: WebPushTransportResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    // Total deadline includes DNS, TCP, TLS, request and response headers.
    // DNS cannot be canceled through lookup(), but its late result cannot send.
    const timer = setTimeout(() => {
      finish({ kind: request ? 'unknown' : 'not_sent' });
      request?.destroy();
    }, input.timeoutMs);
    const endpoint = new URL(input.endpoint);
    void lookup(endpoint.hostname, { all: true, verbatim: true })
      .then((addresses) => {
        if (settled) return;
        // A paused event loop may resume a promise microtask before its timer.
        // Check elapsed wall time too, so late DNS cannot slip past the deadline.
        if (Date.now() >= deadline) {
          finish({ kind: 'not_sent' });
          return;
        }
        const pinned = addresses[0];
        if (
          !pinned ||
          addresses.some((item) => !isPublicWebPushAddress(item.address))
        ) {
          finish({ kind: 'not_sent' });
          return;
        }
        request = httpsRequest(
          endpoint,
          {
            method: 'POST',
            headers: input.headers,
            // A new direct socket avoids connection reuse across DNS changes.
            agent: false,
            servername: endpoint.hostname,
            rejectUnauthorized: true,
            maxHeaderSize: P.responseHeaderMaxBytes,
            family: pinned.family,
            lookup(_hostname, _options, callback) {
              callback(null, pinned.address, pinned.family);
            },
          },
          (response) => {
            const status = response.statusCode;
            const retryAfter = response.headers['retry-after'];
            if (status === undefined) finish({ kind: 'unknown' });
            else
              finish({
                kind: 'response',
                status,
                ...(typeof retryAfter === 'string' ? { retryAfter } : {}),
              });
            // HTTP status is sufficient. Never retain provider content or let
            // a response stream consume unbounded memory/time.
            response.destroy();
          },
        );
        request.once('error', () => finish({ kind: 'unknown' }));
        request.end(input.body);
      })
      .catch(() => finish({ kind: request ? 'unknown' : 'not_sent' }));
  });
}
