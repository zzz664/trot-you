import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dispatchLocalEnvironment } from './dispatch-local-config.mjs';

// Opt in only after auth-local-ci prepared the disposable local stack. This
// helper never accepts a project URL, credentials, SQL or an upload destination.
assert.equal(process.argv[2], 'environment');
const secret = randomBytes(32).toString('base64url');
const output = dispatchLocalEnvironment(process.env, secret);
assert.ok(process.env.GITHUB_ENV);
process.stdout.write(`::add-mask::${secret}\n`);
appendFileSync(process.env.GITHUB_ENV, output);
