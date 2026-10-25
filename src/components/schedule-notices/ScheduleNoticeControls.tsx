'use client';
import Link from 'next/link';
import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import {
  fetchScheduleNoticePreferences,
  saveScheduleNoticePreference,
  saveScheduleNoticeEvent,
} from '@/client/schedule-notices';
import { routes } from '@/config/routes';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Loading } from '@/components/ui/Loading';
import { InlineError } from '@/components/ui/InlineError';
import { useScheduleResource } from '@/components/schedules/useScheduleResource';

export function ScheduleNoticeControls({
  scheduleId = null,
  path,
  actorKey,
}: {
  scheduleId?: string | null;
  path: string;
  actorKey?: string | undefined;
}) {
  const t = useTranslations('scheduleNotices');
  const load = useCallback(
    (signal: AbortSignal) =>
      fetchScheduleNoticePreferences(scheduleId, signal, actorKey),
    [scheduleId, actorKey],
  );
  const state = useScheduleResource(path, load);
  const data = state.data;
  async function save(kind: 'global' | 'event', enabled: boolean) {
    // Send a desired value, not a server-side toggle. A repeated/interrupted
    // request cannot invert a preference and never auto-retries an uncertain write.
    const result = await state.execute(async (signal) => {
      const updated = await (kind === 'global'
        ? saveScheduleNoticePreference(enabled, signal, actorKey)
        : saveScheduleNoticeEvent(scheduleId!, enabled, signal, actorKey));
      if (!updated.ok) return updated;
      // The global RPC preserves other preferences and returns only its global
      // projection. Re-read event eligibility rather than retaining a stale value.
      return kind === 'global' && scheduleId !== null ? load(signal) : updated;
    });
    if (result?.ok) state.setData(result.data);
    else if (result) state.setData(null);
  }
  return (
    <section
      className="onboarding-stack"
      data-testid="schedule-notice-controls"
      aria-label={t('regionLabel')}
    >
      {state.busy && <Loading label={t('loading')} />}
      {state.error && (
        <InlineError
          message={t(`errors.${state.error}`)}
          onRetry={state.refresh}
        />
      )}
      {data && (
        <>
          <Card title={t('title')}>
            <p>{t('description')}</p>
            <p data-schedule-preference={String(data.scheduleEnabled)}>
              {t(data.scheduleEnabled ? 'preferenceOn' : 'preferenceOff')}
            </p>
            <Button
              variant="secondary"
              disabled={state.busy}
              onClick={() => void save('global', !data.scheduleEnabled)}
            >
              {t(
                data.scheduleEnabled ? 'disablePreference' : 'enablePreference',
              )}
            </Button>
            <p className="ui-hint">
              {data.configured && data.hourKst !== null
                ? t('timing', { hour: data.hourKst })
                : t('notConfigured')}
            </p>
            <p className="ui-hint">
              {t(data.webpushEnabled ? 'pushOn' : 'pushOff')}
            </p>
            <p className="ui-hint">{t('deliveryMeaning')}</p>
            <Link
              href={routes.notifications}
              prefetch={false}
              onNavigate={state.clear}
              className="ui-button ui-button--secondary"
            >
              {t('deviceSettings')}
            </Link>
          </Card>
          {scheduleId !== null && data.eventEnabled !== null && (
            <Card title={t('eventTitle')}>
              <p data-schedule-event-enabled={String(data.eventEnabled)}>
                {t(data.eventEnabled ? 'eventOn' : 'eventOff')}
              </p>
              <Button
                variant="secondary"
                disabled={state.busy}
                onClick={() => void save('event', !data.eventEnabled)}
              >
                {t(data.eventEnabled ? 'disableEvent' : 'enableEvent')}
              </Button>
              <p className="ui-hint">
                {t(data.eligible ? 'eligible' : 'notEligible')}
              </p>
              {!data.scheduleEnabled && (
                <p className="ui-hint">{t('globalOffHint')}</p>
              )}
              <p className="ui-hint">{t('optOutMeaning')}</p>
            </Card>
          )}
          <Button
            variant="secondary"
            disabled={state.busy}
            onClick={() => void state.refresh()}
          >
            {t('refresh')}
          </Button>
        </>
      )}
    </section>
  );
}
