import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// Only the legacy session fixtures need an already-completed account without
// product onboarding. Application roles cannot write this field anymore. This
// owner-only CI helper accepts no SQL/URL/key and never disables the protection.
export function setFictionalCompletion(
  actorId: string,
  completedAt: string | null,
) {
  assert.match(
    actorId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  if (completedAt !== null) {
    assert.match(completedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(new Date(completedAt).toISOString(), completedAt);
  }
  assert.equal(process.env.CI, 'true');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.AUTH_LOCAL_E2E, 'true');
  assert.equal(process.env.NEXT_PUBLIC_APP_URL, 'http://127.0.0.1:3100');
  assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:54321');
  assert.ok(!process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT);
  assert.equal(
    execFileSync('docker', ['context', 'show'], { encoding: 'utf8' }).trim(),
    'default',
  );
  assert.ok(
    execFileSync(
      'docker',
      [
        '--context',
        'default',
        'context',
        'inspect',
        '--format',
        '{{.Endpoints.docker.Host}}',
      ],
      { encoding: 'utf8' },
    )
      .trim()
      .startsWith('unix://'),
  );
  const value = completedAt === null ? 'null' : `'${completedAt}'::timestamptz`;
  execFileSync(
    'docker',
    [
      '--context',
      'default',
      'exec',
      '-i',
      'supabase_db_trot-you',
      'psql',
      '-X',
      '-q',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'postgres',
      '-d',
      'postgres',
    ],
    {
      input: `do $fixture$ declare changed integer; begin
        update public.profiles p set onboarding_completed_at=${value}
        where p.id='${actorId}'::uuid and exists (
          select 1 from auth.users u where u.id=p.id and
          u.email ~ '^auth-e2e-[0-9a-f-]{36}@example[.]invalid$');
        get diagnostics changed = row_count;
        if changed <> 1 then raise exception 'Fictional profile not found'; end if;
      end $fixture$;`,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
}
