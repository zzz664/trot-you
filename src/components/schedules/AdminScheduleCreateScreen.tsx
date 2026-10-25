'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { saveAdminSchedule, fetchScheduleArtists } from '@/client/schedules';
import type { AdminScheduleSaveInput } from '@/config/schedules';
import { routes, adminSchedulePath } from '@/config/routes';
import { Loading } from '@/components/ui/Loading';
import { InlineError } from '@/components/ui/InlineError';
import { useScheduleResource } from './useScheduleResource';
import { ScheduleEditor } from './ScheduleEditor';
import styles from './schedules.module.css';
export function AdminScheduleCreateScreen({ actorKey }: { actorKey?: string }) {
  const t = useTranslations('schedules');
  const router = useRouter();
  const pendingOperation = useRef<AdminScheduleSaveInput | null>(null);
  const readArtists = useCallback(
    async (page: number, signal: AbortSignal) => {
      const result = await fetchScheduleArtists(page, signal, actorKey);
      if (
        !signal.aborted &&
        !result.ok &&
        (result.code === 'UNAUTHENTICATED' || result.code === 'FORBIDDEN')
      )
        pendingOperation.current = null;
      return result;
    },
    [actorKey],
  );
  const load = useCallback(
    (signal: AbortSignal) => readArtists(1, signal),
    [readArtists],
  );
  const state = useScheduleResource(adminSchedulePath('new'), load);
  function cancel() {
    state.clear();
    router.push(routes.adminSchedules);
  }
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
      <h1>{t('createTitle')}</h1>
      {state.busy && <Loading label={t('loading')} />}
      {state.data && state.error && (
        <p role="alert">{t(`errors.${state.error}`)}</p>
      )}
      {!state.data && state.error && (
        <InlineError
          message={t(`errors.${state.error}`)}
          onRetry={state.refresh}
        />
      )}
      {state.data && (
        <ScheduleEditor
          event={null}
          pendingOperation={pendingOperation}
          initial={{
            artist_id: '',
            type: 'event',
            status: 'draft',
            title: '',
            description: null,
            starts_at: '',
            ends_at: null,
            place_name: null,
            address: null,
            lat: null,
            lng: null,
          }}
          initialArtists={state.data}
          busy={state.busy}
          onCancel={cancel}
          onArtistPage={(page) =>
            state.execute((signal) => readArtists(page, signal))
          }
          onSave={async (input) => {
            const result = await state.execute((signal) =>
              saveAdminSchedule(input, signal, actorKey),
            );
            if (
              result &&
              !result.ok &&
              (result.code === 'UNAUTHENTICATED' || result.code === 'FORBIDDEN')
            )
              pendingOperation.current = null;
            if (result?.ok) {
              pendingOperation.current = null;
              state.clear();
              router.push(adminSchedulePath(result.data.id));
            }
            return result;
          }}
        />
      )}
    </main>
  );
}
