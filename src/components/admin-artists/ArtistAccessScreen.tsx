'use client';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  fetchArtistAccess,
  respondArtistInvitation,
} from '@/client/admin-artists';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { InlineError } from '@/components/ui/InlineError';
import { Loading } from '@/components/ui/Loading';
import type { ArtistInvitation } from '@/config/admin-artists';
import { artistAccessPath, routes } from '@/config/routes';
import { AdminArtistPagination } from './AdminArtistPagination';
import { adminArtistDate } from './ArtistPreviews';
import { useAdminResource } from './useAdminResource';
import styles from './admin-artists.module.css';

export function ArtistAccessScreen({
  page = 1,
}: {
  /** RSC remount identity only; never render this reusable navigation value. */
  identityId: string;
  page?: number;
}) {
  const t = useTranslations('adminArtists');
  const load = useCallback(
    (signal: AbortSignal) => fetchArtistAccess(signal, page),
    [page],
  );
  const state = useAdminResource(artistAccessPath(page), load);
  return (
    <main className={`app-shell onboarding-shell ${styles.screen}`}>
      <Link
        href={routes.home}
        prefetch={false}
        onNavigate={state.clear}
        className="ui-button ui-button--secondary"
      >
        {t('backHome')}
      </Link>
      <header>
        <h1>{t('accessTitle')}</h1>
        <p>{t('accessDescription')}</p>
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
      {state.data && (
        <>
          <Card title={t('identityLabel')}>
            <p>{state.data.user_id}</p>
            <p className="ui-hint">{t('identityHint')}</p>
          </Card>
          {!state.data.account_link_ready && (
            <p role="status">{t('linkDisabled')}</p>
          )}
          {state.data.has_more && (
            <p className="ui-hint">{t('boundedInvitations')}</p>
          )}
          {!state.data.invitations.length && <p>{t('accessEmpty')}</p>}
          <ul className={styles.list}>
            {state.data.invitations.map((invitation) => (
              <li
                key={`${invitation.id}:${invitation.revision}`}
                data-artist-access-id={invitation.id}
              >
                <AccessInvitation
                  invitation={invitation}
                  ready={state.data!.account_link_ready}
                  onRespond={(accept) => {
                    const body = {
                      invitation_id: invitation.id,
                      operation_id: crypto.randomUUID(),
                      expected_revision: invitation.revision,
                      accept,
                      confirmed: true as const,
                    };
                    return state.mutate((signal) =>
                      respondArtistInvitation(body, signal),
                    );
                  }}
                />
              </li>
            ))}
          </ul>
          <AdminArtistPagination
            page={page}
            hasMore={state.data.has_more}
            previous={artistAccessPath(page - 1)}
            next={artistAccessPath(page + 1)}
            onNavigate={state.clear}
          />
        </>
      )}
    </main>
  );
}
function AccessInvitation({
  invitation,
  ready,
  onRespond,
}: {
  invitation: ArtistInvitation;
  ready: boolean;
  onRespond: (accept: boolean) => Promise<unknown>;
}) {
  const t = useTranslations('adminArtists');
  const [confirmed, setConfirmed] = useState(false);
  return (
    <Card title={invitation.artist_name}>
      <p>{t(`linkState.${invitation.state}`)}</p>
      {invitation.state === 'accepted' && (
        <p className="ui-hint">{t('acceptedHistoryNote')}</p>
      )}
      <p>
        {t('memberRole', {
          role: t(invitation.is_manager ? 'memberManager' : 'memberArtist'),
        })}
      </p>
      <p>
        {t('linkExpires', { date: adminArtistDate(invitation.expires_at) })}
      </p>
      {invitation.state === 'pending' && (
        <>
          <Checkbox
            label={t('accessConfirm')}
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <div className={styles.actions}>
            <Button
              disabled={!confirmed || !ready}
              onClick={() => void onRespond(true)}
            >
              {t('accept')}
            </Button>
            <Button
              variant="secondary"
              disabled={!confirmed}
              onClick={() => void onRespond(false)}
            >
              {t('decline')}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
