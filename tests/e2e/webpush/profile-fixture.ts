import assert from 'node:assert/strict';

export const WEBPUSH_FIXTURE_CALL_NAME = '허구팬';

// Pure SQL construction only. The caller's guarded localSql owns execution in
// the disposable CI stack. This helper accepts no policy, query or destination.
export function webpushProfileFixtureSql(actorId: unknown, role: unknown) {
  assert.ok(typeof actorId === 'string');
  assert.match(
    actorId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  assert.ok(role === 'artist' || role === 'fan');
  // GoTrue creates an incomplete fan. Preserve that state so fan onboarding
  // must use the real font/name/consent/interest/install RPCs when requested.
  if (role === 'fan') return null;
  // Match the established owner-only local session fixtures: a completed
  // artist needs a valid, non-null calling name in the same row update. Do not
  // relax the database constraint or assert fictional consent/profile evidence.
  return `update public.profiles set role='artist',call_name='${WEBPUSH_FIXTURE_CALL_NAME}',onboarding_completed_at=clock_timestamp()
    where id='${actorId}' and exists(select 1 from auth.users where id='${actorId}' and email ~ '^webpush-e2e-[0-9a-f-]{36}@example[.]invalid$');`;
}

export function webpushCaptureScale(title: string) {
  const scale = /^(normal|large|xlarge)(?=[: ])/.exec(title)?.[1];
  return scale ?? null;
}
