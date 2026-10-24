import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SubscriptionDetailScreen } from '@/components/subscription/SubscriptionDetailScreen';
import { SubscriptionsScreen } from '@/components/subscription/SubscriptionsScreen';
import { SubscriptionEntry } from '@/components/subscription/SubscriptionEntry';
import { RefundDetailScreen } from '@/components/admin/refunds/RefundDetailScreen';
import { RefundsScreen } from '@/components/admin/refunds/RefundsScreen';
import { RefundEntry } from '@/components/admin/refunds/RefundEntry';
import { ManagementErrorScreen } from '@/components/subscription/ManagementErrorScreen';
import { ManagementLoading } from '@/components/subscription/ManagementLoading';
import { DialogProvider } from '@/components/ui/DialogProvider';
import {
  routes,
  subscriptionListPath,
  subscriptionPath,
  adminRefundListPath,
  adminRefundPath,
} from '@/config/routes';
import {
  MANAGEMENT_ERROR_STATUS,
  type AdminRefundDetail,
  type ManagementResult,
  type SubscriptionDetail,
} from '@/config/subscription-management';
import messages from '@/messages/ko.json';
import {
  managementAdmin,
  managementAuthorized,
  managementCanceled,
  managementIds as ids,
  managementRequest,
  managementSubscription,
} from './management-fixtures';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  cancel: vi.fn(),
  request: vi.fn(),
  read: vi.fn(),
  authorize: vi.fn(),
  reject: vi.fn(),
  execute: vi.fn(),
  reconcile: vi.fn(),
  adminRead: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mocks.push,
    replace: mocks.replace,
    refresh: mocks.refresh,
  }),
}));
vi.mock('@/client/subscription', () => ({
  cancelSubscription: mocks.cancel,
  requestRefund: mocks.request,
  readSubscription: mocks.read,
}));
vi.mock('@/client/refunds', () => ({
  authorizeRefund: mocks.authorize,
  rejectRefund: mocks.reject,
  executeRefund: mocks.execute,
  reconcileRefund: mocks.reconcile,
  readAdminRefund: mocks.adminRead,
}));
const fan = messages.subscriptions;
const admin = messages.refunds;
function subject(child: ReactNode) {
  return (
    <NextIntlClientProvider locale="ko" messages={messages} timeZone="UTC">
      <DialogProvider>{child}</DialogProvider>
    </NextIntlClientProvider>
  );
}
const amountLabel = (
  key: 'authorize' | 'execute' | 'executeConfirm' | 'authorizeConsent',
) => admin[key].replace('{amount}', '500');
const button = (name: string) => screen.getByRole('button', { name });
function fanScreen(data = managementSubscription) {
  return render(subject(<SubscriptionDetailScreen data={data} />));
}
function adminScreen(data = managementAdmin) {
  return render(subject(<RefundDetailScreen data={data} />));
}
async function cancelConfirmed() {
  await userEvent.click(button(fan.cancel));
  await userEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: fan.cancelConfirm,
    }),
  );
}
async function fillRefund(amount = '500', reason = '허구 환불 검토 사유') {
  await userEvent.click(button(fan.chooseCharge));
  await userEvent.type(screen.getByLabelText(fan.amountLabel), amount);
  await userEvent.type(screen.getByLabelText(fan.reasonLabel), reason);
}
async function approve() {
  await userEvent.type(
    screen.getByLabelText(admin.approvalReasonLabel),
    '허구 관리자 검토 사유',
  );
  await userEvent.click(
    screen.getByRole('checkbox', { name: amountLabel('authorizeConsent') }),
  );
  await userEvent.click(button(amountLabel('authorize')));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.cancel.mockResolvedValue({ ok: true, data: managementCanceled });
  mocks.read.mockResolvedValue({ ok: true, data: managementCanceled });
  mocks.request.mockResolvedValue({
    ok: true,
    data: {
      ...managementSubscription,
      charges: [
        {
          ...managementSubscription.charges[0],
          refund_request: managementRequest,
          can_request_refund: false,
        },
      ],
    },
  });
  mocks.authorize.mockResolvedValue({ ok: true, data: managementAuthorized });
  mocks.adminRead.mockResolvedValue({ ok: true, data: managementAdmin });
  mocks.execute.mockResolvedValue({
    ok: true,
    data: {
      ...managementAuthorized,
      can_execute: false,
      can_reject: false,
      request: {
        ...managementAuthorized.request,
        status: 'succeeded',
        refunded_krw: 500,
      },
    },
  });
  mocks.reconcile.mockResolvedValue({ ok: true, data: managementAuthorized });
  mocks.reject.mockResolvedValue({
    ok: true,
    data: {
      ...managementAdmin,
      can_authorize: false,
      can_reject: false,
      request: { ...managementRequest, status: 'rejected' },
    },
  });
});

