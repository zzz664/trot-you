'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { fetchAdminArtists, saveAdminArtist } from '@/client/admin-artists';
import { Button } from '@/components/ui/Button';
import { InlineError } from '@/components/ui/InlineError';
import { Loading } from '@/components/ui/Loading';
import { adminArtistPath, routes } from '@/config/routes';
import { ArtistEditor } from './ArtistEditor';
import { useAdminResource } from './useAdminResource';
import styles from './admin-artists.module.css';

export function AdminArtistCreateScreen() {
  const t = useTranslations('adminArtists');
  const router = useRouter();
  const [createdId, setCreatedId] = useState<string | null>(null);
  const load = useCallback(
    (signal: AbortSignal) => fetchAdminArtists(1, signal),
    [],
  );
  const state = useAdminResource(adminArtistPath('new'), load);
  return (
    <main className={`app-shell onboarding-shell ${styles.screen}`}>
      <Link
        href={routes.adminArtists}
        prefetch={false}
        onNavigate={state.clear}
        className="ui-button ui-button--secondary"
      >
        {t('backList')}
      </Link>
      <h1>{t('createTitle')}</h1>
      {state.busy && <Loading label={t('loading')} />}
      {state.error && (
        <>
          <InlineError
            message={t(`errors.${state.error}`)}
            onRetry={state.refresh}
          />
          <p className="ui-hint">{t('uncertain')}</p>
          {createdId && (
            <Link
              href={adminArtistPath(createdId)}
              prefetch={false}
              onNavigate={state.clear}
              className="ui-button ui-button--secondary"
            >
              {t('creationCheck')}
            </Link>
          )}
        </>
      )}
      {state.error === 'UNAUTHENTICATED' && (
        <Link
          href={routes.start}
          prefetch={false}
          onNavigate={state.clear}
          className="ui-button ui-button--primary"
        >
          {t('signIn')}
        </Link>
      )}
      {state.data && (
        <ArtistEditor
          create
          initial={{
            slug: '',
            name: '',
            intro: null,
            status: 'draft',
            grade: 'B',
            agency_name: null,
            contract_started_at: null,
            contract_ended_at: null,
            display_order: 0,
          }}
          onCancel={() => {
            state.clear();
            router.push(routes.adminArtists);
          }}
          onSave={async (input) => {
            const id = createdId ?? crypto.randomUUID();
            setCreatedId(id);
            const body = {
              artist_id: id,
              operation_id: crypto.randomUUID(),
              expected_revision: 0,
              input,
            };
            const saved = await state.mutate((signal) =>
              saveAdminArtist(body, signal),
            );
            if (saved) {
              state.clear();
              router.push(adminArtistPath(id));
            }
          }}
        />
      )}
      {!state.data && !state.busy && !state.error && (
        <Button onClick={() => void state.refresh()}>{t('refresh')}</Button>
      )}
    </main>
  );
}
