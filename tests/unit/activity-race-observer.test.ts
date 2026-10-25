// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { activityLockQuery } from '../../scripts/activity-race-observer.mjs';

describe('activity real-session lock observation', () => {
  it('uses backend PIDs independent of PostgreSQL-truncated labels', () => {
    const label =
      'artist-reply-activity-concurrency-restriction-before-read-second';
    expect(Buffer.byteLength(label)).toBe(64);
    const query = activityLockQuery(101, 202);
    expect(query).toContain('waiting.pid = 101');
    expect(query).toContain('202 = any(pg_blocking_pids(waiting.pid))');
    expect(query).toContain("waiting.wait_event_type = 'Lock'");
    expect(query).not.toContain('application_name');
    expect(query).not.toContain(label);
  });
  it.each([
    null,
    undefined,
    '',
    '101',
    0,
    -1,
    1.5,
    Infinity,
    NaN,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects invalid backend identity %s', (pid) => {
    expect(() => activityLockQuery(pid, 202)).toThrow();
    expect(() => activityLockQuery(101, pid)).toThrow();
  });
  it('rejects identical sessions', () => {
    expect(() => activityLockQuery(101, 101)).toThrow();
  });
  it('captures actual session PIDs and wires the observer helper', () => {
    const source = readFileSync(
      new URL(
        '../../scripts/test-artist-reply-activity-concurrency.mjs',
        import.meta.url,
      ),
      'utf8',
    );
    expect(source).toContain(
      "this.pid = Number(await this.query('select pg_backend_pid();'))",
    );
    expect(source).toContain('activityLockQuery(waiting.pid, blocking.pid)');
    expect(source).not.toContain(
      "waiting.application_name = '${waiting.label}'",
    );
  });
});