describe('owner subscription management', () => {
  it('shows separate paid period, renewal, access and no provider identifiers', () => {
    fanScreen();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      managementSubscription.artist_name,
    );
    expect(screen.getByText(fan.cancelExplanation)).toBeVisible();
    expect(screen.getByText(fan.requestExplanation)).toBeVisible();
    expect(screen.getByText(fan.accessAvailable)).toBeVisible();
    expect(screen.getByText(fan.timeZone)).toBeVisible();
    expect(document.body).not.toHaveTextContent(ids.subscription);
    expect(document.body).not.toHaveTextContent(ids.charge);
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it.each(['cancel', 'close', 'escape'] as const)(
    'dismisses cancellation via %s with no mutation/history change',
    async (how) => {
      fanScreen();
      await userEvent.click(button(fan.cancel));
      expect(mocks.cancel).not.toHaveBeenCalled();
      const dialog = within(screen.getByRole('dialog'));
      if (how === 'escape') await userEvent.keyboard('{Escape}');
      else
        await userEvent.click(
          dialog.getByRole('button', {
            name: how === 'cancel' ? fan.cancelKeep : messages.ui.close,
          }),
        );
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(mocks.cancel).not.toHaveBeenCalled();
      expect(mocks.replace).not.toHaveBeenCalled();
      expect(button(fan.cancel)).toBeEnabled();
    },
  );
  it('cancel confirmation executes once and retains paid access without requesting refund', async () => {
    fanScreen();
    await cancelConfirmed();
    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith({
      subscriptionId: ids.subscription,
    });
    expect(screen.getByText(fan.statuses.canceled)).toBeVisible();
    expect(screen.getByText(fan.accessAvailable)).toBeVisible();
    expect(screen.getByText(fan.noNextBilling)).toBeVisible();
    expect(button(fan.cancel)).toBeDisabled();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('repeated clicks create one confirmation and one in-flight cancellation', async () => {
    const pending = deferred<ManagementResult<SubscriptionDetail>>();
    mocks.cancel.mockReturnValue(pending.promise);
    fanScreen();
    const trigger = button(fan.cancel);
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: fan.cancelConfirm,
      }),
    );
    expect(button(fan.canceling)).toBeDisabled();
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
    await act(async () =>
      pending.resolve({ ok: true, data: managementCanceled }),
    );
    expect(screen.getByText(fan.statuses.canceled)).toBeVisible();
  });
  it('unknown cancellation locks writes until explicit read-only refresh', async () => {
    mocks.cancel.mockResolvedValue({ ok: false, code: 'UNAVAILABLE' });
    fanScreen();
    await cancelConfirmed();
    expect(screen.getByText(fan.unknownNotice)).toBeVisible();
    expect(button(fan.cancel)).toBeDisabled();
    expect(button(fan.chooseCharge)).toBeDisabled();
    await userEvent.click(button(fan.refresh));
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith(
      { subscriptionId: ids.subscription },
      1,
    );
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(fan.unknownNotice)).not.toBeInTheDocument();
    expect(screen.getByText(fan.statuses.canceled)).toBeVisible();
  });
  it('failed read does not unlock unknown mutation or replay it', async () => {
    mocks.cancel.mockRejectedValue(new Error('private transport error'));
    mocks.read.mockResolvedValue({ ok: false, code: 'UNAVAILABLE' });
    fanScreen();
    await cancelConfirmed();
    await userEvent.click(button(fan.refresh));
    expect(button(fan.cancel)).toBeDisabled();
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
    expect(document.body).not.toHaveTextContent('private transport error');
  });
  it('popstate dismisses an open confirmation, not a cancellation command', async () => {
    fanScreen();
    await userEvent.click(button(fan.cancel));
    fireEvent.popState(window);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(button(fan.cancel)).toBeEnabled();
  });
  it('Back during pending cancellation ignores stale completion and preserves uncertainty', async () => {
    const pending = deferred<ManagementResult<SubscriptionDetail>>();
    mocks.cancel.mockReturnValue(pending.promise);
    fanScreen();
    await cancelConfirmed();
    await userEvent.click(button(messages.ui.back));
    expect(mocks.replace).toHaveBeenCalledWith(routes.subscriptions);
    await act(async () =>
      pending.resolve({ ok: true, data: managementCanceled }),
    );
    expect(screen.queryByText(fan.statuses.canceled)).not.toBeInTheDocument();
    expect(screen.getByText(fan.unknownNotice)).toBeVisible();
  });
  it('newer read after popstate wins over stale successful write response', async () => {
    const pending = deferred<ManagementResult<SubscriptionDetail>>();
    mocks.cancel.mockReturnValue(pending.promise);
    mocks.read.mockResolvedValue({
      ok: true,
      data: { ...managementCanceled, status: 'expired', has_access: false },
    });
    fanScreen();
    await cancelConfirmed();
    fireEvent.popState(window);
    await userEvent.click(button(fan.refresh));
    await act(async () =>
      pending.resolve({ ok: true, data: managementCanceled }),
    );
    expect(screen.getByText(fan.statuses.expired)).toBeVisible();
    expect(screen.queryByText(fan.statuses.canceled)).not.toBeInTheDocument();
  });
  it('unmount cancels a pending dialog without sending the command', async () => {
    const view = fanScreen();
    await userEvent.click(button(fan.cancel));
    view.unmount();
    await act(async () => Promise.resolve());
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it('grace cancellation clearly distinguishes paid access and unresolved renewal', () => {
    fanScreen({
      ...managementSubscription,
      status: 'grace',
      has_unresolved_charge: true,
    });
    expect(screen.getByText(fan.graceNotice)).toBeVisible();
    expect(screen.getByText(fan.renewalUncertain)).toBeVisible();
    expect(button(fan.cancel)).toBeEnabled();
  });
  it('expired subscriptions cannot cancel but verified charge review can remain available', () => {
    fanScreen({
      ...managementSubscription,
      status: 'expired',
      can_cancel: false,
      has_access: false,
      next_billing_at: null,
    });
    expect(button(fan.cancel)).toBeDisabled();
    expect(button(fan.chooseCharge)).toBeEnabled();
    expect(screen.getByText(fan.accessUnavailable)).toBeVisible();
  });
  it('explicit request amount/reason uses one stable identity and never invokes cancel/execute', async () => {
    fanScreen();
    await fillRefund();
    await userEvent.click(button(fan.request));
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith({
      subscriptionId: ids.subscription,
      originalEventId: ids.charge,
      amountKrw: 500,
      reason: '허구 환불 검토 사유',
      idempotencyKey: expect.any(String),
    });
    expect(screen.getByText(admin.statuses.requested)).toBeVisible();
    expect(screen.getByText(fan.requestSaved)).toBeVisible();
    expect(button(fan.chooseCharge)).toBeDisabled();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each(['0', '-1', '1.5', '1e3', '1001', ' 500 '])(
    'rejects invalid/out-of-remainder amount %s without RPC',
    async (amount) => {
      fanScreen();
      await fillRefund(amount);
      await userEvent.click(button(fan.request));
      expect(screen.getByRole('alert')).toHaveTextContent(fan.formInvalid);
      expect(mocks.request).not.toHaveBeenCalled();
    },
  );
  it('does not preselect amount and requires nonempty reason', async () => {
    fanScreen();
    await userEvent.click(button(fan.chooseCharge));
    expect(screen.getByLabelText(fan.amountLabel)).toHaveValue('');
    expect(screen.getByLabelText(fan.reasonLabel)).toHaveValue('');
    expect(button(fan.request)).toBeDisabled();
  });
  it('unknown refund request blocks changed/repeated requests until a read', async () => {
    mocks.request.mockResolvedValue({ ok: false, code: 'UNAVAILABLE' });
    fanScreen();
    await fillRefund();
    await userEvent.click(button(fan.request));
    expect(screen.getByLabelText(fan.amountLabel)).toBeDisabled();
    expect(screen.getByLabelText(fan.reasonLabel)).toBeDisabled();
    expect(button(fan.request)).toBeDisabled();
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it('keeps an older requested charge visible with a read-only reload of the original page', async () => {
    const original = { ...managementSubscription, page: 2 };
    const saved = {
      ...original,
      charges: [
        {
          ...original.charges[0]!,
          refund_request: managementRequest,
          can_request_refund: false,
        },
      ],
    };
    mocks.request.mockResolvedValue({
      ok: true,
      data: { ...managementSubscription, charges: [] },
    });
    mocks.read.mockResolvedValue({ ok: true, data: saved });
    fanScreen(original);
    await fillRefund();
    await userEvent.click(button(fan.request));
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith(
      { subscriptionId: ids.subscription },
      2,
    );
    expect(screen.getByText(admin.statuses.requested)).toBeVisible();
    expect(
      screen.getByText(fan.pageNumber.replace('{page}', '2')),
    ).toBeVisible();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });
  it('a failed older-page read after saved request stays uncertain without repeating the request', async () => {
    mocks.request.mockResolvedValue({ ok: true, data: managementSubscription });
    mocks.read.mockResolvedValue({ ok: false, code: 'UNAVAILABLE' });
    fanScreen({ ...managementSubscription, page: 2 });
    await fillRefund();
    await userEvent.click(button(fan.request));
    expect(screen.getByText(fan.unknownNotice)).toBeVisible();
    expect(button(fan.request)).toBeDisabled();
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith(
      { subscriptionId: ids.subscription },
      2,
    );
    expect(screen.queryByText(fan.requestSaved)).not.toBeInTheDocument();
  });
  it('cancellation from a historical page retains that page via read-only refresh', async () => {
    mocks.read.mockResolvedValue({
      ok: true,
      data: { ...managementCanceled, page: 2 },
    });
    fanScreen({ ...managementSubscription, page: 2 });
    await cancelConfirmed();
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith(
      { subscriptionId: ids.subscription },
      2,
    );
    expect(
      screen.getByText(fan.pageNumber.replace('{page}', '2')),
    ).toBeVisible();
    expect(screen.getByText(fan.statuses.canceled)).toBeVisible();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
  it('supports historical charge pagination without silently limiting review to latest charges', async () => {
    fanScreen({
      ...managementSubscription,
      page: 2,
      charges_more_available: true,
    });
    await userEvent.click(button(fan.nextPage));
    expect(mocks.replace).toHaveBeenCalledWith(
      subscriptionPath(ids.subscription, 3),
    );
    expect(mocks.request).not.toHaveBeenCalled();
  });
});

describe('admin authorization is distinct from provider execution', () => {
  it('shows exact requested money, full approved policy and no preselected approval', () => {
    adminScreen();
    expect(
      screen.getByRole('heading', { name: managementAdmin.policy!.title }),
    ).toBeVisible();
    expect(screen.getByText(managementAdmin.policy!.body)).toBeVisible();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(button(amountLabel('authorize'))).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: amountLabel('execute') }),
    ).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(ids.request);
    expect(mocks.authorize).not.toHaveBeenCalled();
  });
  it('missing approved policy fails closed but permits independently authorized rejection', () => {
    adminScreen({ ...managementAdmin, policy: null, can_authorize: false });
    expect(screen.getByText(admin.policyUnavailable)).toBeVisible();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(button(amountLabel('authorize'))).toBeDisabled();
    expect(screen.getByLabelText(admin.rejectReasonLabel)).toBeEnabled();
    expect(document.body).not.toHaveTextContent('7일');
  });
  it('approval requires reason and acknowledgment then saves exact amount/policy only', async () => {
    adminScreen();
    await approve();
    expect(mocks.authorize).toHaveBeenCalledExactlyOnceWith({
      requestId: ids.request,
      amountKrw: 500,
      policyVersion: ids.policy,
      reason: '허구 관리자 검토 사유',
      accepted: true,
    });
    expect(screen.getByText(admin.statuses.authorized)).toBeVisible();
    expect(button(amountLabel('execute'))).toBeEnabled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('status refresh revokes local policy acknowledgment before allowing approval again', async () => {
    adminScreen();
    await userEvent.type(
      screen.getByLabelText(admin.approvalReasonLabel),
      '검토 사유',
    );
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(button(admin.refresh));
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(button(amountLabel('authorize'))).toBeDisabled();
  });
  it('unknown authorization never opens an execution path and refresh is read-only', async () => {
    mocks.authorize.mockResolvedValue({ ok: false, code: 'UNAVAILABLE' });
    adminScreen();
    await approve();
    expect(button(amountLabel('authorize'))).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: amountLabel('execute') }),
    ).not.toBeInTheDocument();
    await userEvent.click(button(admin.refresh));
    expect(mocks.adminRead).toHaveBeenCalledExactlyOnceWith({
      requestId: ids.request,
    });
    expect(mocks.authorize).toHaveBeenCalledTimes(1);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each(['cancel', 'close', 'escape'] as const)(
    'dismisses execution confirmation by %s without monetary dispatch',
    async (how) => {
      adminScreen(managementAuthorized);
      await userEvent.click(button(amountLabel('execute')));
      const dialog = within(screen.getByRole('dialog'));
      if (how === 'escape') await userEvent.keyboard('{Escape}');
      else
        await userEvent.click(
          dialog.getByRole('button', {
            name: how === 'cancel' ? messages.ui.cancel : messages.ui.close,
          }),
        );
      expect(mocks.execute).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    },
  );
  it('executes only after explicit confirmation and shows verified final status', async () => {
    adminScreen(managementAuthorized);
    await userEvent.click(button(amountLabel('execute')));
    expect(mocks.execute).not.toHaveBeenCalled();
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: amountLabel('executeConfirm'),
      }),
    );
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith({
      requestId: ids.request,
    });
    expect(screen.getByText(admin.statuses.succeeded)).toBeVisible();
    expect(
      screen.queryByRole('button', { name: amountLabel('execute') }),
    ).not.toBeInTheDocument();
  });
  it('double execution clicks cannot enqueue or dispatch twice', async () => {
    const pending = deferred<ManagementResult<AdminRefundDetail>>();
    mocks.execute.mockReturnValue(pending.promise);
    adminScreen(managementAuthorized);
    const trigger = button(amountLabel('execute'));
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: amountLabel('executeConfirm'),
      }),
    );
    expect(button(admin.executing)).toBeDisabled();
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ ok: false, code: 'UNAVAILABLE' }));
    expect(button(amountLabel('execute'))).toBeDisabled();
  });
  it('unknown state offers query only, never execute/reject or invented failure', async () => {
    const data: AdminRefundDetail = {
      ...managementAuthorized,
      can_execute: false,
      can_reject: false,
      can_reconcile: true,
      request: {
        ...managementAuthorized.request,
        status: 'unknown',
        can_reconcile: true,
      },
    };
    mocks.reconcile.mockResolvedValue({ ok: true, data });
    adminScreen(data);
    expect(screen.getByText(admin.statuses.unknown)).toBeVisible();
    expect(
      screen.queryByRole('button', { name: amountLabel('execute') }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: admin.reject }),
    ).not.toBeInTheDocument();
    await userEvent.click(button(admin.reconcile));
    expect(mocks.reconcile).toHaveBeenCalledExactlyOnceWith({
      requestId: ids.request,
    });
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(screen.queryByText(admin.statuses.failed)).not.toBeInTheDocument();
  });
  it('provider-disabled authorization cannot execute', () => {
    adminScreen({
      ...managementAuthorized,
      execution_enabled: false,
      can_execute: false,
    });
    expect(screen.getByText(admin.providerUnavailable)).toBeVisible();
    expect(button(amountLabel('execute'))).toBeDisabled();
  });
  it('blocked provider identity/manual review cannot be bypassed by approved status', () => {
    adminScreen({
      ...managementAuthorized,
      can_execute: false,
      request: {
        ...managementAuthorized.request,
        requires_manual_review: true,
      },
    });
    expect(screen.getByText(admin.manualReview)).toBeVisible();
    expect(button(amountLabel('execute'))).toBeDisabled();
  });
  it('bounded query/manual-review state disables further query', () => {
    adminScreen({
      ...managementAuthorized,
      can_execute: false,
      can_reject: false,
      can_reconcile: false,
      request: {
        ...managementAuthorized.request,
        status: 'unknown',
        requires_manual_review: true,
      },
    });
    expect(button(admin.reconcile)).toBeDisabled();
    expect(screen.getByText(admin.manualReview)).toBeVisible();
  });
  it('rejection needs a reason and explicit confirmation, never invokes provider', async () => {
    adminScreen();
    expect(button(admin.reject)).toBeDisabled();
    await userEvent.type(
      screen.getByLabelText(admin.rejectReasonLabel),
      '승인 조건에 맞지 않음',
    );
    await userEvent.click(button(admin.reject));
    expect(mocks.reject).not.toHaveBeenCalled();
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: admin.rejectConfirm,
      }),
    );
    expect(mocks.reject).toHaveBeenCalledExactlyOnceWith({
      requestId: ids.request,
      reason: '승인 조건에 맞지 않음',
    });
    expect(screen.getByText(admin.statuses.rejected)).toBeVisible();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('Back while executing ignores stale success and never redirects from response', async () => {
    const pending = deferred<ManagementResult<AdminRefundDetail>>();
    mocks.execute.mockReturnValue(pending.promise);
    adminScreen(managementAuthorized);
    await userEvent.click(button(amountLabel('execute')));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: amountLabel('executeConfirm'),
      }),
    );
    await userEvent.click(button(messages.ui.back));
    await act(async () =>
      pending.resolve({
        ok: true,
        data: {
          ...managementAuthorized,
          request: { ...managementAuthorized.request, status: 'succeeded' },
        },
      }),
    );
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(routes.adminRefunds);
    expect(
      screen.queryByText(admin.statuses.succeeded),
    ).not.toBeInTheDocument();
  });
});

