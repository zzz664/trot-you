'use client';
import Link from 'next/link';
import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import {
  fetchAdminArtist,
  saveAdminArtist,
  saveAdminPreviews,
  inviteArtistAccount,
  cancelArtistInvitation,
  unlinkArtistAccount,
} from '@/client/admin-artists';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { InlineError } from '@/components/ui/InlineError';
import { Loading } from '@/components/ui/Loading';
import type { AdminArtistInput } from '@/config/admin-artists';
import { adminArtistPath, routes } from '@/config/routes';
import { AdminArtistPagination } from './AdminArtistPagination';
import { ArtistEditor } from './ArtistEditor';
import { ArtistPreviews } from './ArtistPreviews';
import { ArtistAccounts } from './ArtistAccounts';
import { useAdminResource } from './useAdminResource';
import styles from './admin-artists.module.css';

export function AdminArtistDetailScreen({
  id,
  page = 1,
}: {
  id: string;
  page?: number;
}) {
  const t = useTranslations('adminArtists');
  const load = useCallback(
    (signal: AbortSignal) => fetchAdminArtist(id, signal, page),
    [id, page],
  );
  const state = useAdminResource(adminArtistPath(id, page), load);
  const detail = state.data;
  const artist = detail?.artist;
  const base = () => ({
    artist_id: id,
    operation_id: crypto.randomUUID(),
    expected_revision: artist!.revision,
  });
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
      <header>
        <h1>{t('editTitle')}</h1>
        {artist && <p>{artist.name}</p>}
      </header>
      <Button
        variant="secondary"
        disabled={state.busy}
        onClick={() => void state.refresh()}
      >
        {t('refresh')}
      </Button>
      {state.busy && <Loading label={t('loading')} />}
      {state.error && (
        <>
          <InlineError
            message={t(`errors.${state.error}`)}
            onRetry={state.refresh}
          />
          <p className="ui-hint">{t('uncertain')}</p>
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
      {detail && artist && (
        <div className={styles.stack} key={`${artist.revision}:${page}`}>
          <p className="ui-hint">{t('sharedPageNote')}</p>
          <p className="ui-hint">{t('pageSaveNote')}</p>
          <Card title={artist.name}>
            <ArtistEditor
              create={false}
              initial={artist}
              onCancel={() => void state.refresh()}
              onSave={(input: AdminArtistInput) => {
                const body = { ...base(), input };
                return state.mutate((signal) => saveAdminArtist(body, signal));
              }}
            />
          </Card>
          <ArtistPreviews
            detail={detail}
            onSave={(message_ids) => {
              const body = { ...base(), message_ids };
              return state.mutate((signal) => saveAdminPreviews(body, signal));
            }}
          />
          <ArtistAccounts
            detail={detail}
            onInvite={(target_user_id, is_manager) => {
              const body = {
                ...base(),
                target_user_id,
                is_manager,
                confirmed: true as const,
              };
              return state.mutate((signal) =>
                inviteArtistAccount(body, signal),
              );
            }}
            onCancel={(invitation) => {
              const body = {
                invitation_id: invitation.id,
                operation_id: crypto.randomUUID(),
                expected_revision: invitation.revision,
                confirmed: true as const,
              };
              return state.mutate((signal) =>
                cancelArtistInvitation(body, signal),
              );
            }}
            onUnlink={(target_user_id) => {
              const body = {
                ...base(),
                target_user_id,
                confirmed: true as const,
              };
              return state.mutate((signal) =>
                unlinkArtistAccount(body, signal),
              );
            }}
          />
          <AdminArtistPagination
            page={page}
            hasMore={
              detail.messages_has_more ||
              detail.members_has_more ||
              detail.invitations_has_more
            }
            previous={adminArtistPath(id, page - 1)}
            next={adminArtistPath(id, page + 1)}
            onNavigate={state.clear}
          />
        </div>
      )}
    </main>
  );
}
