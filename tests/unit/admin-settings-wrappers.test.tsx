import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import SettingsPage from '@/app/admin/settings/page';
import PoliciesPage from '@/app/admin/settings/policies/page';
import ErrorBoundary from '@/app/admin/settings/error';
import LoadingPage from '@/app/admin/settings/loading';
import { settingsActor } from './admin-settings-fixtures';
const mock = vi.hoisted(() => ({
  identity: vi.fn(),
  screen: vi.fn(),
  policies: vi.fn(),
  error: vi.fn(),
  reset: vi.fn(),
}));
vi.mock('@/server/admin-settings/page', () => ({
  getAdminSettingsPage: mock.identity,
}));
vi.mock('@/components/admin-settings/AdminSettingsScreen', () => ({
  AdminSettingsScreen: (props: unknown) => {
    mock.screen(props);
    return <div data-testid="settings" />;
  },
}));
vi.mock('@/components/admin-settings/AdminSettingsPoliciesScreen', () => ({
  AdminSettingsPoliciesScreen: (props: unknown) => {
    mock.policies(props);
    return <div data-testid="policies" />;
  },
}));
vi.mock('@/components/admin-settings/AdminSettingsErrorScreen', () => ({
  AdminSettingsErrorScreen: ({
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
}));
vi.mock('@/components/admin-settings/AdminSettingsLoading', () => ({
  AdminSettingsLoading: () => <p role="status">loading</p>,
}));
beforeEach(() => {
  Object.values(mock).forEach((fn) => fn.mockReset());
  mock.identity.mockResolvedValue({ ok: true, data: { key: settingsActor } });
});
const query = (value: Record<string, string | string[] | undefined> = {}) =>
  Promise.resolve(value);
it.each([
  ['settings', SettingsPage],
  ['policies', PoliciesPage],
] as const)(
  'guards %s and passes no private snapshot or actor props in reusable RSC',
  async (name, page) => {
    const element = await page({ searchParams: query() });
    expect(element.key).toBe(settingsActor);
    render(element);
    expect(screen.getByTestId(name)).toBeInTheDocument();
    expect(
      name === 'settings' ? mock.screen : mock.policies,
    ).toHaveBeenCalledWith({});
    expect(mock.identity).toHaveBeenCalledWith();
  },
);
it.each([SettingsPage, PoliciesPage])(
  'rejects all unexpected query shapes after identity',
  async (page) => {
    render(await page({ searchParams: query({ unknown: ['one', 'two'] }) }));
    expect(screen.getByRole('alert')).toHaveTextContent('INVALID_INPUT');
    expect(mock.screen).not.toHaveBeenCalled();
    expect(mock.policies).not.toHaveBeenCalled();
  },
);
it.each([SettingsPage, PoliciesPage])(
  'identity failure has priority over query diagnostics',
  async (page) => {
    mock.identity.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    render(await page({ searchParams: query({ secret: 'untrusted' }) }));
    expect(screen.getByRole('alert')).toHaveTextContent('FORBIDDEN');
  },
);
it('error boundary uses safe generic error and supplied reset only', () => {
  render(<ErrorBoundary reset={mock.reset} />);
  expect(screen.getByRole('alert')).toHaveTextContent('UNAVAILABLE');
  fireEvent.click(screen.getByRole('alert'));
  expect(mock.reset).toHaveBeenCalledTimes(1);
});
it('loading route uses the shared understandable loading shell', () => {
  render(<LoadingPage />);
  expect(screen.getByRole('status')).toHaveTextContent('loading');
});
