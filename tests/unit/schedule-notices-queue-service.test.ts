import { describe, expect, it, vi } from 'vitest';
import { SCHEDULE_NOTICE } from '@/config/schedule-notices';
import {
  createDueScheduleNotices,
  type ScheduleNoticeQueueDependencies,
} from '@/server/services/schedule-notices/create-due';
const id = '00000000-0000-4000-8000-000000000001';
function queue(): ScheduleNoticeQueueDependencies {
  return {
    now: () => 0,
    port: {
      candidates: vi.fn(async () => ({ ok: true as const, data: [id] })),
      create: vi.fn(async () => ({
        ok: true as const,
        data: { created: true, pushJobs: 2 },
      })),
    },
  };
}
describe('bounded next-day schedule queue, never delivery receipt', () => {
  it('counts selected schedule and queued jobs separately', async () => {
    const deps = queue();
    expect(await createDueScheduleNotices(deps)).toEqual({
      ok: true as const,
      data: {
        examined: 1,
        created: 1,
        skipped: 0,
        failed: 0,
        pushJobsQueued: 2,
        hasMore: false,
      },
    });
    expect(deps.port.create).toHaveBeenCalledExactlyOnceWith(id);
  });
  it('handles cancellation between selection and creation as skipped', async () => {
    const deps = queue();
    vi.mocked(deps.port.create).mockResolvedValue({
      ok: true as const,
      data: { created: false, pushJobs: 0 },
    });
    expect(await createDueScheduleNotices(deps)).toMatchObject({
      ok: true as const,
      data: { created: 0, skipped: 1, pushJobsQueued: 0 },
    });
  });
  it('does not silently retry an ambiguous commit response', async () => {
    const deps = queue();
    vi.mocked(deps.port.create).mockRejectedValue(new Error('connection'));
    expect(await createDueScheduleNotices(deps)).toMatchObject({
      ok: true as const,
      data: { created: 0, failed: 1 },
    });
    expect(deps.port.create).toHaveBeenCalledOnce();
  });
  it('stops at execution budget before starting a mutation', async () => {
    const deps = queue();
    let time = 0;
    deps.now = () => time;
    vi.mocked(deps.port.candidates).mockImplementation(async () => {
      time = SCHEDULE_NOTICE.workerBudgetMs;
      return { ok: true as const, data: [id] };
    });
    expect(await createDueScheduleNotices(deps)).toMatchObject({
      ok: true as const,
      data: { examined: 0, hasMore: true },
    });
    expect(deps.port.create).not.toHaveBeenCalled();
  });
  it('rejects malformed duplicate candidate batch', async () => {
    const deps = queue();
    vi.mocked(deps.port.candidates).mockResolvedValue({
      ok: true as const,
      data: [id, id],
    });
    expect(await createDueScheduleNotices(deps)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(deps.port.create).not.toHaveBeenCalled();
  });
  it('caps work and stops repeated fair scan pages without another create', async () => {
    const deps = queue();
    const ids = Array.from(
      { length: 20 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    vi.mocked(deps.port.candidates).mockResolvedValue({
      ok: true as const,
      data: ids,
    });
    expect(await createDueScheduleNotices(deps)).toMatchObject({
      ok: true as const,
      data: { examined: 20, created: 20, hasMore: true },
    });
    expect(deps.port.create).toHaveBeenCalledTimes(20);
  });
});

it('reports absent business approval distinctly without implying an empty ready queue', async () => {
  const deps = queue();
  vi.mocked(deps.port.candidates).mockResolvedValue({
    ok: false,
    code: 'SETUP_NOT_READY',
  });
  expect(await createDueScheduleNotices(deps)).toEqual({
    ok: false,
    code: 'SETUP_NOT_READY',
  });
  expect(deps.port.create).not.toHaveBeenCalled();
});
it('bounded pages report backlog truth without replaying processed events', async () => {
  const deps = queue();
  let serial = 0;
  vi.mocked(deps.port.candidates).mockImplementation(async (limit) => ({
    ok: true,
    data: Array.from(
      { length: limit },
      () => `00000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`,
    ),
  }));
  const result = await createDueScheduleNotices(deps);
  expect(result).toMatchObject({
    ok: true,
    data: {
      examined: SCHEDULE_NOTICE.workerLimit,
      created: SCHEDULE_NOTICE.workerLimit,
      hasMore: true,
    },
  });
  expect(deps.port.candidates).toHaveBeenCalledTimes(
    SCHEDULE_NOTICE.workerPages,
  );
  expect(deps.port.create).toHaveBeenCalledTimes(SCHEDULE_NOTICE.workerLimit);
});
