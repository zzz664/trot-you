import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { parseEnrollmentTestRuntime } from '../src/config/enrollment-test-runtime.ts';

// Only grants the isolated development fixture capability. No policy approval,
// scheduler, live credentials, or deployment configuration is changed.
assert.equal(process.argv[2], 'environment');
assert.equal(
  parseEnrollmentTestRuntime({ ...process.env, NODE_ENV: 'development' }).mode,
  'ci',
);
assert.ok(!process.env.CANCELLATION_LOCAL_E2E);
assert.ok(!process.env.PAYMENTS_REFUNDS_ENABLED);
assert.ok(process.env.GITHUB_ENV);
appendFileSync(
  process.env.GITHUB_ENV,
  ['CANCELLATION_LOCAL_E2E=true', 'PAYMENTS_REFUNDS_ENABLED=true', ''].join(
    '\n',
  ),
);
