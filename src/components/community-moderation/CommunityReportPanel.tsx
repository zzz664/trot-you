'use client';
import Link from 'next/link';
import { routes } from '@/config/routes';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  fetchModerationContext,
  reportCommunityTarget,
} from '@/client/community-moderation';
import {
  moderationReportInputSchema,
  type ModerationTarget,
  type ModerationReportInput,
  type ModerationReportReceipt,
} from '@/config/community-moderation';
import type { CommunityError } from '@/config/community-posts';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import { Loading } from '@/components/ui/Loading';
import { InlineError } from '@/components/ui/InlineError';
import { useCommunityResource } from '@/components/community-posts/useCommunityResource';
import { useModerationOperation } from './useModerationOperation';
import styles from './community-moderation.module.css';

type Props = {
  target: ModerationTarget;
  actorKey: string;
  path: string;
  available: boolean;
  authorityError?: CommunityError | null;
  onClose: () => void;
  onReported: () => void | Promise<void>;
  onBusyChange?: (busy: boolean) => void;
  onAccessLost?: (code: CommunityError) => void;
};
export function CommunityReportPanel(props: Props) {
  return (
    <ReportSession
      key={`${props.actorKey}:${props.target.target_type}:${props.target.target_id}:${props.path}`}
      {...props}
    />
  );
}
function ReportSession({
  target,
  actorKey,
  path,
  available,
  authorityError,
  onClose,
  onReported,
  onBusyChange,
  onAccessLost,
}: Props) {
  const t = useTranslations('communityModeration');
  const errors = useTranslations('communityPosts.errors');
  const [reason, setReason] = useState('');
  const [invalid, setInvalid] = useState(false);
  const load = useCallback(
    (signal: AbortSignal) => fetchModerationContext(target, signal, actorKey),
    [target, actorKey],
  );
  const context = useCommunityResource(path, load);
  const denied =
    authorityError === 'FORBIDDEN' || authorityError === 'UNAUTHENTICATED'
      ? authorityError
      : context.error;
  const operation = useModerationOperation<
    ModerationReportInput,
    ModerationReportReceipt
  >({
    path,
    send: (input, signal) => reportCommunityTarget(input, signal, actorKey),
    onSuccess: onReported,
    authorityError: denied,
  });
  useEffect(() => {
    onBusyChange?.(operation.busy || operation.uncertain);
    return () => onBusyChange?.(false);
  }, [onBusyChange, operation.busy, operation.uncertain]);
  const invalidateContext = context.invalidate;
  useEffect(() => {
    const failure = operation.error ?? denied;
    if (
      failure === 'FORBIDDEN' ||
      failure === 'UNAUTHENTICATED' ||
      failure === 'NOT_FOUND'
    )
      onAccessLost?.(failure);
    if (failure === 'FORBIDDEN' || failure === 'UNAUTHENTICATED')
      queueMicrotask(() => {
        invalidateContext(failure);
        setReason('');
        setInvalid(false);
      });
  }, [denied, operation.error, onAccessLost, invalidateContext]);
  const data = context.data;
  const accessLost =
    denied === 'FORBIDDEN' ||
    denied === 'UNAUTHENTICATED' ||
    operation.error === 'FORBIDDEN' ||
    operation.error === 'UNAUTHENTICATED';
  function submit() {
    if (
      !data ||
      !available ||
      operation.busy ||
      operation.uncertain ||
      data.existing_report ||
      accessLost
    )
      return;
    const input = { ...target, operation_id: crypto.randomUUID(), reason };
    if (
      !moderationReportInputSchema.safeParse(input).success ||
      Array.from(reason).length > data.max_reason_length
    ) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    void operation.run(input);
  }
  return (
    <section
      className={styles.panel}
      data-testid="community-report-panel"
      aria-busy={context.busy || operation.busy}
    >
      <h2>
        {t('reportTitle', { target: t(`targets.${target.target_type}`) })}
      </h2>
      <p>{t('reportDescription')}</p>
      {context.busy && <Loading label={t('loading')} />}
      {operation.saved && (
        <>
          <p role="status">{t('reportSaved')}</p>
          <Link
            href={routes.communityReports}
            prefetch={false}
            className="ui-button ui-button--secondary"
            onNavigate={() => {
              operation.clear();
              context.clear();
            }}
          >
            {t('inboxEntry')}
          </Link>
        </>
      )}
      {(operation.error ||
        (context.error && !operation.uncertain && !operation.saved)) && (
        <InlineError
          message={errors(operation.error ?? context.error!)}
          onRetry={context.refresh}
        />
      )}
      {operation.uncertain && (
        <section
          className={styles.recovery}
          data-testid="community-report-recovery"
        >
          <p role="alert">{t('uncertain')}</p>
          <Button
            disabled={operation.busy || accessLost}
            onClick={() => void operation.run()}
          >
            {t('retryOperation')}
          </Button>
        </section>
      )}
      {!operation.saved &&
        !operation.uncertain &&
        data &&
        !accessLost &&
        (data.existing_report ? (
          <p role="status">
            {t('alreadyReported', {
              status: t(`statuses.${data.existing_report.status}`),
            })}
          </p>
        ) : available ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
            className={styles.stack}
          >
            <Textarea
              label={t('reason')}
              hint={t('reasonHint', { max: data.max_reason_length })}
              value={reason}
              disabled={operation.busy}
              error={invalid ? t('invalidReason') : undefined}
              onChange={(event) => {
                setReason(event.target.value);
                setInvalid(false);
              }}
            />
            <Button type="submit" disabled={operation.busy}>
              {t('submitReport')}
            </Button>
          </form>
        ) : (
          <p>{t('targetUnavailable')}</p>
        ))}
      <Button
        variant="secondary"
        disabled={operation.busy || operation.uncertain}
        onClick={() => {
          operation.clear();
          context.clear();
          onClose();
        }}
      >
        {t('close')}
      </Button>
    </section>
  );
}
