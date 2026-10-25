import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import Page from '@/app/admin/subscriptions/page';
import ErrorBoundary from '@/app/admin/subscriptions/error';
import LoadingPage from '@/app/admin/subscriptions/loading';
import {
  subscriptionActor,
  subscriptionQuery,
} from './admin-subscriptions-fixtures';
const mock = vi.hoisted(() => ({
  identity: vi.fn(),
  screen: vi.fn(),
  error: vi.fn(),
  reset: vi.fn(),
}));
vi.mock('@/server/admin-subscriptions/page', () => ({
  getAdminSubscriptionPage: mock.identity,
}));
vi.mock('@/components/admin-subscriptions/AdminSubscriptionsScreen', () => ({
  AdminSubscriptionsScreen: (props: unknown) => {
    mock.screen(props);
    return <div data-testid="dashboard" />;
  },
}));
vi.mock(
  '@/components/admin-subscriptions/AdminSubscriptionsErrorScreen',
  () => ({
    AdminSubscriptionsErrorScreen: ({
      code,
      onRetry,
    }: {
      code: string;
      onRetry?: () => void;
    }) => {
      mock.error({ code, onRetry });
      return (
        <p role="alert" onClick={onRetry}>
          {code}
        </p>
      );
    },
  }),
);
vi.mock('@/components/admin-subscriptions/AdminSubscriptionsLoading', () => ({
  AdminSubscriptionsLoading: () => <p role="status">loading</p>,
}));
beforeEach(() => {
  Object.values(mock).forEach((fn) => fn.mockReset());
  mock.identity.mockResolvedValue({
    ok: true,
    data: { key: subscriptionActor },
  });
});
const searchParams = (
  value: Record<string, string | string[] | undefined> = {},
) => Promise.resolve(value);
it('passes only validated scope and URL, never aggregate snapshot or identity prop', async () => {
  const element = await Page({
    searchParams: searchParams({ from: '2026-10-01', to: '2026-10-25' }),
  });
  render(element);
  expect(mock.screen).toHaveBeenCalledWith({
    query: subscriptionQuery,
    path: '/admin/subscriptions?from=2026-10-01&to=2026-10-25',
  });
  expect(element.key).toBe(
    `${subscriptionActor}:/admin/subscriptions?from=2026-10-01&to=2026-10-25`,
  );
});
it('retains bare URL while resolving default dates', async () => {
  render(await Page({ searchParams: searchParams() }));
  expect(mock.screen).toHaveBeenCalledWith({
    query: expect.objectContaining({ page: 1, artist_id: null }),
    path: '/admin/subscriptions',
  });
});
it.each([
  { page: ['1', '2'] },
  { from: '2026-10-01' },
  { actor_id: 'forged' },
  { page: '0' },
  { from: '2026-10-25', to: '2026-10-01' },
])('rejects invalid page query %#', async (query) => {
  render(await Page({ searchParams: searchParams(query) }));
  expect(screen.getByRole('alert')).toHaveTextContent('INVALID_INPUT');
  expect(mock.screen).not.toHaveBeenCalled();
});
it('current authority failure takes priority over input diagnostics', async () => {
  mock.identity.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
  render(await Page({ searchParams: searchParams({ secret: 'x' }) }));
  expect(screen.getByRole('alert')).toHaveTextContent('FORBIDDEN');
});
it('error boundary only uses generic error and provided reset', () => {
  render(<ErrorBoundary reset={mock.reset} />);
  expect(screen.getByRole('alert')).toHaveTextContent('UNAVAILABLE');
  fireEvent.click(screen.getByRole('alert'));
  expect(mock.reset).toHaveBeenCalledOnce();
});
it('loading wrapper uses understandable loading shell', () => {
  render(<LoadingPage />);
  expect(screen.getByRole('status')).toHaveTextContent('loading');
});
