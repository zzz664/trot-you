import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import {
  parseEnrollmentTestRuntime,
  RENEWAL_CI,
} from '../src/config/enrollment-test-runtime.ts';

// This is only explicit isolated CI route invocation, never scheduler setup.
assert.equal(process.argv[2], 'environment');
assert.equal(
  parseEnrollmentTestRuntime({ ...process.env, NODE_ENV: 'development' }).mode,
  'ci',
);
assert.ok(!process.env.RENEWAL_CRON_SECRET);
assert.ok(!process.env.PAYMENTS_RENEWALS_ENABLED);
assert.ok(process.env.GITHUB_ENV);
appendFileSync(
  process.env.GITHUB_ENV,
  [
    'RENEWAL_LOCAL_E2E=true',
    'PAYMENTS_RENEWALS_ENABLED=true',
    `RENEWAL_CRON_SECRET=${RENEWAL_CI.cronSecret}`,
    '',
  ].join('\n'),
);
