import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import {
  parseRenewalTestRuntime,
  parseCancellationTestRuntime,
  RECONCILIATION_CI,
} from '../src/config/enrollment-test-runtime.ts';

// Enable only explicit requests against the isolated local CI application.
// Nothing here registers a webhook, schedules work or changes deployed config.
assert.equal(process.argv[2], 'environment');
const runtime = { ...process.env, NODE_ENV: 'development' };
assert.equal(parseRenewalTestRuntime(runtime).mode, 'ci');
assert.equal(parseCancellationTestRuntime(runtime).mode, 'ci');
assert.ok(!process.env.RECONCILIATION_LOCAL_E2E);
assert.ok(!process.env.RECONCILIATION_CRON_SECRET);
assert.ok(!process.env.PAYMENTS_RECONCILIATION_ENABLED);
assert.ok(process.env.GITHUB_ENV);
appendFileSync(
  process.env.GITHUB_ENV,
  [
    'RECONCILIATION_LOCAL_E2E=true',
    'PAYMENTS_RECONCILIATION_ENABLED=true',
    `RECONCILIATION_CRON_SECRET=${RECONCILIATION_CI.cronSecret}`,
    '',
  ].join('\n'),
);
