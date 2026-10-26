import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, expect, it, vi } from 'vitest';
import AdminPage from '@/app/admin/moderation/page';
import NoticesPage from '@/app/me/reports/page';
import { ModerationEntry } from '@/components/community-moderation/ModerationEntry';
import { ModerationErrorScreen } from '@/components/community-moderation/ModerationErrorScreen';
import { routes } from '@/config/routes';
import messages from '@/messages/ko.json';
import { moderationActor } from './community-moderation-fixtures';
const mock = vi.hoisted(() => ({
  page: vi.fn(),
  admin: vi.fn(),
  notices: vi.fn(),
  refresh: vi.fn(),
  translations: vi.fn(),
}));
vi.mock('@/server/community-moderation/page', () => ({
  getCommunityModerationPage: mock.page,
}));
vi.mock('@/components/community-moderation/AdminModerationScreen', () => ({
  AdminModerationScreen: (props: unknown) => {
    mock.admin(props);
    return <main>admin-shell</main>;
  },
}));
vi.mock('@/components/community-moderation/ModerationNoticesScreen', () => ({
  ModerationNoticesScreen: (props: unknown) => {
    mock.notices(props);
    return <main>notices-shell</main>;
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mock.refresh }),
}));
vi.mock('next-intl/server', () => ({ getTranslations: mock.translations }));
const copy = messages.communityModeration;
const wrapper = (children: React.ReactNode) => (
  <NextIntlClientProvider locale="ko" messages={messages}>
    {children}
  </NextIntlClientProvider>
);
beforeEach(() => {
  Object.values(mock).forEach((fn) => fn.mockReset());
  mock.page.mockResolvedValue({ ok: true, data: { key: moderationActor } });
  mock.translations.mockResolvedValue((key: keyof typeof copy) => copy[key]);
});
it('admin route resolves current admin authority and passes only actor identity to a client shell', async () => {
  render(await AdminPage({ searchParams: Promise.resolve({}) }));
  expect(mock.page).toHaveBeenCalledWith(true);
  expect(mock.admin).toHaveBeenCalledWith({ actorKey: moderationActor });
  expect(mock.notices).not.toHaveBeenCalled();
});
it('own-notices route resolves identity without requiring administrator role', async () => {
  render(await NoticesPage({ searchParams: Promise.resolve({}) }));
  expect(mock.page).toHaveBeenCalledWith();
  expect(mock.notices).toHaveBeenCalledWith({ actorKey: moderationActor });
});
it.each([
  { cursor: 'private' },
  { cursor: ['first', 'second'] },
  { unknown: '1' },
])(
  'rejects nonempty route query %j instead of transporting it to clients',
  async (query) => {
    render(wrapper(await AdminPage({ searchParams: Promise.resolve(query) })));
    expect(mock.admin).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      messages.communityPosts.errors.INVALID_INPUT,
    );
  },
);
it.each(['FORBIDDEN', 'SETUP_NOT_READY', 'UNAVAILABLE'] as const)(
  'admin route never renders a client shell after %s',
  async (code) => {
    mock.page.mockResolvedValueOnce({ ok: false, code });
    render(wrapper(await AdminPage({ searchParams: Promise.resolve({}) })));
    expect(mock.admin).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      messages.communityPosts.errors[code],
    );
  },
);
it.each(['FORBIDDEN', 'SETUP_NOT_READY', 'UNAVAILABLE'] as const)(
  'notices route never renders a client shell after %s',
  async (code) => {
    mock.page.mockResolvedValueOnce({ ok: false, code });
    render(wrapper(await NoticesPage({ searchParams: Promise.resolve({}) })));
    expect(mock.notices).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      messages.communityPosts.errors[code],
    );
  },
);
it('notices route rejects unknown and duplicate query data', async () => {
  render(
    wrapper(
      await NoticesPage({
        searchParams: Promise.resolve({ cursor: ['a', 'b'] }),
      }),
    ),
  );
  expect(mock.notices).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent(
    messages.communityPosts.errors.INVALID_INPUT,
  );
});
it.each([false, true])(
  'links the %s entry to the intended internal route without prefetching',
  async (admin) => {
    render(await ModerationEntry({ admin }));
    expect(mock.translations).toHaveBeenCalledWith('communityModeration');
    expect(
      screen.getByRole('link', {
        name: admin ? copy.adminEntry : copy.inboxEntry,
      }),
    ).toHaveAttribute(
      'href',
      admin ? routes.adminModeration : routes.communityReports,
    );
  },
);
it.each([false, true])(
  'error screen %s offers a read-only route refresh and safe home link',
  (admin) => {
    render(wrapper(<ModerationErrorScreen code="UNAVAILABLE" admin={admin} />));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      admin ? copy.adminTitle : copy.inboxTitle,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(mock.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      admin ? routes.admin : routes.home,
    );
  },
);
