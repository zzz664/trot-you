import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { useEffect, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnrollmentLauncher } from '@/components/checkout/EnrollmentLauncher';
import { EnrollmentStatusScreen } from '@/components/checkout/EnrollmentStatusScreen';
import {
  ENROLLMENT_STATUS_POLL_MS,
  type EnrollmentStatus,
} from '@/config/enrollment';
import type { CheckoutIntent } from '@/config/checkout';
import { TOSS_BILLING_SDK_URL } from '@/config/payment-preparation';
import { artistPreviewPath, enrollmentCompletePath } from '@/config/routes';
import messages from '@/messages/ko.json';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  confirm: vi.fn(),
  cancel: vi.fn(),
  reconcile: vi.fn(),
  start: vi.fn(),
  open: vi.fn(),
  router: { replace: vi.fn(), refresh: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useRouter: () => mocks.router }));
vi.mock('@/client/enrollment', () => ({
  readEnrollment: mocks.read,
  confirmEnrollment: mocks.confirm,
  cancelEnrollment: mocks.cancel,
  reconcileEnrollment: mocks.reconcile,
  startEnrollment: mocks.start,
  openTossEnrollment: mocks.open,
  chooseKakaoEnrollmentRedirect: vi.fn(),
}));
vi.mock('next/script', () => ({
  default: function MockScript({ onReady }: { onReady: () => void }) {
    useEffect(() => onReady(), [onReady]);
    return null;
  },
}));
const copy = messages.enrollment;
const status: EnrollmentStatus = {
  sessionId: 'ec3f74d6-0745-4a1f-ad46-42eac6fb9713',
  status: 'awaiting_confirmation',
  provider: 'toss_card_billing',
  environment: 'test',
  artist: { slug: 'fictional-star', name: '허구 가수' },
  policy: {
    version: 'ae3f06df-e2b1-4c57-838b-c472bc460ab7',
    billingPeriodCalendar: 'utc_monthly_clamped',
    paymentTaxBasis: 'taxable_krw',
    title: '허구 승인 약관',
    body: '공개 표시 가능한 허구 약관 전문입니다.',
  },
  amountKrw: 1000,
  regularPriceKrw: 6500,
  expiresAt: '2099-10-24T13:30:00Z',
  canConfirm: true,
  canCancel: true,
  canReconcile: false,
};
const intent: CheckoutIntent = {
  id: status.sessionId,
  status: 'pending_intent',
  provider: status.provider,
  expiresAt: status.expiresAt,
  initialPriceKrw: status.amountKrw,
  regularPriceKrw: status.regularPriceKrw,
  introEligible: true,
};
function subject(child: ReactNode) {
  return (
    <NextIntlClientProvider locale="ko" messages={messages} timeZone="UTC">
      {child}
    </NextIntlClientProvider>
  );
}
const renderStatus = () =>
  render(subject(<EnrollmentStatusScreen sessionId={status.sessionId} />));
const confirmButton = () =>
  screen.getByRole('button', {
    name: copy.confirm.replace('{price}', '1,000'),
  });
const consent = () =>
  screen.getByRole('checkbox', {
    name: copy.chargeConsent.replace('{price}', '1,000'),
  });
