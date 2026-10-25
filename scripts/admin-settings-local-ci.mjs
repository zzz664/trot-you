import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { adminSettingsLocalEnvironment } from './admin-settings-local-config.mjs';

// Opt in only after auth-local-ci prepared the disposable local stack. This
// helper never accepts a project URL, credentials, SQL or an upload destination.
assert.equal(process.argv[2], 'environment');
const output = adminSettingsLocalEnvironment(process.env);
assert.ok(process.env.GITHUB_ENV);
appendFileSync(process.env.GITHUB_ENV, output);
