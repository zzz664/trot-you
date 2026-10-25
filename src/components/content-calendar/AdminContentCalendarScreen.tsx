'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  fetchAdminContentCalendar,
  saveContentCalendar,
  deleteContentCalendar,
} from '@/client/content-calendar';
import { adminContentCalendarPath, routes } from '@/config/routes';
import type {
  ContentCalendarEntry,
  ContentCalendarSaveInput,
  ContentCalendarDeleteInput,
} from '@/config/content-calendar';
import { Button } from '@/components/ui/Button';
import { Loading } from '@/components/ui/Loading';
import { InlineError } from '@/components/ui/InlineError';
import { useDialog } from '@/components/ui/DialogProvider';
import { CalendarActivity } from './CalendarActivity';
import { CalendarEntries } from './CalendarEntries';
import { CalendarEditor } from './CalendarEditor';
import { CalendarMonthNavigation } from './CalendarMonthNavigation';
import { useContentCalendarResource } from './useContentCalendarResource';
import styles from './content-calendar.module.css';
export function AdminContentCalendarScreen({
  artistId,
  month,
  actorKey,
  path,
}: {
  artistId: string;
  month: string;
  actorKey: string;
  path: string;
}) {
  const t = useTranslations('contentCalendar');
  const pendingSave = useRef<ContentCalendarSaveInput | null>(null);
  const pendingDelete = useRef<ContentCalendarDeleteInput | null>(null);
  const [editing, setEditing] = useState<ContentCalendarEntry | 'new' | null>(
    null,
  );
  const [notice, setNotice] = useState<'saved' | 'deleted' | null>(null);
  const [uncertainDelete, setUncertainDelete] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const { showDialog, cancelDialog } = useDialog();
  const mounted = useRef(true);
  const running = useRef(false);
  function clearPending() {
    pendingSave.current = null;
    pendingDelete.current = null;
    setUncertainDelete(false);
    setEditing(null);
    setNotice(null);
  }
  const load = useCallback(
    async (signal: AbortSignal) => {
      const result = await fetchAdminContentCalendar(
        { artist_id: artistId, month },
        signal,
        actorKey,
      );
      if (
        !signal.aborted &&
        !result.ok &&
        (result.code === 'FORBIDDEN' || result.code === 'UNAUTHENTICATED')
      )
        clearPending();
      return result;
    },
    [artistId, month, actorKey],
  );
  const state = useContentCalendarResource(path, load);
  useEffect(() => {
    mounted.current = true;
    const invalidateConfirmation = () => {
      cancelDialog('content-calendar-delete');
      setConfirming(false);
      // An aborted response is not evidence the delete was rolled back. Keep
      // its exact operation in recovery rather than attach it to another row.
      if (pendingDelete.current) setUncertainDelete(true);
    };
    const visibility = () => {
      if (document.visibilityState === 'hidden') invalidateConfirmation();
    };
    window.addEventListener('popstate', invalidateConfirmation);
    window.addEventListener('pagehide', invalidateConfirmation);
    window.addEventListener('focus', invalidateConfirmation);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      mounted.current = false;
      cancelDialog('content-calendar-delete');
      window.removeEventListener('popstate', invalidateConfirmation);
      window.removeEventListener('pagehide', invalidateConfirmation);
      window.removeEventListener('focus', invalidateConfirmation);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [cancelDialog]);
  function clear() {
    clearPending();
    cancelDialog('content-calendar-delete');
    state.clear();
  }
  function refreshFromUser() {
    setNotice(null);
    // A rejected edit must not be revived with its stale revision. An unknown
    // outcome is different: preserve the exact intent for explicit replay.
    if (!pendingSave.current) setEditing(null);
    return state.refresh();
  }
  async function remove(entry?: ContentCalendarEntry) {
    if (running.current || state.busy) return;
    running.current = true;
    try {
      if (!pendingDelete.current) {
        if (!entry) return;
        setConfirming(true);
        const result = await showDialog({
          key: 'content-calendar-delete',
          title: t('deleteDialogTitle'),
          description: t('deleteDialogDescription'),
          confirmLabel: t('deleteDialogConfirm'),
          cancelLabel: t('deleteDialogCancel'),
        });
        if (!mounted.current) return;
        setConfirming(false);
        if (result !== 'confirmed') return;
        pendingDelete.current = {
          operation_id: crypto.randomUUID(),
          entry_id: entry.id,
          expected_revision: entry.revision,
          confirmed: true,
        };
      }
      setNotice(null);
      const result = await state.execute((signal) =>
        deleteContentCalendar(pendingDelete.current!, signal, actorKey),
      );
      if (!result) {
        if (mounted.current && pendingDelete.current) setUncertainDelete(true);
        return;
      }
      if (!result.ok && result.code === 'UNAVAILABLE') setUncertainDelete(true);
      else {
        pendingDelete.current = null;
        setUncertainDelete(false);
        if (
          !result.ok &&
          (result.code === 'FORBIDDEN' || result.code === 'UNAUTHENTICATED')
        )
          clearPending();
        if (result.ok) {
          setEditing(null);
          await state.refresh();
          setNotice('deleted');
        }
      }
    } finally {
      running.current = false;
    }
  }
  const busy = state.busy || confirming || uncertainDelete;
  return (
    <main className={`app-shell ${styles.screen}`} aria-busy={state.busy}>
      <div className={styles.actions}>
        <Link
          href={routes.admin}
          prefetch={false}
          onNavigate={clear}
          className="ui-button ui-button--secondary"
        >
          {t('backAdmin')}
        </Link>
        <Link
          href={adminContentCalendarPath(month)}
          prefetch={false}
          onNavigate={clear}
          className="ui-button ui-button--secondary"
        >
          {t('backArtists')}
        </Link>
      </div>
      <h1>{t('adminTitle')}</h1>
      <p>{t('adminDescription')}</p>
      <Button
        variant="secondary"
        disabled={state.busy || confirming}
        onClick={() => void refreshFromUser()}
      >
        {t('refresh')}
      </Button>
      {state.busy && <Loading label={t('loading')} />}
      {state.error && (
        <InlineError
          message={t(`errors.${state.error}`)}
          onRetry={refreshFromUser}
        />
      )}
      {state.data && (
        <div className={styles.stack}>
          <h2>{state.data.artist.name}</h2>
          {state.data.artist.status !== 'active' && (
            <p className={styles.notice}>{t('artistInactive')}</p>
          )}
          <CalendarActivity
            activity={state.data.activity}
            serverNow={state.data.serverNow}
          />
          <CalendarMonthNavigation
            month={month}
            artistId={artistId}
            onNavigate={clear}
          />
          {notice && <p role="status">{t(notice)}</p>}
          {uncertainDelete && (
            <section
              className={styles.notice}
              data-testid="content-calendar-delete-recovery"
            >
              <p role="alert">{t('uncertain')}</p>
              <Button disabled={state.busy} onClick={() => void remove()}>
                {t('retryOperation')}
              </Button>
            </section>
          )}
          {!editing && !uncertainDelete && (
            <Button
              disabled={busy}
              onClick={() => {
                pendingSave.current = null;
                setNotice(null);
                setEditing('new');
              }}
            >
              {t('new')}
            </Button>
          )}
          {editing && (
            <CalendarEditor
              key={
                editing === 'new' ? 'new' : `${editing.id}:${editing.revision}`
              }
              entry={editing === 'new' ? null : editing}
              artistId={artistId}
              month={month}
              busy={busy}
              pendingOperation={pendingSave}
              onCancel={() => {
                pendingSave.current = null;
                setEditing(null);
              }}
              onSave={async (input) => {
                setNotice(null);
                const result = await state.execute((signal) =>
                  saveContentCalendar(input, signal, actorKey),
                );
                if (
                  result &&
                  !result.ok &&
                  (result.code === 'FORBIDDEN' ||
                    result.code === 'UNAUTHENTICATED')
                )
                  clearPending();
                if (result?.ok) {
                  pendingSave.current = null;
                  setEditing(null);
                  await state.refresh();
                  setNotice('saved');
                }
                return result;
              }}
            />
          )}
          <CalendarEntries
            entries={state.data.entries}
            busy={busy || editing !== null}
            onEdit={(entry) => {
              setNotice(null);
              pendingSave.current = null;
              setEditing(entry);
            }}
            onDelete={(entry) => void remove(entry)}
          />
        </div>
      )}
    </main>
  );
}
