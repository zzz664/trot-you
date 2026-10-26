'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  fetchModerationQueue,
  resolveModerationReport,
  restrictModerationUser,
} from '@/client/community-moderation';
import {
  COMMUNITY_MODERATION,
  moderationResolveInputSchema,
  moderationRestrictInputSchema,
  type ModerationCursor,
  type ModerationReport,
  type ModerationResolveInput,
  type ModerationRestrictInput,
} from '@/config/community-moderation';
import { routes } from '@/config/routes';
import { scheduleFromLocalDateTime } from '@/lib/schedule-view';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Loading } from '@/components/ui/Loading';
import { InlineError } from '@/components/ui/InlineError';
import { useDialog } from '@/components/ui/DialogProvider';
import { useCommunityResource } from '@/components/community-posts/useCommunityResource';
import { useModerationOperation } from './useModerationOperation';
import styles from './community-moderation.module.css';

type Intent =
  | { kind: 'resolve'; input: ModerationResolveInput }
  | { kind: 'restrict'; input: ModerationRestrictInput };
export function AdminModerationScreen({ actorKey }: { actorKey: string }) {
  return <ModerationSession key={actorKey} actorKey={actorKey} />;
}
function ModerationSession({ actorKey }: { actorKey: string }) {
  const t = useTranslations('communityModeration');
  const errors = useTranslations('communityPosts.errors');
  const format = useFormatter();
  const { showDialog, cancelDialog } = useDialog();
  const cursor = useRef<ModerationCursor | null>(null);
  const [pageCursor, setPageCursor] = useState<ModerationCursor | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [kind, setKind] = useState<Intent['kind'] | null>(null);
  const confirmingRef = useRef(false);
  const alive = useRef(false);
  const latest = useRef<ModerationReport | undefined>(undefined);
  const load = useCallback(
    (signal: AbortSignal) =>
      fetchModerationQueue(cursor.current, signal, actorKey),
    [actorKey],
  );
  const state = useCommunityResource(routes.adminModeration, load);
  const selected = state.data?.reports.find(
    (report) => report.id === selectedId,
  );
  const operation = useModerationOperation<Intent, unknown>({
    path: routes.adminModeration,
    authorityError: state.error,
    send: (intent, signal) =>
      intent.kind === 'resolve'
        ? resolveModerationReport(intent.input, signal, actorKey)
        : restrictModerationUser(intent.input, signal, actorKey),
    onSuccess: async () => {
      await state.refresh();
    },
  });
  const frozen =
    state.busy || operation.busy || operation.uncertain || confirming;
  const operationDenied =
    operation.error === 'FORBIDDEN' ||
    operation.error === 'UNAUTHENTICATED' ||
    operation.error === 'CONFLICT' ||
    operation.error === 'NOT_FOUND' ||
    operation.error === 'SETUP_NOT_READY';
  const invalidate = state.invalidate;
  useEffect(() => {
    if (
      operation.error === 'FORBIDDEN' ||
      operation.error === 'UNAUTHENTICATED' ||
      operation.error === 'CONFLICT' ||
      operation.error === 'NOT_FOUND' ||
      operation.error === 'SETUP_NOT_READY'
    ) {
      const code = operation.error;
      queueMicrotask(() => {
        if (!alive.current) return;
        invalidate(code);
        setSelectedId(null);
      });
    }
  }, [operation.error, invalidate]);
  useEffect(() => {
    latest.current = selected;
    cancelDialog(COMMUNITY_MODERATION.dialogKey);
    queueMicrotask(() => {
      if (alive.current) setConfirming(false);
    });
  }, [selected, cancelDialog]);
  useEffect(() => {
    alive.current = true;
    const interrupt = () => {
      cancelDialog(COMMUNITY_MODERATION.dialogKey);
      setConfirming(false);
    };
    const visibility = () => {
      if (document.visibilityState === 'hidden') interrupt();
    };
    window.addEventListener('pagehide', interrupt);
    window.addEventListener('popstate', interrupt);
    window.addEventListener('focus', interrupt);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      alive.current = false;
      cancelDialog(COMMUNITY_MODERATION.dialogKey);
      window.removeEventListener('pagehide', interrupt);
      window.removeEventListener('popstate', interrupt);
      window.removeEventListener('focus', interrupt);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [cancelDialog]);
  function clear() {
    cancelDialog(COMMUNITY_MODERATION.dialogKey);
    operation.clear();
    state.clear();
    setSelectedId(null);
  }
  async function confirm(intent: Intent, report: ModerationReport) {
    if (frozen || confirmingRef.current || latest.current !== report) return;
    confirmingRef.current = true;
    setConfirming(true);
    try {
      const answer = await showDialog({
        key: COMMUNITY_MODERATION.dialogKey,
        title: t(
          intent.kind === 'resolve'
            ? 'confirmTitle'
            : 'restrictionConfirmTitle',
        ),
        description:
          intent.kind === 'resolve'
            ? t('confirmDescription', { decision: t(intent.input.decision) })
            : t('restrictionConfirmDescription', {
                action: t(intent.input.restricted ? 'restrict' : 'unrestrict'),
              }),
        confirmLabel: t('confirm'),
        cancelLabel: t('cancel'),
      });
      if (!alive.current) return;
      setConfirming(false);
      if (answer !== 'confirmed' || latest.current !== report) return;
      setKind(intent.kind);
      await operation.run(intent);
    } finally {
      confirmingRef.current = false;
    }
  }
  function paginate(next: ModerationCursor | null) {
    if (frozen) return;
    cursor.current = next;
    setPageCursor(next);
    setSelectedId(null);
    void state.refresh();
  }
  function date(value: string) {
    return format.dateTime(new Date(value), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: COMMUNITY_MODERATION.timeZone,
    });
  }
  return (
    <main
      className={`app-shell ${styles.screen}`}
      aria-busy={state.busy || operation.busy}
    >
      <Link
        href={routes.admin}
        prefetch={false}
        onNavigate={clear}
        className="ui-button ui-button--secondary"
      >
        {t('backAdmin')}
      </Link>
      <h1>{t('adminTitle')}</h1>
      <p>{t('adminDescription')}</p>
      <Button
        variant="secondary"
        disabled={state.busy || operation.busy || confirming}
        onClick={() => void state.refresh()}
      >
        {t('refresh')}
      </Button>
      {(state.busy || operation.busy) && <Loading label={t('loading')} />}
      {(operation.error || state.error) && (
        <InlineError
          message={errors(operation.error ?? state.error!)}
          onRetry={state.refresh}
        />
      )}
      {operation.saved && (
        <p role="status">
          {t(kind === 'restrict' ? 'restrictionSaved' : 'saved')}
        </p>
      )}
      {operation.uncertain && (
        <section
          className={styles.recovery}
          data-testid="community-moderation-recovery"
        >
          <p role="alert">{t('uncertain')}</p>
          <Button
            disabled={operation.busy || state.busy || confirming}
            onClick={() => void operation.run()}
          >
            {t('retryOperation')}
          </Button>
        </section>
      )}
      {state.data && !operationDenied && (
        <section
          className={styles.stack}
          data-testid="community-moderation-content"
        >
          {state.data.reports.length === 0 && <p>{t('emptyQueue')}</p>}
          <ol className={styles.list}>
            {state.data.reports.map((report) => (
              <li
                key={report.id}
                data-moderation-target-id={report.target_id}
                data-moderation-report-id={report.id}
              >
                <article className={styles.panel}>
                  <h2>
                    {t('targetHeading', {
                      target: t(`targets.${report.target_type}`),
                    })}
                  </h2>
                  <p>{t('artist', { name: report.target.artist.name })}</p>
                  <p>{t(`statuses.${report.status}`)}</p>
                  <p>{t('createdAt', { date: date(report.created_at) })}</p>
                  <p className={styles.body}>{report.reason}</p>
                  <Button
                    variant="secondary"
                    disabled={frozen || selectedId === report.id}
                    onClick={() => setSelectedId(report.id)}
                  >
                    {t('review')}
                  </Button>
                </article>
              </li>
            ))}
          </ol>
          <nav className={styles.actions}>
            {pageCursor && (
              <Button
                variant="secondary"
                disabled={frozen}
                onClick={() => paginate(null)}
              >
                {t('firstPage')}
              </Button>
            )}
            {state.data.next_cursor && (
              <Button
                variant="secondary"
                disabled={frozen}
                onClick={() => paginate(state.data!.next_cursor)}
              >
                {t('nextPage')}
              </Button>
            )}
          </nav>
        </section>
      )}
      {selected && !operationDenied && (
        <ReportReview
          key={`${selected.id}:${selected.target.revision}:${selected.target.owner.updated_at}`}
          report={selected}
          disabled={frozen}
          onIntent={(intent) => void confirm(intent, selected)}
          onClose={() => setSelectedId(null)}
        />
      )}
    </main>
  );
}
function ReportReview({
  report,
  disabled,
  onIntent,
  onClose,
}: {
  report: ModerationReport;
  disabled: boolean;
  onIntent: (intent: Intent) => void;
  onClose: () => void;
}) {
  const t = useTranslations('communityModeration');
  const format = useFormatter();
  const [reason, setReason] = useState('');
  const [restrictionReason, setRestrictionReason] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [invalidReason, setInvalidReason] = useState(false);
  const [invalidRestriction, setInvalidRestriction] = useState(false);
  const owner = report.target.owner;
  const [viewedAt, setViewedAt] = useState(Date.now);
  useEffect(() => {
    queueMicrotask(() => setViewedAt(Date.now()));
  }, [owner]);
  function resolve(decision: 'restore' | 'delete') {
    if (disabled) return;
    const input = {
      operation_id: crypto.randomUUID(),
      report_id: report.id,
      expected_revision: report.target.revision,
      decision,
      reason,
      confirmed: true as const,
    };
    if (!moderationResolveInputSchema.safeParse(input).success) {
      setInvalidReason(true);
      return;
    }
    setInvalidReason(false);
    onIntent({ kind: 'resolve', input });
  }
  function restrict(restricted: boolean) {
    if (disabled) return;
    const until = restricted ? scheduleFromLocalDateTime(date, time) : null;
    const input = {
      operation_id: crypto.randomUUID(),
      user_id: owner.id,
      expected_updated_at: owner.updated_at,
      restricted,
      until,
      reason: restrictionReason,
      confirmed: true as const,
    };
    if (
      !moderationRestrictInputSchema.safeParse(input).success ||
      (restricted && (until === null || Date.parse(until) <= Date.now()))
    ) {
      setInvalidRestriction(true);
      return;
    }
    setInvalidRestriction(false);
    onIntent({ kind: 'restrict', input });
  }
  return (
    <section
      className={styles.panel}
      data-testid="community-moderation-review"
      data-moderation-selected-id={report.id}
    >
      <h2>{t('reviewTitle')}</h2>
      <p>{t('author', { name: owner.call_name ?? t('anonymous') })}</p>
      <p>{t('reportCount', { count: report.target.report_count })}</p>
      <p>
        {t(
          report.target.deleted_at
            ? 'deletedTarget'
            : report.target.is_hidden
              ? 'hiddenTarget'
              : 'visibleTarget',
        )}
      </p>
      {!report.target.deleted_at && (
        <>
          <h3>{report.target.title ?? t(`targets.${report.target_type}`)}</h3>
          <p className={styles.body}>{report.target.body}</p>
        </>
      )}
      <h3>{t('reportReason')}</h3>
      <p className={styles.body}>{report.reason}</p>
      {(report.status === 'open' || report.status === 'hidden') &&
        !report.target.deleted_at && (
          <section className={styles.stack}>
            <Textarea
              label={t('decisionReason')}
              value={reason}
              disabled={disabled}
              error={invalidReason ? t('invalidReason') : undefined}
              onChange={(event) => {
                setReason(event.target.value);
                setInvalidReason(false);
              }}
            />
            <div className={styles.actions}>
              <Button disabled={disabled} onClick={() => resolve('restore')}>
                {t('restore')}
              </Button>
              <Button
                variant="secondary"
                disabled={disabled}
                onClick={() => resolve('delete')}
              >
                {t('delete')}
              </Button>
            </div>
          </section>
        )}
      <section
        className={styles.stack}
        data-testid="community-moderation-restriction"
      >
        <h3>{t('restrictionTitle')}</h3>
        <p>{t('restrictionDescription')}</p>
        <p>
          {t(
            owner.is_restricted &&
              owner.restricted_until &&
              Date.parse(owner.restricted_until) <= viewedAt
              ? 'restrictionExpired'
              : owner.is_restricted
                ? 'restricted'
                : 'unrestricted',
          )}
        </p>
        {owner.restricted_until && (
          <p>
            {t('restrictedUntil', {
              date: format.dateTime(new Date(owner.restricted_until), {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: COMMUNITY_MODERATION.timeZone,
              }),
            })}
          </p>
        )}
        {owner.can_restrict ? (
          <>
            <Textarea
              label={t('restrictionReason')}
              value={restrictionReason}
              disabled={disabled}
              error={invalidRestriction ? t('invalidRestriction') : undefined}
              onChange={(event) => {
                setRestrictionReason(event.target.value);
                setInvalidRestriction(false);
              }}
            />
            <p>{t('timeZone')}</p>
            <div className={styles.fields}>
              <Input
                label={t('restrictionDate')}
                type="date"
                value={date}
                disabled={disabled}
                onChange={(event) => {
                  setDate(event.target.value);
                  setInvalidRestriction(false);
                }}
              />
              <Input
                label={t('restrictionTime')}
                type="time"
                value={time}
                disabled={disabled}
                onChange={(event) => {
                  setTime(event.target.value);
                  setInvalidRestriction(false);
                }}
              />
            </div>
            <div className={styles.actions}>
              <Button disabled={disabled} onClick={() => restrict(true)}>
                {t('restrict')}
              </Button>
              {owner.is_restricted && (
                <Button
                  variant="secondary"
                  disabled={disabled}
                  onClick={() => restrict(false)}
                >
                  {t('unrestrict')}
                </Button>
              )}
            </div>
          </>
        ) : (
          <p>{t('cannotRestrict')}</p>
        )}
      </section>
      <Button variant="secondary" disabled={disabled} onClick={onClose}>
        {t('close')}
      </Button>
    </section>
  );
}
