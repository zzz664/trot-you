'use client';
import Link from 'next/link';
import { useCallback } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import { fetchCommunityPosts } from '@/client/community-posts';
import {
  communityBoardPath,
  communityPostPath,
  communityCreatePath,
  routes,
} from '@/config/routes';
import type { CommunityListQuery } from '@/config/community-posts';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Loading } from '@/components/ui/Loading';
import { InlineError } from '@/components/ui/InlineError';
import { useCommunityResource } from './useCommunityResource';
import styles from './community-posts.module.css';
export function CommunityBoard({
  query,
  actorKey,
  path,
}: {
  query: CommunityListQuery;
  actorKey: string;
  path: string;
}) {
  const t = useTranslations('communityPosts');
  const format = useFormatter();
  const load = useCallback(
    (signal: AbortSignal) => fetchCommunityPosts(query, signal, actorKey),
    [query, actorKey],
  );
  const state = useCommunityResource(path, load);
  const data = state.data;
  return (
    <main className={`app-shell ${styles.screen}`} aria-busy={state.busy}>
      <Link
        href={routes.artists}
        prefetch={false}
        onNavigate={state.clear}
        className="ui-button ui-button--secondary"
      >
        {t('backArtists')}
      </Link>
      <h1>{t('title')}</h1>
      <p>{t('description')}</p>
      <Button
        variant="secondary"
        disabled={state.busy}
        onClick={() => void state.refresh()}
      >
        {t('refresh')}
      </Button>
      {state.busy && <Loading label={t('loading')} />}
      {state.error && (
        <InlineError
          message={t(`errors.${state.error}`)}
          onRetry={state.refresh}
        />
      )}
      {data && (
        <div className={styles.stack} data-testid="community-post-list">
          <h2>{data.artist.name}</h2>
          <Link
            href={communityCreatePath(query.slug)}
            prefetch={false}
            onNavigate={state.clear}
            className="ui-button ui-button--primary"
          >
            {t('create')}
          </Link>
          {data.posts.length === 0 ? (
            <Card title={t('emptyTitle')}>
              <p>{t('emptyDescription')}</p>
            </Card>
          ) : (
            <ol className={styles.list} aria-label={t('posts')}>
              {data.posts.map((post) => (
                <li key={post.id} data-community-post-id={post.id}>
                  <Card title={post.title}>
                    <div className={styles.badges}>
                      {post.is_notice && <span>{t('noticeBadge')}</span>}
                      {post.is_pinned && <span>{t('pinnedBadge')}</span>}
                    </div>
                    <p>
                      {t('author', {
                        name: post.author.call_name ?? t('anonymousAuthor'),
                      })}
                    </p>
                    <p>
                      {t('createdAt', {
                        date: format.dateTime(new Date(post.created_at), {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        }),
                      })}
                    </p>
                    {post.image_count > 0 && (
                      <p>{t('imageCount', { count: post.image_count })}</p>
                    )}
                    <Link
                      href={communityPostPath(query.slug, post.id)}
                      prefetch={false}
                      onNavigate={state.clear}
                      className="ui-button ui-button--secondary"
                    >
                      {post.title}
                    </Link>
                  </Card>
                </li>
              ))}
            </ol>
          )}
          <nav className={styles.actions} aria-label={t('posts')}>
            {query.cursor && (
              <Link
                href={communityBoardPath(query.slug)}
                prefetch={false}
                onNavigate={state.clear}
                className="ui-button ui-button--secondary"
              >
                {t('firstPage')}
              </Link>
            )}
            {data.next_cursor ? (
              <Link
                href={communityBoardPath(
                  query.slug,
                  JSON.stringify(data.next_cursor),
                )}
                prefetch={false}
                onNavigate={state.clear}
                className="ui-button ui-button--secondary"
              >
                {t('nextPage')}
              </Link>
            ) : (
              data.posts.length > 0 && <p>{t('end')}</p>
            )}
          </nav>
        </div>
      )}
    </main>
  );
}
