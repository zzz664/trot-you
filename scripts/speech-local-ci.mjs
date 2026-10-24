import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { speechLocalEnvironment } from './speech-local-config.mjs';

assert.equal(process.argv[2], 'environment');
const output = speechLocalEnvironment(process.env);
assert.ok(process.env.GITHUB_ENV);
appendFileSync(process.env.GITHUB_ENV, output);
