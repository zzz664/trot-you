'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState, useRef } from 'react';
import { useTranslations } from 'next-intl';
import {
  fetchAdminSchedule,
  saveAdminSchedule,
  deleteAdminSchedule,
} from '@/client/schedules';
import type {
  AdminScheduleSaveInput,
  AdminScheduleDeleteInput,
} from '@/config/schedules';
import { routes, adminSchedulePath } from '@/config/routes';
import { Button } from '@/components/ui/Button';
import { Loading } from '@/components/ui/Loading';
import { InlineError } from '@/components/ui/InlineError';
import { useScheduleResource } from './useScheduleResource';
import { ScheduleEditor } from './ScheduleEditor';
import { AdminScheduleDelete } from './AdminScheduleDelete';
import styles from './schedules.module.css';
export function AdminScheduleDetailScreen({
  id,
  actorKey,
}: {
  id: string;
  actorKey?: string;
}) {
  const t = useTranslations('schedules');
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const pendingSave = useRef<AdminScheduleSaveInput | null>(null);
  const pendingDelete = useRef<AdminScheduleDeleteInput | null>(null);
  const [deleteReceipt, setDeleteReceipt] =
    useState<AdminScheduleDeleteInput | null>(null);
  const load = useCallback(
    async (signal: AbortSignal) => {
      const result = await fetchAdminSchedule(id, signal, actorKey);
      if (
        !signal.aborted &&
        !result.ok &&
        (result.code === 'UNAUTHENTICATED' || result.code === 'FORBIDDEN')
      ) {
        pendingSave.current = null;
        pendingDelete.current = null;
        setDeleteReceipt(null);
      }
      return result;
    },
    [id, actorKey],
  );
  const state = useScheduleResource(adminSchedulePath(id), load);
  const event = state.data;
  return (
    <main className={`app-shell onboarding-shell ${styles.screen}`}>
      <Link
        href={routes.adminSchedules}
        prefetch={false}
        onNavigate={state.clear}
        className="ui-button ui-button--secondary"
      >
        {t('backList')}
      </Link>
      <h1>{t('editTitle')}</h1>
      <Button
        variant="secondary"
        disabled={state.busy}
        onClick={() => {
          setSaved(false);
          void state.refresh();
        }}
      >
        {t('refresh')}
      </Button>
      {state.busy && <Loading label={t('loading')} />}
      {event && state.error && <p role="alert">{t(`errors.${state.error}`)}</p>}
      {!event && state.error && (
        <InlineError
          message={t(`errors.${state.error}`)}
          onRetry={state.refresh}
        />
      )}
      {!event && state.error === 'NOT_FOUND' && deleteReceipt && (
        <AdminScheduleDelete
          event={{
            id: deleteReceipt.schedule_id,
            revision: deleteReceipt.expected_revision,
          }}
          pendingOperation={pendingDelete}
          busy={state.busy}
          onDelete={async (input) => {
            setDeleteReceipt(input);
            const result = await state.execute((signal) =>
              deleteAdminSchedule(input, signal, actorKey),
            );
            if (
              result &&
              !result.ok &&
              (result.code === 'UNAUTHENTICATED' || result.code === 'FORBIDDEN')
            ) {
              pendingSave.current = null;
              pendingDelete.current = null;
              setDeleteReceipt(null);
            }
            if (result?.ok) {
              pendingDelete.current = null;
              setDeleteReceipt(null);
              state.clear();
              router.push(routes.adminSchedules);
            }
            return result;
          }}
        />
      )}
      {event && (
        <div className={styles.stack} key={event.revision}>
          {saved && <p role="status">{t('saved')}</p>}
          <h2>{event.title}</h2>
          <p>{t('revision', { revision: event.revision })}</p>
          {event.artist_status !== 'active' && (
            <p className={styles.notice}>{t('artistInactive')}</p>
          )}
          <ScheduleEditor
            event={event}
            pendingOperation={pendingSave}
            initial={{
              artist_id: event.artist_id,
              type: event.type,
              status: event.status,
              title: event.title,
              description: event.description,
              starts_at: event.starts_at,
              ends_at: event.ends_at,
              place_name: event.place_name,
              address: event.address,
              lat: event.lat,
              lng: event.lng,
            }}
            busy={state.busy}
            onCancel={() => void state.refresh()}
            onSave={async (input) => {
              setSaved(false);
              const result = await state.execute((signal) =>
                saveAdminSchedule(input, signal, actorKey),
              );
              if (
                result &&
                !result.ok &&
                (result.code === 'UNAUTHENTICATED' ||
                  result.code === 'FORBIDDEN')
              ) {
                pendingSave.current = null;
                pendingDelete.current = null;
                setDeleteReceipt(null);
              }
              if (result?.ok) {
                pendingSave.current = null;
                state.setData(result.data);
                setSaved(true);
              }
              return result;
            }}
          />
          <AdminScheduleDelete
            event={event}
            pendingOperation={pendingDelete}
            busy={state.busy}
            onDelete={async (input) => {
              setDeleteReceipt(input);
              const result = await state.execute((signal) =>
                deleteAdminSchedule(input, signal, actorKey),
              );
              if (
                result &&
                !result.ok &&
                (result.code === 'UNAUTHENTICATED' ||
                  result.code === 'FORBIDDEN')
              ) {
                pendingSave.current = null;
                pendingDelete.current = null;
                setDeleteReceipt(null);
              }
              if (result?.ok) {
                pendingDelete.current = null;
                setDeleteReceipt(null);
                state.clear();
                router.push(routes.adminSchedules);
              }
              return result;
            }}
          />
        </div>
      )}
    </main>
  );
}
