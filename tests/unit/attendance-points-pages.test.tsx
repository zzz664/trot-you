import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, expect, it, vi } from 'vitest';
import Page from '@/app/points/page';
import { AttendancePointsEntry } from '@/components/attendance-points/AttendancePointsEntry';
import { AttendancePointsErrorScreen } from '@/components/attendance-points/AttendancePointsErrorScreen';
import { routes } from '@/config/routes';
import messages from '@/messages/ko.json';
const mock = vi.hoisted(() => ({
  page: vi.fn(),
  screen: vi.fn(),
  refresh: vi.fn(),
  translations: vi.fn(),
}));
vi.mock('@/server/attendance-points/page', () => ({
  getAttendancePointsPage: mock.page,
}));
vi.mock('@/components/attendance-points/AttendancePointsScreen', () => ({
  AttendancePointsScreen: (props: unknown) => {
    mock.screen(props);
    return <main>points-shell</main>;
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mock.refresh }),
}));
vi.mock('next-intl/server', () => ({ getTranslations: mock.translations }));
const actor = '3b000000-0000-4000-8000-000000000001';
const copy = messages.attendancePoints;
const wrapper = (child: React.ReactNode) => (
  <NextIntlClientProvider locale="ko" messages={messages}>
    {child}
  </NextIntlClientProvider>
);
beforeEach(() => {
  Object.values(mock).forEach((fn) => fn.mockReset());
  mock.page.mockResolvedValue({ ok: true, data: { key: actor } });
  mock.translations.mockResolvedValue((key: keyof typeof copy) => copy[key]);
});
it('transports identity only to the client shell rather than balances or private history in RSC', async () => {
  render(await Page({ searchParams: Promise.resolve({}) }));
  expect(mock.page).toHaveBeenCalledWith();
  expect(mock.screen).toHaveBeenCalledWith({ actorKey: actor });
});
it.each([
  { cursor: 'private' },
  { cursor: ['a', 'b'] },
  { user_id: actor },
  { unknown: '1' },
])(
  'rejects page query %j instead of letting it select a private account or page',
  async (query) => {
    render(wrapper(await Page({ searchParams: Promise.resolve(query) })));
    expect(mock.screen).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      copy.errors.INVALID_INPUT,
    );
  },
);
it.each([
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'UNAVAILABLE',
  'SETUP_NOT_READY',
] as const)('never mounts the client page after %s', async (code) => {
  mock.page.mockResolvedValueOnce({ ok: false, code });
  render(wrapper(await Page({ searchParams: Promise.resolve({}) })));
  expect(mock.screen).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent(copy.errors[code]);
});
it('links the private entry to points without preloading private data', async () => {
  render(await AttendancePointsEntry());
  expect(mock.translations).toHaveBeenCalledWith('attendancePoints');
  expect(screen.getByRole('link', { name: copy.entryOpen })).toHaveAttribute(
    'href',
    routes.points,
  );
  expect(screen.getByRole('heading')).toHaveTextContent(copy.entryTitle);
});
it.each([
  'INVALID_INPUT',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'CONFLICT',
  'BALANCE_LIMIT',
  'SETUP_NOT_READY',
  'UNAVAILABLE',
] as const)(
  'error screen %s offers only route refresh and home navigation',
  (code) => {
    render(wrapper(<AttendancePointsErrorScreen code={code} />));
    expect(screen.getByRole('alert')).toHaveTextContent(copy.errors[code]);
    fireEvent.click(screen.getByRole('button'));
    expect(mock.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link')).toHaveAttribute('href', routes.home);
  },
);
