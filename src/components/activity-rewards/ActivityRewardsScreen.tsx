'use client';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { ACTIVITY_REWARDS } from '@/config/activity-rewards';
import { routes } from '@/config/routes';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { InlineError } from '@/components/ui/InlineError';
import { Loading } from '@/components/ui/Loading';
import { useActivityRewards } from './useActivityRewards';
import styles from './activity-rewards.module.css';

export function ActivityRewardsScreen({ actorKey }: { actorKey: string }) {
  return <ActivitySession key={actorKey} actorKey={actorKey} />;
}
function ActivitySession({ actorKey }: { actorKey: string }) {
  const t = useTranslations('activityRewards');
  const format = useFormatter();
  const state = useActivityRewards(actorKey);
  const data = state.data;
  return (
    <main className={`app-shell ${styles.screen}`} aria-busy={state.busy}>
      <Link
        href={routes.points}
        prefetch={false}
        onNavigate={state.clear}
        className="ui-button ui-button--secondary"
      >
        {t('backPoints')}
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
        <div className={styles.stack} data-testid="activity-rewards-content">
          <p>{t('kstDay', { date: data.kst_date })}</p>
          <p>{t('snapshotNotice')}</p>
          {data.contribution_policy ? (
            <>
              <p>
                {t('policyVersion', {
                  version: data.contribution_policy.version,
                })}
              </p>
              {(['post', 'comment'] as const).map((reason) => {
                const rule = data.contribution_policy![reason];
                return (
                  <Card key={reason} title={t(`reasons.${reason}`)}>
                    <p>
                      {t('configuredAward', {
                        amount: format.number(rule.amount),
                      })}
                    </p>
                    <p>
                      {rule.daily_cap === null
                        ? t('unlimitedCap')
                        : t('dailyCap', {
                            count: format.number(rule.daily_cap),
                          })}
                    </p>
                    <p>
                      {t('recordedCount', { count: format.number(rule.used) })}
                    </p>
                    <p>
                      {t('awardedCount', {
                        count: format.number(rule.awarded),
                      })}
                    </p>
                    <p>
                      {rule.remaining === null
                        ? t('unlimitedRemaining')
                        : t('remainingCount', {
                            count: format.number(rule.remaining),
                          })}
                    </p>
                  </Card>
                );
              })}
              <p>{t('retainedHistory')}</p>
            </>
          ) : (
            <Card title={t('policyTitle')}>
              <p>{t('policyUnavailable')}</p>
            </Card>
          )}
          <section
            className={styles.stack}
            aria-labelledby="activity-pending-title"
          >
            <h2 id="activity-pending-title">{t('pendingTitle')}</h2>
            <Card title={t('shareTitle')}>
              <p>{t('shareUnavailable')}</p>
            </Card>
            <Card title={t('missionsTitle')}>
              <p>{t('missionsUnavailable')}</p>
            </Card>
            <Card title={t('gradeTitle')}>
              <p>{t('gradeUnavailable')}</p>
            </Card>
          </section>
          <section
            className={styles.stack}
            aria-labelledby="activity-history-title"
          >
            <h2 id="activity-history-title">{t('historyTitle')}</h2>
            <p>{t('historyPrivacy')}</p>
            {data.entries.length === 0 && <p>{t('emptyHistory')}</p>}
            <ol className={styles.list}>
              {data.entries.map((entry) => (
                <li key={entry.id} data-activity-entry-id={entry.id}>
                  <article className={styles.panel}>
                    <h3>{t(`reasons.${entry.reason}`)}</h3>
                    <p>
                      {t('entryAmount', {
                        amount: format.number(entry.amount, {
                          signDisplay: 'exceptZero',
                        }),
                      })}
                    </p>
                    <p>{t(`outcomes.${entry.outcome}`)}</p>
                    <p>{t('earnedDate', { date: entry.earned_on })}</p>
                    <p>
                      {t('recordedDate', {
                        date: format.dateTime(new Date(entry.created_at), {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                          timeZone: ACTIVITY_REWARDS.timeZone,
                        }),
                      })}
                    </p>
                  </article>
                </li>
              ))}
            </ol>
            {data.next_cursor && (
              <Button
                variant="secondary"
                disabled={state.busy}
                onClick={() => void state.more()}
              >
                {t('loadMore')}
              </Button>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