describe('management discovery, error and pagination screens', () => {
  it('exposes owner/admin entries with central paths', async () => {
    render(
      subject(
        <>
          <SubscriptionEntry />
          <RefundEntry />
        </>,
      ),
    );
    await userEvent.click(button(fan.title));
    await userEvent.click(button(admin.title));
    expect(mocks.push.mock.calls).toEqual([
      [routes.subscriptions],
      [routes.adminRefunds],
    ]);
  });
  it('lists subscriptions and exact detail paths, with accessible server pagination', async () => {
    render(
      subject(
        <SubscriptionsScreen
          data={{
            subscriptions: [managementSubscription],
            page: 2,
            more_available: true,
          }}
        />,
      ),
    );
    await userEvent.click(
      button(fan.open.replace('{name}', managementSubscription.artist_name)),
    );
    expect(mocks.push).toHaveBeenLastCalledWith(
      subscriptionPath(ids.subscription),
    );
    await userEvent.click(button(fan.nextPage));
    expect(mocks.push).toHaveBeenLastCalledWith(subscriptionListPath(3));
    await userEvent.click(button(fan.previousPage));
    expect(mocks.push).toHaveBeenLastCalledWith(subscriptionListPath(1));
  });
  it('empty list uses text and no fake subscriptions or charges', () => {
    render(
      subject(
        <SubscriptionsScreen
          data={{ subscriptions: [], page: 1, more_available: false }}
        />,
      ),
    );
    expect(screen.getByText(fan.emptyDescription)).toBeVisible();
    expect(button(fan.nextPage)).toBeDisabled();
    expect(button(fan.previousPage)).toBeDisabled();
    expect(
      screen.queryByText(managementSubscription.artist_name),
    ).not.toBeInTheDocument();
  });
  it('admin list shows policy gate and routes without displaying opaque identifiers', async () => {
    render(
      subject(
        <RefundsScreen
          data={{
            requests: [managementRequest],
            policy: null,
            more_available: true,
            page: 2,
          }}
        />,
      ),
    );
    expect(screen.getByText(admin.policyUnavailable)).toBeVisible();
    await userEvent.click(
      button(admin.open.replace('{name}', managementRequest.artist_name)),
    );
    expect(mocks.push).toHaveBeenLastCalledWith(adminRefundPath(ids.request));
    await userEvent.click(button(fan.nextPage));
    expect(mocks.push).toHaveBeenLastCalledWith(adminRefundListPath(3));
    expect(document.body).not.toHaveTextContent(ids.request);
  });
  it.each(
    Object.keys(MANAGEMENT_ERROR_STATUS) as Array<
      keyof typeof MANAGEMENT_ERROR_STATUS
    >,
  )('safe error %s has a visible retry and no mutation', async (code) => {
    render(subject(<ManagementErrorScreen code={code} />));
    expect(screen.getByRole('alert')).toHaveTextContent(fan.errors[code]);
    await userEvent.click(button(messages.ui.retry));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('loading is explicit text rather than a skeleton', () => {
    render(subject(<ManagementLoading />));
    expect(screen.getByRole('status')).toHaveTextContent(fan.loading);
  });
});
