// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import ListPage from '@/app/schedules/page';
import DetailPage from '@/app/schedules/[id]/page';
import { scheduleId } from './schedules-fixtures';
const mocks = vi.hoisted(() => ({ page: vi.fn() }));
vi.mock('@/server/schedules/page', () => ({ getSchedulePage: mocks.page }));
beforeEach(() => vi.resetAllMocks());
it.each([true, false])(
  'list page passes presentation-only notice hint %s',
  async (canConfigureNotices) => {
    mocks.page.mockResolvedValue({
      ok: true,
      data: { key: scheduleId, canConfigureNotices },
    });
    const element = await ListPage({
      searchParams: Promise.resolve({ month: '2026-10' }),
    });
    expect(element.props.canConfigureNotices).toBe(canConfigureNotices);
    expect(element.props.actorKey).toBe(scheduleId);
  },
);
it.each([true, false])(
  'detail page passes presentation-only notice hint %s',
  async (canConfigureNotices) => {
    mocks.page.mockResolvedValue({
      ok: true,
      data: { key: scheduleId, canConfigureNotices },
    });
    const element = await DetailPage({
      params: Promise.resolve({ id: scheduleId }),
      searchParams: Promise.resolve({ month: '2026-10' }),
    });
    expect(element.props.canConfigureNotices).toBe(canConfigureNotices);
    expect(element.props.actorKey).toBe(scheduleId);
  },
);