async function loaded() {
  await screen.findByText(copy.statuses.awaiting_confirmation);
}
beforeEach(() => {
  mocks.read.mockResolvedValue({ ok: true, data: status });
  mocks.confirm.mockResolvedValue({
    ok: true,
    data: {
      ...status,
      status: 'succeeded',
      canConfirm: false,
      canCancel: false,
    },
  });
  mocks.cancel.mockResolvedValue({
    ok: true,
    data: {
      ...status,
      status: 'canceled',
      canConfirm: false,
      canCancel: false,
    },
  });
  mocks.reconcile.mockResolvedValue({
    ok: true,
    data: { ...status, status: 'unknown', canConfirm: false, canCancel: false },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe('first-charge explicit consent UI', () => {
  it('loads read-only status and requires a separate unchecked amount-bound consent', async () => {
    renderStatus();
    await loaded();
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith({
      sessionId: status.sessionId,
    });
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(consent()).not.toBeChecked();
    expect(confirmButton()).toBeDisabled();
    expect(screen.getByText(status.policy.body)).toBeVisible();
    expect(screen.getByText(copy.environments.test)).toBeVisible();
    await userEvent.click(consent());
    await userEvent.click(confirmButton());
    expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith({
      sessionId: status.sessionId,
      policyVersion: status.policy.version,
      amountKrw: 1000,
      accepted: true,
    });
    await screen.findByText(copy.statuses.succeeded);
  });
  it.each(['utc_monthly_clamped', 'seoul_monthly_clamped'] as const)(
    'shows the exact %s calendar and VAT-included taxable basis before consent',
    async (billingPeriodCalendar) => {
      mocks.read.mockResolvedValue({
        ok: true,
        data: {
          ...status,
          policy: { ...status.policy, billingPeriodCalendar },
        },
      });
      renderStatus();
      await loaded();
      expect(
        screen.getByText(copy.calendars[billingPeriodCalendar]),
      ).toBeVisible();
      expect(screen.getByText(copy.taxBases.taxable_krw)).toBeVisible();
      expect(consent()).not.toBeChecked();
      expect(mocks.confirm).not.toHaveBeenCalled();
    },
  );
  it('clears consent when refreshed calendar metadata differs, even at the same version', async () => {
    renderStatus();
    await loaded();
    await userEvent.click(consent());
    mocks.read.mockResolvedValue({
      ok: true,
      data: {
        ...status,
        policy: {
          ...status.policy,
          billingPeriodCalendar: 'seoul_monthly_clamped',
        },
      },
    });
    await userEvent.click(screen.getByRole('button', { name: copy.refresh }));
    await screen.findByText(copy.calendars.seoul_monthly_clamped);
    expect(consent()).not.toBeChecked();
    expect(confirmButton()).toBeDisabled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it('does not leave stale consent actionable after an invalid metadata/status refresh', async () => {
    renderStatus();
    await loaded();
    await userEvent.click(consent());
    mocks.read.mockResolvedValue({ ok: false, code: 'UNAVAILABLE' });
    await userEvent.click(screen.getByRole('button', { name: copy.refresh }));
    await screen.findByRole('alert');
    expect(consent()).not.toBeChecked();
    expect(consent()).toBeDisabled();
    expect(confirmButton()).toBeDisabled();
    expect(mocks.confirm).not.toHaveBeenCalled();
    mocks.read.mockResolvedValue({ ok: true, data: status });
    await userEvent.click(screen.getByRole('button', { name: copy.refresh }));
    expect(consent()).not.toBeChecked();
    expect(consent()).toBeEnabled();
    expect(confirmButton()).toBeDisabled();
  });
  it('synchronous repeated confirmation clicks create only one operation', async () => {
    mocks.confirm.mockReturnValue(new Promise(() => {}));
    renderStatus();
    await loaded();
    await userEvent.click(consent());
    const button = confirmButton();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', { name: copy.confirming }),
    ).toBeDisabled();
  });
  it('lost confirmation response does not allow retry until a read-only status check', async () => {
    mocks.confirm.mockResolvedValue({ ok: false, code: 'UNAVAILABLE' });
    renderStatus();
    await loaded();
    await userEvent.click(consent());
    await userEvent.click(confirmButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      messages.checkout.errors.UNAVAILABLE,
    );
    expect(confirmButton()).toBeDisabled();
    expect(consent()).not.toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: copy.refresh }));
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
  });
  it('policy conflict clears consent and does not retry a charge', async () => {
    mocks.confirm.mockResolvedValue({ ok: false, code: 'POLICY_CHANGED' });
    renderStatus();
    await loaded();
    await userEvent.click(consent());
    await userEvent.click(confirmButton());
    await screen.findByText(messages.checkout.errors.POLICY_CHANGED);
    expect(consent()).not.toBeChecked();
    expect(confirmButton()).toBeDisabled();
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
  });
  it('expired confirmation is refused before POST and re-reads the server', async () => {
    mocks.read.mockResolvedValue({
      ok: true,
      data: { ...status, expiresAt: '2000-01-01T00:00:00Z' },
    });
    renderStatus();
    await loaded();
    await userEvent.click(consent());
    await userEvent.click(confirmButton());
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.read.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
  it('dismissal navigates without cancellation or confirmation', async () => {
    renderStatus();
    await loaded();
    await userEvent.click(screen.getByRole('button', { name: copy.dismiss }));
    expect(mocks.router.replace).toHaveBeenCalledWith(
      artistPreviewPath(status.artist.slug),
    );
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it('explicit cancellation is separate and terminal status hides charge controls', async () => {
    renderStatus();
    await loaded();
    await userEvent.click(screen.getByRole('button', { name: copy.cancel }));
    await screen.findByText(copy.statuses.canceled);
    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith({
      sessionId: status.sessionId,
    });
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it('Back wins over a late result', async () => {
    let release: (value: unknown) => void = () => {};
    mocks.confirm.mockReturnValue(
      new Promise((resolve) => (release = resolve)),
    );
    renderStatus();
    await loaded();
    await userEvent.click(consent());
    await userEvent.click(confirmButton());
    await userEvent.click(screen.getByRole('button', { name: copy.dismiss }));
    await act(async () =>
      release({ ok: true, data: { ...status, status: 'succeeded' } }),
    );
    expect(screen.queryByText(copy.statuses.succeeded)).not.toBeInTheDocument();
  });
  it.each(['unknown', 'manual_review'] as const)(
    '%s does not auto-confirm or auto-reconcile',
    async (state) => {
      mocks.read.mockResolvedValue({
        ok: true,
        data: {
          ...status,
          status: state,
          canConfirm: false,
          canCancel: false,
          canReconcile: state === 'unknown',
        },
      });
      renderStatus();
      await screen.findByText(copy.statuses[state]);
      expect(mocks.confirm).not.toHaveBeenCalled();
      expect(mocks.reconcile).not.toHaveBeenCalled();
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
      if (state === 'unknown') {
        await userEvent.click(
          screen.getByRole('button', { name: copy.reconcile }),
        );
        expect(mocks.reconcile).toHaveBeenCalledExactlyOnceWith({
          sessionId: status.sessionId,
        });
      }
    },
  );
  it('authorization expiry refreshes only status and clears consent', async () => {
    vi.useFakeTimers();
    const expiresAt = new Date(Date.now() + 1000).toISOString();
    mocks.read
      .mockResolvedValueOnce({ ok: true, data: { ...status, expiresAt } })
      .mockResolvedValue({
        ok: true,
        data: {
          ...status,
          status: 'expired',
          expiresAt,
          canConfirm: false,
          canCancel: true,
        },
      });
    renderStatus();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    fireEvent.click(consent());
    expect(consent()).toBeChecked();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByText(copy.statuses.expired)).toBeVisible();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it('processing polling uses only the status read endpoint', async () => {
    vi.useFakeTimers();
    mocks.read.mockResolvedValue({
      ok: true,
      data: {
        ...status,
        status: 'processing',
        canConfirm: false,
        canCancel: false,
      },
    });
    renderStatus();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mocks.read).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ENROLLMENT_STATUS_POLL_MS);
    });
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
  it('wrong-user status never shows prior public policy or mutation controls', async () => {
    mocks.read.mockResolvedValue({ ok: false, code: 'NOT_FOUND' });
    renderStatus();
    await screen.findByText(messages.checkout.errors.NOT_FOUND);
    expect(screen.queryByText(status.policy.body)).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});

describe('provider launch remains explicit', () => {
  const launch = {
    kind: 'toss_billing_auth',
    sdkUrl: TOSS_BILLING_SDK_URL,
    clientKey: 'test_ck_fixture',
    payment: { customerKey: '72b22340-3ec9-4bfb-a273-b8725f45efa5' },
    requestBillingAuth: {
      method: 'CARD',
      successUrl: 'https://example.invalid/success',
      failUrl: 'https://example.invalid/failure',
    },
  } as const;
  it('starts once, then only opens SDK on a second explicit user click', async () => {
    mocks.start.mockResolvedValue({
      ok: true,
      data: { status: { ...status, status: 'awaiting_authorization' }, launch },
    });
    mocks.open.mockResolvedValue(true);
    const onStart = vi.fn();
    render(
      subject(
        <EnrollmentLauncher
          intent={intent}
          disabled={false}
          onStart={onStart}
        />,
      ),
    );
    await userEvent.dblClick(screen.getByRole('button', { name: copy.start }));
    expect(mocks.start).toHaveBeenCalledExactlyOnceWith({
      sessionId: status.sessionId,
    });
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(mocks.open).not.toHaveBeenCalled();
    await userEvent.click(
      await screen.findByRole('button', { name: copy.openToss }),
    );
    expect(mocks.open).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole('button', { name: copy.openToss }),
    ).not.toBeInTheDocument();
  });
  it('unknown start result offers status, not another start or fake success', async () => {
    mocks.start.mockResolvedValue({ ok: false, code: 'UNAVAILABLE' });
    render(
      subject(
        <EnrollmentLauncher
          intent={intent}
          disabled={false}
          onStart={vi.fn()}
        />,
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: copy.start }));
    await screen.findByRole('alert');
    expect(
      screen.queryByRole('button', { name: copy.start }),
    ).not.toBeInTheDocument();
    expect(mocks.open).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole('button', { name: copy.viewStatus }),
    );
    expect(mocks.router.replace).toHaveBeenCalledWith(
      enrollmentCompletePath(status.sessionId),
    );
  });
  it('a late start after navigation cannot open provider SDK', async () => {
    let release: (value: unknown) => void = () => {};
    mocks.start.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const view = render(
      subject(
        <EnrollmentLauncher
          intent={intent}
          disabled={false}
          onStart={vi.fn()}
        />,
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: copy.start }));
    view.unmount();
    await act(async () => release({ ok: true, data: { status, launch } }));
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it('expired preparation never starts provider registration', () => {
    render(
      subject(
        <EnrollmentLauncher
          intent={{ ...intent, status: 'expired' }}
          disabled={false}
          onStart={vi.fn()}
        />,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: copy.start }));
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it('popstate invalidates a delayed start without replay', async () => {
    let release: (value: unknown) => void = () => {};
    mocks.start.mockReturnValue(new Promise((resolve) => (release = resolve)));
    render(
      subject(
        <EnrollmentLauncher
          intent={intent}
          disabled={false}
          onStart={vi.fn()}
        />,
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: copy.start }));
    fireEvent.popState(window);
    await act(async () => release({ ok: true, data: { status, launch } }));
    expect(
      screen.queryByRole('button', { name: copy.openToss }),
    ).not.toBeInTheDocument();
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });
});
