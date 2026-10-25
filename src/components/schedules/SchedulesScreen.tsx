'use client';
import Link from 'next/link';
import { useCallback, useState, useMemo, type CSSProperties } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { fetchSchedules } from '@/client/schedules';
import { SCHEDULES, type ScheduleQuery } from '@/config/schedules';
import { routes, scheduleDetailPath } from '@/config/routes';
import {
  scheduleDayKeys,
  scheduleMonthDays,
  scheduleLocalDayStart,
  scheduleMonthIntervals,
} from '@/lib/schedule-view';
import { Button } from '@/components/ui/Button';
import { Checkbox, RadioGroup } from '@/components/ui/Checkbox';
import { Loading } from '@/components/ui/Loading';
import { InlineError } from '@/components/ui/InlineError';
import { MonthNavigation } from './MonthNavigation';
import { ScheduleCard } from './ScheduleCard';
import { useScheduleResource } from './useScheduleResource';
import styles from './schedules.module.css';
export function SchedulesScreen({
  query,
  path,
  actorKey,
}: {
  query: ScheduleQuery;
  path: string;
  actorKey?: string;
}) {
  const t = useTranslations('schedules');
  const format = useFormatter();
  const load = useCallback(
    (signal: AbortSignal) => fetchSchedules(query, signal, actorKey),
    [query, actorKey],
  );
  const state = useScheduleResource(path, load);
  const [mine, setMine] = useState(false);
  const [view, setView] = useState<'month' | 'list'>('month');
  const data = state.data;
  const items =
    data?.items.filter(
      (event) => !mine || data.myArtistIds.includes(event.artist_id),
    ) ?? [];
  const days = scheduleMonthDays(query.month);
  const intervals = useMemo(
    () => scheduleMonthIntervals(query.month),
    [query.month],
  );
  const eventDays = new Map(
    items.map((event) => [
      event.id,
      scheduleDayKeys(event, query.month, intervals),
    ]),
  );
  async function more() {
    if (!data?.nextCursor) return;
    const result = await state.execute((signal) =>
      fetchSchedules(
        { month: query.month, cursor: data.nextCursor },
        signal,
        actorKey,
      ),
    );
    if (result?.ok) {
      const seen = new Set(data.items.map((event) => event.id));
      state.setData({
        ...result.data,
        items: [
          ...data.items,
          ...result.data.items.filter((event) => !seen.has(event.id)),
        ],
      });
    }
  }
  return (
    <main className={`app-shell ${styles.screen} ${styles.calendarScreen}`}>
      <Link
        href={routes.home}
        prefetch={false}
        onNavigate={state.clear}
        className="ui-button ui-button--secondary"
      >
        {t('back')}
      </Link>
      <header>
        <h1>{t('title')}</h1>
        <p>{t('description')}</p>
        <p className="ui-hint">{t('timeZone')}</p>
      </header>
      <MonthNavigation month={query.month} onNavigate={state.clear} />
      <RadioGroup
        label={t('viewLabel')}
        value={view}
        onChange={setView}
        options={[
          { value: 'month', label: t('monthView') },
          { value: 'list', label: t('listView') },
        ]}
      />
      <Checkbox
        label={t('mineOnly')}
        hint={t('mineHint')}
        checked={mine}
        onChange={(event) => setMine(event.target.checked)}
      />
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
        <>
          <p role="status">{t('loaded', { count: items.length })}</p>
          {data.nextCursor && <p className={styles.notice}>{t('partial')}</p>}
          {!items.length && <p>{t(mine ? 'mineEmpty' : 'empty')}</p>}
          {view === 'list' ? (
            <ul className={styles.list} data-testid="schedule-list">
              {items.map((event) => (
                <li key={event.id}>
                  <ScheduleCard
                    event={event}
                    month={query.month}
                    onNavigate={state.clear}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <ol
              className={styles.calendar}
              data-testid="schedule-calendar"
              style={
                {
                  '--calendar-start':
                    new Date(`${query.month}-01T00:00:00Z`).getUTCDay() + 1,
                } as CSSProperties
              }
            >
              {days.map((day) => {
                const events = items.filter((event) =>
                  eventDays.get(event.id)?.includes(day),
                );
                return (
                  <li key={day} className={styles.day} data-schedule-day={day}>
                    <h3>
                      {format.dateTime(new Date(scheduleLocalDayStart(day)), {
                        month: 'numeric',
                        day: 'numeric',
                        weekday: 'short',
                        timeZone: SCHEDULES.timeZone,
                      })}
                    </h3>
                    {events.length ? (
                      <ul className={styles.dayEvents}>
                        {events.map((event) => (
                          <li key={event.id}>
                            <Link
                              href={scheduleDetailPath(event.id, query.month)}
                              prefetch={false}
                              onNavigate={state.clear}
                              aria-label={t('openDetail', {
                                title: event.title,
                              })}
                            >
                              {event.artist_name} · {event.title}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="ui-hint">{t('noScheduleDay')}</p>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
          {data.nextCursor && (
            <Button disabled={state.busy} onClick={() => void more()}>
              {t('more')}
            </Button>
          )}
        </>
      )}
    </main>
  );
}
