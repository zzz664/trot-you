import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstallStatusCard } from '@/components/onboarding/InstallStatusCard';
import messages from '@/messages/ko.json';
const mocks = vi.hoisted(() => ({ state: vi.fn() }));
vi.mock('@/server/install/page', () => ({ getInstallStatus: mocks.state }));
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => {
    const pieces = key.split('.');
    let value: unknown = messages.install;
    for (const piece of pieces)
      value = (value as Record<string, unknown>)[piece];
    return String(value);
  },
}));
const data = {
  choice: 'skipped',
  acknowledgedAt: '2026-10-24T00:00:00Z',
  installationSelfReportedAt: null,
  completedAt: '2026-10-24T00:00:00Z',
};
beforeEach(() => {
  mocks.state.mockResolvedValue({ ok: true, data });
});
afterEach(cleanup);
async function show() {
  render(
    <NextIntlClientProvider locale="ko" messages={messages}>
      {await InstallStatusCard()}
    </NextIntlClientProvider>,
  );
}
describe('truthful home setup status', () => {
  it('shows persisted skip without claiming installation or paid access', async () => {
    await show();
    expect(
      screen.getByRole('heading', { name: messages.install.homeTitle }),
    ).toBeVisible();
    expect(
      screen.getByText(messages.install.guidanceLabels.skipped),
    ).toBeVisible();
    expect(screen.getByText(messages.install.homeNoPaidAccess)).toBeVisible();
    expect(
      screen.queryByText(messages.install.selfReportNotice),
    ).not.toBeInTheDocument();
  });
  it('labels an installation self-report as unverified', async () => {
    mocks.state.mockResolvedValue({
      ok: true,
      data: {
        ...data,
        choice: 'installed_self_reported',
        installationSelfReportedAt: data.acknowledgedAt,
      },
    });
    await show();
    expect(screen.getByText(messages.install.selfReportNotice)).toBeVisible();
  });
  it.each([
    { ok: false, code: 'PROFILE_REQUIRED' },
    { ok: false, code: 'UNAVAILABLE' },
    { ok: true, data: { ...data, choice: null } },
    { ok: true, data: { ...data, completedAt: null } },
  ])(
    'does not invent new setup evidence for legacy/unavailable state %j',
    async (state) => {
      mocks.state.mockResolvedValue(state);
      await show();
      expect(
        screen.getByRole('heading', { name: messages.install.homeStatusTitle }),
      ).toBeVisible();
      expect(screen.getByText(messages.install.homeUnavailable)).toBeVisible();
      expect(
        screen.queryByText(messages.install.homeDescription),
      ).not.toBeInTheDocument();
    },
  );
});
