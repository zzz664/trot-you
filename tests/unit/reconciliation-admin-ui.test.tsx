import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReconciliationScreen } from '@/components/admin/reconciliation/ReconciliationScreen';
import { ReconciliationEntry } from '@/components/admin/reconciliation/ReconciliationEntry';
import { ReconciliationLoading } from '@/components/admin/reconciliation/ReconciliationLoading';
import { ReconciliationErrorScreen } from '@/components/admin/reconciliation/ReconciliationErrorScreen';
import {
  RECONCILIATION_ADMIN_MAX_PAGE,
  RECONCILIATION_ADMIN_REASONS,
  type ReconciliationAdminList,
} from '@/config/reconciliation-admin';
import { adminReconciliationPath, routes } from '@/config/routes';
import messages from '@/messages/ko.json';
import {
  reconciliationAdminCase,
  reconciliationAdminIds,
  reconciliationAdminList,
} from './reconciliation-admin-fixtures';
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => mocks }));
const copy = messages.reconciliation;
function subject(child: ReactNode) {
  return (
    <NextIntlClientProvider locale="ko" messages={messages} timeZone="UTC">
      {child}
    </NextIntlClientProvider>
  );
}
function view(data: ReconciliationAdminList = reconciliationAdminList) {
  return render(subject(<ReconciliationScreen data={data} />));
}
const button = (name: string) => screen.getByRole('button', { name });
beforeEach(() => {
  vi.clearAllMocks();
});
describe('read-only reconciliation administration UI', () => {
  it('distinguishes uncertain money and test environment without exposing private identifiers', () => {
    view();
    expect(
      screen.getByRole('heading', { level: 1, name: copy.title }),
    ).toBeVisible();
    expect(
      screen.getByRole('heading', { level: 2, name: copy.kinds.renewal }),
    ).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(
      copy.statuses.manual_review,
    );
    expect(screen.getByText(copy.readOnly)).toBeVisible();
    expect(screen.getByText(copy.description)).toBeVisible();
    expect(screen.getByText(copy.timeZone)).toBeVisible();
    expect(screen.getByText(copy.reasons.PAYMENT_ID_MISSING)).toBeVisible();
    expect(screen.getByText(copy.unconfirmed)).toBeVisible();
    expect(document.body).toHaveTextContent('카카오페이 · 테스트 환경');
    expect(document.body).toHaveTextContent('확인 대상 금액: 9,900원');
    expect(document.body).not.toHaveTextContent(reconciliationAdminIds.case);
    expect(document.body).not.toHaveTextContent(
      reconciliationAdminIds.subscription,
    );
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it.each([
    'pending',
    'processing',
    'retry',
    'processed',
    'manual_review',
  ] as const)(
    'renders truthful %s state without payment action controls',
    (status) => {
      view({
        ...reconciliationAdminList,
        cases: [{ ...reconciliationAdminCase, status, reason: null }],
      });
      expect(screen.getByRole('status')).toHaveTextContent(
        copy.statuses[status],
      );
      if (status === 'processed')
        expect(screen.queryByText(copy.unconfirmed)).not.toBeInTheDocument();
      else expect(screen.getByText(copy.unconfirmed)).toBeVisible();
      expect(
        screen.getAllByRole('button').map((node) => node.textContent),
      ).toEqual([
        `←${messages.ui.back}`,
        copy.previousPage,
        copy.nextPage,
        copy.refresh,
      ]);
    },
  );
  it.each(RECONCILIATION_ADMIN_REASONS)(
    'explains bounded manual attention reason %s',
    (reason) => {
      view({
        ...reconciliationAdminList,
        cases: [{ ...reconciliationAdminCase, reason }],
      });
      expect(screen.getByText(copy.reasons[reason])).toBeVisible();
    },
  );
  it.each(['initial', 'renewal', 'refund'] as const)(
    'labels operation %s and does not confuse verification with charging',
    (kind) => {
      view({
        ...reconciliationAdminList,
        cases: [
          {
            ...reconciliationAdminCase,
            kind,
            provider: 'toss',
            environment: 'live',
            query_attempts: 3,
          },
        ],
      });
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
        copy.kinds[kind],
      );
      expect(document.body).toHaveTextContent('토스페이먼츠 · 실결제 환경');
      expect(document.body).toHaveTextContent('대사 조회 시도: 3회');
    },
  );
  it('does not pretend an empty case list verifies every payment', () => {
    view({ ...reconciliationAdminList, cases: [] });
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      copy.emptyTitle,
    );
    expect(screen.getByText(copy.emptyDescription)).toBeVisible();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(button(copy.previousPage)).toBeDisabled();
    expect(button(copy.nextPage)).toBeDisabled();
  });
  it('only navigates pagination and never invokes a provider or writes data', async () => {
    view({ ...reconciliationAdminList, page: 2, has_more: true });
    const nav = screen.getByRole('navigation', { name: copy.pagination });
    expect(within(nav).getByText('2페이지')).toHaveAttribute(
      'aria-current',
      'page',
    );
    await userEvent.click(button(copy.previousPage));
    expect(mocks.push).toHaveBeenLastCalledWith(routes.adminReconciliation);
    await userEvent.click(button(copy.nextPage));
    expect(mocks.push).toHaveBeenLastCalledWith(
      `${routes.adminReconciliation}?page=3`,
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('bounds page navigation even if a storage response advertises more past the cap', () => {
    view({
      ...reconciliationAdminList,
      page: RECONCILIATION_ADMIN_MAX_PAGE,
      has_more: true,
    });
    expect(button(copy.previousPage)).toBeEnabled();
    expect(button(copy.nextPage)).toBeDisabled();
  });
  it('refreshes stored state and safely replaces Back with the known admin route', async () => {
    view();
    await userEvent.click(button(copy.refresh));
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.push).not.toHaveBeenCalled();
    await userEvent.click(button(messages.ui.back));
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(routes.admin);
  });
  it('admin entry uses the centralized route', async () => {
    render(subject(<ReconciliationEntry />));
    await userEvent.click(button(copy.title));
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith(
      routes.adminReconciliation,
    );
  });
  it.each([
    'INVALID_INPUT',
    'FORBIDDEN',
    'SETUP_NOT_READY',
    'UNAVAILABLE',
  ] as const)(
    'shows safe %s error without fake financial success',
    async (code) => {
      render(subject(<ReconciliationErrorScreen code={code} />));
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        copy.errorTitle,
      );
      expect(screen.getByRole('alert')).toHaveTextContent(copy.errors[code]);
      await userEvent.click(button(messages.ui.retry));
      expect(mocks.refresh).toHaveBeenCalledOnce();
    },
  );
  it('uses the route boundary reset when supplied, not a second refresh', async () => {
    const reset = vi.fn();
    render(
      subject(<ReconciliationErrorScreen code="UNAVAILABLE" onRetry={reset} />),
    );
    await userEvent.click(button(messages.ui.retry));
    expect(reset).toHaveBeenCalledOnce();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('announces loading without inventing data', () => {
    render(subject(<ReconciliationLoading />));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      copy.title,
    );
    expect(screen.getByRole('status')).toHaveTextContent(copy.loading);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
  it('uses canonical page URLs', () => {
    expect(adminReconciliationPath(1)).toBe(routes.adminReconciliation);
    expect(adminReconciliationPath(20)).toBe(
      `${routes.adminReconciliation}?page=20`,
    );
  });
});
