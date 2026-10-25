import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SessionPage } from '@/components/auth/SessionPage';
import { routes } from '@/config/routes';
const mocks = vi.hoisted(() => ({ guard: vi.fn() }));
vi.mock('@/server/auth/page', () => ({ guardPage: mocks.guard }));
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock('@/components/billing-notices/BillingNoticeEntry', () => ({
  BillingNoticeEntry: () => <div data-testid="billing-notice-entry" />,
}));
vi.mock('@/components/webpush/WebPushEntry', () => ({
  WebPushEntry: () => null,
}));
vi.mock('@/components/onboarding/InstallStatusCard', () => ({
  InstallStatusCard: () => null,
}));
vi.mock('@/components/subscription/SubscriptionEntry', () => ({
  SubscriptionEntry: () => null,
}));
vi.mock('@/components/admin/refunds/RefundEntry', () => ({
  RefundEntry: () => null,
}));
vi.mock('@/components/admin/reconciliation/ReconciliationEntry', () => ({
  ReconciliationEntry: () => null,
}));
vi.mock('@/components/artists/ArtistCatalogEntry', () => ({
  ArtistCatalogEntry: () => null,
}));
vi.mock('@/components/schedules/ScheduleEntry', () => ({
  ScheduleEntry: () => null,
}));
vi.mock('@/components/auth/AuthForm', () => ({ AuthForm: () => null }));
afterEach(cleanup);
beforeEach(() => {
  mocks.guard.mockReset();
  mocks.guard.mockResolvedValue({
    status: 'authenticated',
    profile: { role: 'fan' },
  });
});
it('adds the billing entry to the eligible fan home only', async () => {
  render(await SessionPage({ path: routes.home }));
  expect(screen.getByTestId('billing-notice-entry')).toBeInTheDocument();
});
it.each([
  ['admin', routes.admin],
  ['artist', routes.artist],
  ['fan', routes.restricted],
  ['fan', routes.onboarding],
])(
  'does not add an unrelated or inaccessible billing entry to %s %s',
  async (role, path) => {
    mocks.guard.mockResolvedValue({
      status: 'authenticated',
      profile: { role },
    });
    render(await SessionPage({ path }));
    expect(
      screen.queryByTestId('billing-notice-entry'),
    ).not.toBeInTheDocument();
  },
);
