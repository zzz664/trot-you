'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  authorizeRefund,
  executeRefund,
  readAdminRefund,
  reconcileRefund,
  rejectRefund,
} from '@/client/refunds';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { managementAmount } from '@/components/subscription/format';
import { useManagementState } from '@/components/subscription/useManagementState';
import {
  refundAuthorizeInputSchema,
  refundRejectInputSchema,
  type AdminRefundDetail,
} from '@/config/subscription-management';
import { routes } from '@/config/routes';
import { RefundStatus } from './RefundStatus';

export function RefundDetailScreen({ data }: { data: AdminRefundDetail }) {
  const t = useTranslations('refunds');
  const ui = useTranslations('ui');
  const state = useManagementState(data);
  const [accepted, setAccepted] = useState(false);
  const [approvalReason, setApprovalReason] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [invalid, setInvalid] = useState(false);
  const current = state.data;
  const request = current.request;
  const amount = managementAmount(request.amount_krw);
  const locked = state.busy || state.uncertain;

  async function refresh() {
    if (state.busy) return;
    setAccepted(false);
    setInvalid(false);
    await state.run('read', () => readAdminRefund({ requestId: request.id }));
  }

  async function authorize() {
    if (locked || !current.can_authorize || !current.policy || !accepted)
      return;
    const input = refundAuthorizeInputSchema.safeParse({
      requestId: request.id,
      amountKrw: request.amount_krw,
      policyVersion: current.policy.version,
      reason: approvalReason,
      accepted,
    });
    if (!input.success) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    const saved = await state.run(
      'authorize',
      () => authorizeRefund(input.data),
      undefined,
      'authorized',
    );
    if (saved) setAccepted(false);
  }

  async function reject() {
    if (locked || !current.can_reject) return;
    const input = refundRejectInputSchema.safeParse({
      requestId: request.id,
      reason: rejectionReason,
    });
    if (!input.success) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    await state.run('reject', () => rejectRefund(input.data), {
      title: t('rejectConfirmTitle'),
      description: t('rejectConfirmDescription'),
      confirmLabel: t('rejectConfirm'),
    });
  }

  return (
    <main
      className="app-shell onboarding-shell"
      aria-busy={state.busy || undefined}
    >
      <nav aria-label={t('navigation')}>
        <IconButton
          label={ui('back')}
          icon="←"
          variant="secondary"
          onClick={() => state.leave(routes.adminRefunds)}
        />
      </nav>
      <header className="onboarding-stack">
        <h1>{t('detailTitle')}</h1>
        <p>{t('artist', { name: request.artist_name })}</p>
      </header>
      <Card title={t('requestTitle')}>
        <RefundStatus data={request} />
        <p>
          {t('originalAmount', {
            amount: managementAmount(request.charge_amount_krw),
          })}
        </p>
        <p>
          {t('remainingAmount', {
            amount: managementAmount(
              request.charge_amount_krw - request.refunded_krw,
            ),
          })}
        </p>
        <p className="ui-hint">{t('retainedAccess')}</p>
      </Card>
      <section className="onboarding-stack" aria-live="polite">
        {state.notice && <p role="status">{t(state.notice)}</p>}
        {state.error && <p role="alert">{t(`errors.${state.error}`)}</p>}
        {state.uncertain && <p>{t('unknownNotice')}</p>}
        <Button
          variant="secondary"
          disabled={state.busy}
          isLoading={state.pending === 'read'}
          onClick={() => void refresh()}
        >
          {t(state.pending === 'read' ? 'refreshing' : 'refresh')}
        </Button>
      </section>
      {current.policy ? (
        <Card title={current.policy.title}>
          <p className="artist-copy">{current.policy.body}</p>
          <p>{t('retainedAccess')}</p>
        </Card>
      ) : (
        <p>{t('policyUnavailable')}</p>
      )}
      {request.status === 'requested' && (
        <Card title={t('authorizeTitle')}>
          <div className="onboarding-stack">
            <p>{t('authorizeExplanation')}</p>
            <Input
              label={t('approvalReasonLabel')}
              hint={t('approvalReasonHint')}
              value={approvalReason}
              onChange={(event) => setApprovalReason(event.target.value)}
              disabled={locked || !current.can_authorize}
              required
            />
            <Checkbox
              label={t('authorizeConsent', { amount })}
              checked={accepted}
              onChange={(event) => setAccepted(event.target.checked)}
              disabled={locked || !current.can_authorize || !current.policy}
            />
            <Button
              disabled={
                locked ||
                !current.can_authorize ||
                !current.policy ||
                !accepted ||
                !approvalReason.trim()
              }
              isLoading={state.pending === 'authorize'}
              onClick={() => void authorize()}
            >
              {state.pending === 'authorize'
                ? t('authorizing')
                : t('authorize', { amount })}
            </Button>
          </div>
        </Card>
      )}
      {request.status === 'authorized' && (
        <Card title={t('executeTitle')}>
          <div className="onboarding-stack">
            <p>{t('executeExplanation')}</p>
            {!current.execution_enabled && <p>{t('providerUnavailable')}</p>}
            <Button
              disabled={
                locked || !current.execution_enabled || !current.can_execute
              }
              isLoading={state.pending === 'execute'}
              onClick={() =>
                void state.run(
                  'execute',
                  () => executeRefund({ requestId: request.id }),
                  {
                    title: t('executeConfirmTitle'),
                    description: t('executeConfirmDescription', { amount }),
                    confirmLabel: t('executeConfirm', { amount }),
                  },
                )
              }
            >
              {state.pending === 'execute'
                ? t('executing')
                : t('execute', { amount })}
            </Button>
          </div>
        </Card>
      )}
      {['inflight', 'unknown'].includes(request.status) && (
        <Button
          variant="secondary"
          disabled={locked || !current.can_reconcile}
          isLoading={state.pending === 'reconcile'}
          onClick={() =>
            void state.run('reconcile', () =>
              reconcileRefund({ requestId: request.id }),
            )
          }
        >
          {t(state.pending === 'reconcile' ? 'reconciling' : 'reconcile')}
        </Button>
      )}
      {current.can_reject && (
        <Card title={t('rejectTitle')}>
          <div className="onboarding-stack">
            <Input
              label={t('rejectReasonLabel')}
              value={rejectionReason}
              onChange={(event) => setRejectionReason(event.target.value)}
              disabled={locked}
              required
            />
            <Button
              variant="secondary"
              disabled={locked || !rejectionReason.trim()}
              isLoading={state.pending === 'reject'}
              onClick={() => void reject()}
            >
              {t(state.pending === 'reject' ? 'rejecting' : 'reject')}
            </Button>
          </div>
        </Card>
      )}
      {invalid && <p role="alert">{t('formInvalid')}</p>}
    </main>
  );
}
