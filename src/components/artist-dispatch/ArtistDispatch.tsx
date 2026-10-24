'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useDialog } from '@/components/ui/DialogProvider';
import type { ComposeDraft } from '@/config/artist-compose';
import type { DispatchMessage } from '@/config/message-dispatch';
import { artistComposePath, artistDispatchPath } from '@/config/routes';
import { dispatchDate, dispatchScheduledInstant } from './time';
import { useArtistDispatch } from './useArtistDispatch';
import styles from './artist-dispatch.module.css';

export function ArtistDispatch({
  slug,
  draft,
  disabled,
  initialDispatchedId,
  historyOnly = false,
  onLock,
  onPublished,
  onAccessLost,
}: {
  slug: string;
  draft: ComposeDraft | null;
  disabled: boolean;
  initialDispatchedId?: string;
  historyOnly?: boolean;
  onLock: (value: boolean) => void;
  onPublished: () => Promise<boolean>;
  onAccessLost: () => void;
}) {
  const t = useTranslations('artistDispatch');
  const kinds = useTranslations('artistCompose.kinds');
  const { showDialog, cancelDialog } = useDialog();
  const pathname = historyOnly
    ? artistDispatchPath(slug)
    : artistComposePath(slug);
  const state = useArtistDispatch({
    slug,
    pathname,
    ...(initialDispatchedId ? { initialDispatchedId } : {}),
    onPublished,
    onAccessLost,
  });
  const [mode, setMode] = useState<'immediate' | 'scheduled'>('immediate');
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [scheduleInvalid, setScheduleInvalid] = useState(false);
  const [intentError, setIntentError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const confirmingNow = useRef(false);
  const alive = useRef(true);
  const dialogKey = useRef<string | null>(null);
  const current = useRef({ draft, disabled });
  useLayoutEffect(() => {
    current.current = { draft, disabled };
  }, [draft, disabled]);
  const lockCallback = useRef(onLock);
  useLayoutEffect(() => {
    lockCallback.current = onLock;
  }, [onLock]);
  const mutationBusy = state.busy === 'submit' || state.busy === 'cancel';
  const locked =
    mutationBusy || state.uncertain || state.refreshRequired || confirming;
  const cannotAct =
    disabled || locked || state.busy !== null || state.accessLost;
  const ready =
    !historyOnly &&
    !!draft &&
    !draft.pendingUploadIds.length &&
    !cannotAct &&
    !!state.page;
  useLayoutEffect(() => {
    lockCallback.current(locked);
  }, [locked]);
  useEffect(() => {
    alive.current = true;
    const dismiss = () => {
      if (dialogKey.current) cancelDialog(dialogKey.current);
      confirmingNow.current = false;
      setConfirming(false);
    };
    window.addEventListener('popstate', dismiss);
    window.addEventListener('pagehide', dismiss);
    return () => {
      alive.current = false;
      if (dialogKey.current) cancelDialog(dialogKey.current);
      lockCallback.current(false);
      window.removeEventListener('popstate', dismiss);
      window.removeEventListener('pagehide', dismiss);
    };
  }, [cancelDialog]);
  async function submit() {
    if (!ready || !draft || confirmingNow.current) return;
    const instant =
      mode === 'scheduled'
        ? dispatchScheduledInstant(`${scheduleDate}T${scheduleTime}`)
        : null;
    if (
      mode === 'scheduled' &&
      (!instant || Date.parse(instant) <= Date.parse(state.page!.serverNow))
    ) {
      setScheduleInvalid(true);
      return;
    }
    setIntentError(false);
    confirmingNow.current = true;
    setConfirming(true);
    const snapshot = { id: draft.id, revision: draft.revision };
    const key = `artist-dispatch-submit:${slug}:${draft.id}`;
    dialogKey.current = key;
    try {
      const result = await showDialog({
        key,
        title: t(
          mode === 'scheduled'
            ? 'confirmScheduleTitle'
            : 'confirmImmediateTitle',
        ),
        description: t(
          mode === 'scheduled'
            ? 'confirmScheduleDescription'
            : 'confirmImmediateDescription',
          {
            kind: kinds(draft.kind),
            revision: draft.revision,
            ...(instant ? { date: dispatchDate(instant) } : {}),
          },
        ),
        confirmLabel: t('confirmSubmit'),
        cancelLabel: t('stay'),
      });
      if (
        result !== 'confirmed' ||
        !alive.current ||
        window.location.pathname !== pathname ||
        current.current.disabled ||
        current.current.draft?.id !== snapshot.id ||
        current.current.draft.revision !== snapshot.revision
      )
        return;
      await state.submit({
        slug,
        messageId: snapshot.id,
        expectedRevision: snapshot.revision,
        operationId: crypto.randomUUID(),
        scheduledAt: instant,
        confirmed: true,
      });
    } catch {
      if (alive.current) setIntentError(true);
    } finally {
      dialogKey.current = null;
      confirmingNow.current = false;
      if (alive.current) setConfirming(false);
    }
  }
  async function cancel(item: DispatchMessage) {
    if (cannotAct || !item.canCancel || confirmingNow.current) return;
    setIntentError(false);
    confirmingNow.current = true;
    setConfirming(true);
    const key = `artist-dispatch-cancel:${slug}:${item.id}`;
    dialogKey.current = key;
    try {
      const result = await showDialog({
        key,
        title: t('cancelTitle'),
        description: t('cancelDescription'),
        confirmLabel: t('confirmCancel'),
        cancelLabel: t('stay'),
      });
      if (
        result !== 'confirmed' ||
        !alive.current ||
        window.location.pathname !== pathname ||
        current.current.disabled
      )
        return;
      await state.cancel({
        slug,
        messageId: item.id,
        operationId: crypto.randomUUID(),
        confirmed: true,
      });
    } catch {
      if (alive.current) setIntentError(true);
    } finally {
      dialogKey.current = null;
      confirmingNow.current = false;
      if (alive.current) setConfirming(false);
    }
  }
  function receipt(item: DispatchMessage, selected = false) {
    return (
      <article
        className="ui-card"
        data-dispatch-id={item.id}
        data-dispatch-status={item.status}
      >
        <h3>{t(`statuses.${item.status}`)}</h3>
        <p>
          {t('itemSummary', {
            kind: kinds(item.kind),
            date: dispatchDate(item.scheduledAt),
          })}
        </p>
        {item.body !== null && <p className={styles.body}>{item.body}</p>}
        {item.media.length > 0 && (
          <p>{t('mediaCount', { count: item.media.length })}</p>
        )}
        {item.sentAt && (
          <p>{t('publishedAt', { date: dispatchDate(item.sentAt) })}</p>
        )}
        {item.canceledAt && (
          <p>{t('canceledAt', { date: dispatchDate(item.canceledAt) })}</p>
        )}
        <p className="ui-hint">
          {t(`notifications.${item.notificationState}`)}
        </p>
        {item.dispatchError && (
          <p className="ui-error-text" role="alert">
            {t(`dispatchErrors.${item.dispatchError}`)}
          </p>
        )}
        {item.status === 'sent' && item.cancelBefore && (
          <p>
            {t(item.canCancel ? 'cancelBefore' : 'cancelEnded', {
              date: dispatchDate(item.cancelBefore),
            })}
          </p>
        )}
        {item.canCancel && (
          <Button
            variant="secondary"
            disabled={cannotAct}
            onClick={() => void cancel(item)}
          >
            {t('cancelMessage')}
          </Button>
        )}
        {selected && <p className="ui-hint">{t('currentReceipt')}</p>}
      </article>
    );
  }
  return (
    <section
      className={styles.panel}
      aria-label={t(historyOnly ? 'historyPanel' : 'title')}
    >
      <h2>{t(historyOnly ? 'historyPanel' : 'title')}</h2>
      <p>{t('notice')}</p>
      {state.accessLost ? (
        <p role="alert">{t('accessLost')}</p>
      ) : (
        <>
          {!historyOnly && (
            <>
              <p className="ui-hint">{t('savedOnly')}</p>
              <fieldset className={styles.mode} disabled={cannotAct}>
                <legend>{t('mode')}</legend>
                <div className={styles.actions}>
                  <Button
                    variant={mode === 'immediate' ? 'primary' : 'secondary'}
                    onClick={() => {
                      setMode('immediate');
                      setScheduleInvalid(false);
                    }}
                  >
                    {t('immediate')}
                  </Button>
                  <Button
                    variant={mode === 'scheduled' ? 'primary' : 'secondary'}
                    onClick={() => {
                      setMode('scheduled');
                      setScheduleInvalid(false);
                    }}
                  >
                    {t('scheduled')}
                  </Button>
                </div>
                <p className="ui-hint">
                  {t(
                    mode === 'scheduled'
                      ? 'selectedScheduled'
                      : 'selectedImmediate',
                  )}
                </p>
                {mode === 'scheduled' && (
                  <div className={styles.scheduleFields}>
                    <Input
                      type="date"
                      label={t('scheduleDateLabel')}
                      value={scheduleDate}
                      onChange={(event) => {
                        setScheduleDate(event.target.value);
                        setScheduleInvalid(false);
                      }}
                      disabled={cannotAct}
                      hint={t('scheduleHint')}
                      {...(scheduleInvalid && !scheduleDate
                        ? { error: t('invalidSchedule') }
                        : {})}
                    />
                    <Input
                      type="time"
                      label={t('scheduleTimeLabel')}
                      value={scheduleTime}
                      onChange={(event) => {
                        setScheduleTime(event.target.value);
                        setScheduleInvalid(false);
                      }}
                      disabled={cannotAct}
                      hint={t('scheduleTimeHint')}
                      {...(scheduleInvalid && scheduleDate
                        ? { error: t('invalidSchedule') }
                        : {})}
                    />
                  </div>
                )}
              </fieldset>
              <Button
                disabled={!ready}
                isLoading={state.busy === 'submit'}
                onClick={() => void submit()}
              >
                {t('submit')}
              </Button>
            </>
          )}
          {(state.error || intentError) && (
            <p className="ui-error-text" role="alert">
              {t(`errors.${state.error ?? 'UNAVAILABLE'}`)}
            </p>
          )}
          {state.uncertain && (
            <div className={styles.recovery}>
              <p role="status">{t('uncertain')}</p>
              <div className={styles.actions}>
                <Button
                  disabled={state.busy !== null || confirming}
                  onClick={() => void state.retry()}
                >
                  {t('retrySame')}
                </Button>
                <Button
                  variant="secondary"
                  disabled={state.busy !== null || confirming}
                  onClick={() => void state.load()}
                >
                  {t('checkStatus')}
                </Button>
              </div>
            </div>
          )}
          {state.refreshRequired && (
            <div className={styles.recovery}>
              <p role="status">{t('refreshRequired')}</p>
              <Button
                disabled={state.busy !== null}
                onClick={() => void state.refreshEditor()}
              >
                {t('refreshEditor')}
              </Button>
            </div>
          )}
          {state.receipt && (
            <section aria-label={t('receipt')} className={styles.receipt}>
              <h2>{t('receipt')}</h2>
              {receipt(state.receipt, true)}
            </section>
          )}
          <section aria-label={t('history')} className={styles.history}>
            <h2>{t('history')}</h2>
            <p className="ui-hint">{t('cancelNotice')}</p>
            <Button
              variant="secondary"
              disabled={
                mutationBusy ||
                confirming ||
                state.busy !== null ||
                state.refreshRequired
              }
              onClick={() => void state.load()}
            >
              {t('refresh')}
            </Button>
            {state.busy === 'page' && <p role="status">{t('loading')}</p>}
            {state.page && state.page.messages.length === 0 && (
              <p>{t('empty')}</p>
            )}
            {state.page && (
              <ol className={styles.list}>
                {state.page.messages.map((item) => (
                  <li key={item.id}>{receipt(item)}</li>
                ))}
              </ol>
            )}
            {state.page?.nextCursor && (
              <Button
                variant="secondary"
                disabled={cannotAct}
                onClick={() => void state.load(true)}
              >
                {t('older')}
              </Button>
            )}
          </section>
        </>
      )}
    </section>
  );
}
