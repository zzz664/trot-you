'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { InlineError } from '@/components/ui/InlineError';
import { Loading } from '@/components/ui/Loading';
import { APP_LOCALE } from '@/config/constants';
import { ACTIVITY_TIME_ZONE } from '@/config/artist-reply-activity';
import { artistReplyActivityPath, routes } from '@/config/routes';
import { useArtistReplyActivity } from './useArtistReplyActivity';
import styles from './artist-reply-activity.module.css';

function activityDate(value: string) {
  return new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone: ACTIVITY_TIME_ZONE,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}

function weekDate(value: string) {
  // These are KST calendar dates, not UTC instants. Show the date separately
  // from the translated midnight boundary rather than inventing a 09:00 time.
  return new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone: ACTIVITY_TIME_ZONE,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(value));
}

export function ArtistReplyActivityScreen({
  slug,
  name,
  messageId,
  cursor,
}: {
  slug: string;
  name: string;
  messageId: string | null;
  cursor: string | null;
}) {
  const t = useTranslations('artistReplyActivity');
  const kinds = useTranslations('artistCompose.kinds');
  const state = useArtistReplyActivity({ slug, messageId, cursor });
  const [pickerExpanded, setPickerExpanded] = useState(false);
  const pickerId = useId();
  const page = state.page;
  const accessLost =
    state.error === 'FORBIDDEN' || state.error === 'UNAUTHENTICATED';
  function metric(count: number, minimum: number | null) {
    return minimum === null
      ? t('metricCount', { count })
      : t('metricProgress', { count, minimum });
  }
  return (
    <main className="app-shell">
      <Link
        href={routes.artistReplyActivityMenu}
        prefetch={false}
        onNavigate={state.clear}
        className="ui-button ui-button--secondary"
      >
        {t('backToArtists')}
      </Link>
      <h1>{t('title', { name })}</h1>
      <p>{t('privacyNotice')}</p>
      <div className={styles.actions}>
        <Button variant="secondary" onClick={() => void state.refresh()}>
          {t('refresh')}
        </Button>
      </div>
      {state.busy && <Loading label={t('loading')} />}
      {state.error && (
        <InlineError
          message={accessLost ? t('accessLost') : t(`errors.${state.error}`)}
          onRetry={state.refresh}
        />
      )}
      {page && (
        <>
          <Card title={t('activityTitle')}>
            <p>
              {t('weekRange', {
                start: weekDate(page.activity.weekStart),
                end: weekDate(page.activity.weekEnd),
              })}
            </p>
            <dl className={styles.metrics}>
              <div className={styles.metric} data-activity-metric="message">
                <dt>{t('messageMetric')}</dt>
                <dd>
                  {metric(
                    page.activity.messageCount,
                    page.activity.weeklyMessageMin,
                  )}
                </dd>
              </div>
              <div className={styles.metric} data-activity-metric="photo">
                <dt>{t('photoMetric')}</dt>
                <dd>
                  {metric(
                    page.activity.photoCount,
                    page.activity.weeklyPhotoMin,
                  )}
                </dd>
              </div>
            </dl>
            {!page.activity.requirementsReady && (
              <p className="ui-hint">{t('requirementsUnavailable')}</p>
            )}
            <p className="ui-hint">{t('activityNotice')}</p>
            <p className="ui-hint">{t('activityProvisional')}</p>
            <p className="ui-hint">
              {t('asOf', { date: activityDate(page.serverNow) })}
            </p>
          </Card>
          <Card title={t('filterTitle')}>
            <p>{t('filterDescription')}</p>
            {messageId ? (
              <>
                <p>{t('messageSelected')}</p>
                {page.selectedMessage && (
                  <p>
                    {t('messageFilter', {
                      date: activityDate(page.selectedMessage.sentAt),
                      kind: kinds(page.selectedMessage.kind),
                    })}
                  </p>
                )}
                <Link
                  href={artistReplyActivityPath(slug)}
                  prefetch={false}
                  onNavigate={state.clear}
                  className="ui-button ui-button--secondary"
                >
                  {t('allReplies')}
                </Link>
              </>
            ) : (
              <p>{t('allSelected')}</p>
            )}
            <Button
              variant="secondary"
              ariaExpanded={pickerExpanded}
              ariaControls={pickerId}
              onClick={() => setPickerExpanded((expanded) => !expanded)}
            >
              {t(pickerExpanded ? 'closeMessages' : 'openMessages')}
            </Button>
            <div id={pickerId} hidden={!pickerExpanded}>
              {pickerExpanded && state.messages && (
                <div className={styles.stack}>
                  {state.messages.messages.length === 0 && (
                    <p>{t('noMessages')}</p>
                  )}
                  <ul className={styles.list}>
                    {state.messages.messages.map((message) => (
                      <li
                        key={message.id}
                        data-activity-message-id={message.id}
                      >
                        {message.id === messageId ? (
                          <p aria-current="true">
                            {t('messageFilter', {
                              date: activityDate(message.sentAt),
                              kind: kinds(message.kind),
                            })}
                          </p>
                        ) : (
                          <Link
                            href={artistReplyActivityPath(slug, message.id)}
                            prefetch={false}
                            onNavigate={state.clear}
                            className="ui-button ui-button--secondary"
                          >
                            {t('messageFilter', {
                              date: activityDate(message.sentAt),
                              kind: kinds(message.kind),
                            })}
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                  <div className={styles.actions}>
                    {state.messages.nextCursor && (
                      <Button
                        variant="secondary"
                        disabled={state.busy}
                        onClick={() =>
                          void state.readMessages(state.messages!.nextCursor)
                        }
                      >
                        {t('olderMessages')}
                      </Button>
                    )}
                    {state.messageCursor && (
                      <Button
                        variant="secondary"
                        disabled={state.busy}
                        onClick={() => void state.readMessages(null)}
                      >
                        {t('firstMessages')}
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </Card>
          <Card title={t('repliesTitle')}>
            <p className="ui-hint">{t('repliesNotice')}</p>
            {page.replies.length === 0 && (
              <p>{t(messageId ? 'filteredEmpty' : 'repliesEmpty')}</p>
            )}
            <ul className={styles.list}>
              {page.replies.map((reply) => (
                <li key={reply.id} data-activity-reply-id={reply.id}>
                  <article className="ui-card">
                    <h3>{t('replyFrom', { name: reply.callName })}</h3>
                    <p className={styles.body}>{reply.body}</p>
                    <p className="ui-hint">
                      <time dateTime={reply.createdAt}>
                        {t('repliedAt', {
                          date: activityDate(reply.createdAt),
                        })}
                      </time>
                    </p>
                    <p className="ui-hint">
                      {t(reply.messageId ? 'messageReply' : 'generalReply')}
                    </p>
                  </article>
                </li>
              ))}
            </ul>
            <div className={styles.actions}>
              {page.nextCursor && (
                <Link
                  href={artistReplyActivityPath(
                    slug,
                    messageId ?? undefined,
                    page.nextCursor,
                  )}
                  prefetch={false}
                  onNavigate={state.clear}
                  className="ui-button ui-button--secondary"
                >
                  {t('moreReplies')}
                </Link>
              )}
              {cursor && (
                <Link
                  href={artistReplyActivityPath(slug, messageId ?? undefined)}
                  prefetch={false}
                  onNavigate={state.clear}
                  className="ui-button ui-button--secondary"
                >
                  {t('firstReplies')}
                </Link>
              )}
            </div>
          </Card>
        </>
      )}
    </main>
  );
}
