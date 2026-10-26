'use client';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { ATTENDANCE_POINTS } from '@/config/attendance-points';
import { routes } from '@/config/routes';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { InlineError } from '@/components/ui/InlineError';
import { Loading } from '@/components/ui/Loading';
import { useAttendancePoints } from './useAttendancePoints';
import styles from './attendance-points.module.css';

export function AttendancePointsScreen({ actorKey }: { actorKey: string }) {
  return <AttendanceSession key={actorKey} actorKey={actorKey} />;
}
function AttendanceSession({ actorKey }: { actorKey: string }) {
  const t = useTranslations('attendancePoints');
  const activity = useTranslations('activityRewards');
  const format = useFormatter();
  const state = useAttendancePoints(actorKey);
  const data = state.data;
  const pending = state.busy || state.mutating;
  return (
    <main className={`app-shell ${styles.screen}`} aria-busy={pending}>
      <Link
        href={routes.home}
        prefetch={false}
        onNavigate={state.clear}
        className="ui-button ui-button--secondary"
      >
        {t('backHome')}
      </Link>
      <h1>{t('title')}</h1>
      <p>{t('description')}</p>
      <Link
        href={routes.activityRewards}
        prefetch={false}
        onNavigate={state.clear}
        className="ui-button ui-button--secondary"
      >
        {activity('entryOpen')}
      </Link>
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() => void state.refresh()}
      >
        {t('refresh')}
      </Button>
      {pending && <Loading label={t('loading')} />}
      {state.error && (
        <InlineError
          message={t(`errors.${state.error}`)}
          onRetry={state.refresh}
        />
      )}
      {state.mutationError && (
        <p role="alert">{t(`errors.${state.mutationError}`)}</p>
      )}
      {state.uncertain && (
        <section
          className={styles.panel}
          data-testid="attendance-points-recovery"
        >
          <h2>{t('uncertainTitle')}</h2>
          <p role="status">{t('uncertainDescription')}</p>
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => void state.recover()}
          >
            {t('recoverAttendance')}
          </Button>
        </section>
      )}
      {state.receipt && (
        <p role="status" data-testid="attendance-points-receipt">
          {t('savedReceipt', {
            date: state.receipt.earned_on,
            amount: format.number(state.receipt.amount),
          })}
        </p>
      )}
      {data && (
        <div className={styles.stack} data-testid="attendance-points-content">
          <Card title={t('balanceTitle')}>
            <p className={styles.balance}>
              {t('balanceValue', { amount: format.number(data.balance) })}
            </p>
            <p>{t('balanceDescription')}</p>
          </Card>
          <Card title={t('attendanceTitle')}>
            <p>{t('kstDay', { date: data.kst_date })}</p>
            <p>{t('attendanceRule')}</p>
            {data.attendance_amount === null ? (
              <p>{t('policyUnavailable')}</p>
            ) : (
              <p>
                {t('configuredAward', {
                  amount: format.number(data.attendance_amount),
                })}
              </p>
            )}
            <Button
              disabled={
                pending ||
                state.uncertain ||
                data.attendance_entry_id !== null ||
                data.attendance_amount === null
              }
              onClick={() => void state.attend()}
            >
              {t(
                data.attendance_entry_id
                  ? 'checkedAttendance'
                  : 'checkAttendance',
              )}
            </Button>
          </Card>
          <section
            className={styles.stack}
            aria-labelledby="point-history-title"
          >
            <h2 id="point-history-title">{t('historyTitle')}</h2>
            <p>{t('historyPrivacy')}</p>
            {data.entries.length === 0 && <p>{t('emptyHistory')}</p>}
            <ol className={styles.list}>
              {data.entries.map((entry) => (
                <li key={entry.id} data-point-entry-id={entry.id}>
                  <article className={styles.panel}>
                    <h3>{t(`reasons.${entry.reason}`)}</h3>
                    <p>
                      {t('entryAmount', {
                        amount: format.number(entry.amount, {
                          signDisplay: 'exceptZero',
                        }),
                      })}
                    </p>
                    <p>{t('earnedDate', { date: entry.earned_on })}</p>
                    <p>
                      {t('recordedDate', {
                        date: format.dateTime(new Date(entry.created_at), {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                          timeZone: ATTENDANCE_POINTS.timeZone,
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
                disabled={pending}
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
