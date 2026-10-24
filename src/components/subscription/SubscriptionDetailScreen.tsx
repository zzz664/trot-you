'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  cancelSubscription,
  readSubscription,
  requestRefund,
} from '@/client/subscription';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { RefundStatus } from '@/components/admin/refunds/RefundStatus';
import {
  refundRequestInputSchema,
  type SubscriptionDetail,
  type ManagementResult,
} from '@/config/subscription-management';
import { routes, subscriptionPath } from '@/config/routes';
import { managementAmount, managementDate } from './format';
import { ManagementPagination } from './ManagementPagination';
import { SubscriptionStatus } from './SubscriptionStatus';
import { useManagementState } from './useManagementState';

export function SubscriptionDetailScreen({
  data,
}: {
  data: SubscriptionDetail;
}) {
  const t = useTranslations('subscriptions');
  const ui = useTranslations('ui');
  const state = useManagementState(data);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [invalid, setInvalid] = useState(false);
  const requestKey = useRef<string | null>(null);
  const selected = state.data.charges.find(
    (charge) => charge.id === selectedId,
  );
  const locked = state.busy || state.uncertain;

  function choose(id: string) {
    if (locked) return;
    setSelectedId(id);
    setAmount('');
    setReason('');
    setInvalid(false);
    requestKey.current = null;
  }

  async function preserveChargePage(
    operation: Promise<ManagementResult<SubscriptionDetail>>,
  ): Promise<ManagementResult<SubscriptionDetail>> {
    const originalPage = state.data.page;
    const result = await operation;
    if (!result.ok || result.data.page === originalPage) return result;
    // A mutation may return the latest page, but the URL still identifies this
    // historical page. Read it again without repeating the command or changing
    // history, so the affected older charge remains visible.
    return readSubscription({ subscriptionId: state.data.id }, originalPage);
  }

  async function submitRequest() {
    if (locked || !selected?.can_request_refund) return;
    const candidate = {
      subscriptionId: state.data.id,
      originalEventId: selected.id,
      amountKrw: /^\d+$/.test(amount) ? Number(amount) : Number.NaN,
      reason,
      idempotencyKey: requestKey.current ?? crypto.randomUUID(),
    };
    const input = refundRequestInputSchema.safeParse(candidate);
    if (
      !input.success ||
      input.data.amountKrw > selected.amount_krw - selected.refunded_krw
    ) {
      setInvalid(true);
      return;
    }
    requestKey.current = input.data.idempotencyKey;
    setInvalid(false);
    const saved = await state.run(
      'request',
      () => preserveChargePage(requestRefund(input.data)),
      undefined,
      'requestSaved',
    );
    if (saved) {
      setSelectedId(null);
      setAmount('');
      setReason('');
      requestKey.current = null;
    }
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
          onClick={() => state.leave(routes.subscriptions)}
        />
      </nav>
      <header className="onboarding-stack">
        <h1>{t('detailTitle', { name: state.data.artist_name })}</h1>
        <p className="ui-hint">{t('timeZone')}</p>
      </header>
      <Card title={t('statusTitle')}>
        <SubscriptionStatus data={state.data} />
      </Card>
      <Card title={t('cancelTitle')}>
        <p>{t('cancelExplanation')}</p>
        <Button
          disabled={locked || !state.data.can_cancel}
          isLoading={state.pending === 'cancel'}
          onClick={() =>
            void state.run(
              'cancel',
              () =>
                preserveChargePage(
                  cancelSubscription({ subscriptionId: state.data.id }),
                ),
              {
                title: t('cancelConfirmTitle'),
                description: t('cancelConfirmDescription'),
                confirmLabel: t('cancelConfirm'),
                cancelLabel: t('cancelKeep'),
              },
              'canceled',
            )
          }
        >
          {t(state.pending === 'cancel' ? 'canceling' : 'cancel')}
        </Button>
      </Card>
      <section className="onboarding-stack" aria-live="polite">
        {state.notice && <p role="status">{t(state.notice)}</p>}
        {state.error && <p role="alert">{t(`errors.${state.error}`)}</p>}
        {state.uncertain && <p>{t('unknownNotice')}</p>}
        <Button
          variant="secondary"
          disabled={state.busy}
          isLoading={state.pending === 'read'}
          onClick={() =>
            void state.run('read', () =>
              readSubscription(
                { subscriptionId: state.data.id },
                state.data.page,
              ),
            )
          }
        >
          {t(state.pending === 'read' ? 'refreshing' : 'refresh')}
        </Button>
      </section>
      <section
        className="onboarding-stack"
        aria-labelledby="refund-request-heading"
      >
        <h2 id="refund-request-heading">{t('requestTitle')}</h2>
        <p>{t('requestExplanation')}</p>
        {state.data.charges.length === 0 ? (
          <p>{t('noCharges')}</p>
        ) : (
          <ul className="artist-list">
            {state.data.charges.map((charge) => (
              <li key={charge.id}>
                <Card
                  title={t('chargeTitle', {
                    date: managementDate(charge.occurred_at),
                  })}
                >
                  <p>
                    {t('chargeAmount', {
                      amount: managementAmount(charge.amount_krw),
                    })}
                  </p>
                  <p>
                    {t('refundedAmount', {
                      amount: managementAmount(charge.refunded_krw),
                    })}
                  </p>
                  <p>
                    {t('remainingAmount', {
                      amount: managementAmount(
                        charge.amount_krw - charge.refunded_krw,
                      ),
                    })}
                  </p>
                  {charge.refund_request && (
                    <RefundStatus data={charge.refund_request} />
                  )}
                  <Button
                    variant="secondary"
                    disabled={locked || !charge.can_request_refund}
                    onClick={() => choose(charge.id)}
                  >
                    {t('chooseCharge')}
                  </Button>
                </Card>
              </li>
            ))}
          </ul>
        )}
        <ManagementPagination
          page={state.data.page}
          moreAvailable={state.data.charges_more_available}
          disabled={locked}
          onPage={(page) => state.leave(subscriptionPath(state.data.id, page))}
        />
      </section>
      {selected?.can_request_refund && (
        <Card title={t('requestTitle')}>
          <p>
            {t('selectedCharge', {
              date: managementDate(selected.occurred_at),
              amount: managementAmount(selected.amount_krw),
            })}
          </p>
          <div className="onboarding-stack">
            <Input
              label={t('amountLabel')}
              hint={t('amountHint')}
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
                requestKey.current = null;
              }}
              disabled={locked}
              required
            />
            <Input
              label={t('reasonLabel')}
              hint={t('reasonHint')}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                requestKey.current = null;
              }}
              disabled={locked}
              required
            />
            {invalid && <p role="alert">{t('formInvalid')}</p>}
            <Button
              disabled={locked || !amount || !reason.trim()}
              isLoading={state.pending === 'request'}
              onClick={() => void submitRequest()}
            >
              {t(state.pending === 'request' ? 'requesting' : 'request')}
            </Button>
          </div>
        </Card>
      )}
    </main>
  );
}
