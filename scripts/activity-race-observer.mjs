import assert from 'node:assert/strict';

// Backend PIDs identify the actual sessions. application_name is only a human
// label and PostgreSQL may truncate it, so never use that label as a lock key.
export function activityLockQuery(waitingPid, blockingPid) {
  for (const pid of [waitingPid, blockingPid])
    assert.ok(Number.isSafeInteger(pid) && pid > 0, 'Invalid backend PID.');
  assert.notEqual(waitingPid, blockingPid, 'Distinct sessions are required.');
  return `select exists (
    select 1 from pg_stat_activity waiting
    where waiting.pid = ${waitingPid}
      and waiting.wait_event_type = 'Lock'
      and ${blockingPid} = any(pg_blocking_pids(waiting.pid))
  );`;
}
