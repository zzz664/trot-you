'use client';
import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { fetchModerationNotices } from '@/client/community-moderation';
import {
  COMMUNITY_MODERATION,
  type ModerationCursor,
} from '@/config/community-moderation';
import { routes } from '@/config/routes';
import { Button } from '@/components/ui/Button';
import { InlineError } from '@/components/ui/InlineError';
import { Loading } from '@/components/ui/Loading';
import { useCommunityResource } from '@/components/community-posts/useCommunityResource';
import styles from './community-moderation.module.css';
export function ModerationNoticesScreen({ actorKey }: { actorKey: string }) {
  return <NoticesSession key={actorKey} actorKey={actorKey} />;
}
function NoticesSession({ actorKey }: { actorKey: string }) {
  const t = useTranslations('communityModeration');
  const errors = useTranslations('communityPosts.errors');
  const format = useFormatter();
  const cursor = useRef<ModerationCursor | null>(null);
  const [pageCursor, setPageCursor] = useState<ModerationCursor | null>(null);
  const load = useCallback(
    (signal: AbortSignal) =>
      fetchModerationNotices(cursor.current, signal, actorKey),
    [actorKey],
  );
  const state = useCommunityResource(routes.communityReports, load);
  function page(next: ModerationCursor | null) {
    if (state.busy) return;
    cursor.current = next;
    setPageCursor(next);
    void state.refresh();
  }
  return (
    <main className={`app-shell ${styles.screen}`} aria-busy={state.busy}>
      <Link
        href={routes.home}
        prefetch={false}
        onNavigate={state.clear}
        className="ui-button ui-button--secondary"
      >
        {t('backHome')}
      </Link>
      <h1>{t('inboxTitle')}</h1>
      <p>{t('inboxDescription')}</p>
      <Button
        variant="secondary"
        disabled={state.busy}
        onClick={() => void state.refresh()}
      >
        {t('refresh')}
      </Button>
      {state.busy && <Loading label={t('loading')} />}
      {state.error && (
        <InlineError message={errors(state.error)} onRetry={state.refresh} />
      )}
      {state.data && (
        <section
          className={styles.stack}
          data-testid="community-report-notices"
        >
          {state.data.notices.length === 0 && <p>{t('emptyNotices')}</p>}
          <ol className={styles.list}>
            {state.data.notices.map((notice) => (
              <li key={notice.id} data-moderation-notice-id={notice.id}>
                <article className={styles.panel}>
                  <h2>
                    {t(
                      notice.decision === 'restored'
                        ? 'noticeRestored'
                        : 'noticeDeleted',
                    )}
                  </h2>
                  <p>
                    {t('noticeDate', {
                      date: format.dateTime(new Date(notice.created_at), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                        timeZone: COMMUNITY_MODERATION.timeZone,
                      }),
                    })}
                  </p>
                  <p>{t('noticePrivacy')}</p>
                </article>
              </li>
            ))}
          </ol>
          <nav className={styles.actions}>
            {pageCursor && (
              <Button
                variant="secondary"
                disabled={state.busy}
                onClick={() => page(null)}
              >
                {t('firstPage')}
              </Button>
            )}
            {state.data.next_cursor && (
              <Button
                variant="secondary"
                disabled={state.busy}
                onClick={() => page(state.data!.next_cursor)}
              >
                {t('nextNotices')}
              </Button>
            )}
          </nav>
        </section>
      )}
    </main>
  );
}
