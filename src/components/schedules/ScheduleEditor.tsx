'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import type { AdminArtistList } from '@/config/admin-artists';
import {
  adminScheduleInputSchema,
  scheduleTypeSchema,
  scheduleStatusSchema,
  type AdminScheduleInput,
  type AdminScheduleSaveInput,
  type AdminSchedule,
  type ScheduleResult,
} from '@/config/schedules';
import {
  scheduleToLocalDateTime,
  scheduleEditedDateTime,
} from '@/lib/schedule-view';
import { Button } from '@/components/ui/Button';
import { Checkbox, RadioGroup } from '@/components/ui/Checkbox';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { useDialog } from '@/components/ui/DialogProvider';
import styles from './schedules.module.css';

export type ScheduleArtistChoice = { value: string; label: string };

export function ScheduleEditor({
  initial,
  event,
  initialArtists,
  pendingOperation,
  pendingArtist,
  busy,
  onArtistPage,
  onSave,
  onCancel,
}: {
  initial: AdminScheduleInput;
  event: AdminSchedule | null;
  initialArtists?: AdminArtistList;
  pendingOperation: RefObject<AdminScheduleSaveInput | null>;
  pendingArtist?: RefObject<ScheduleArtistChoice | null>;
  busy: boolean;
  onArtistPage?: (
    page: number,
  ) => Promise<ScheduleResult<AdminArtistList> | null>;
  onSave: (
    input: AdminScheduleSaveInput,
  ) => Promise<ScheduleResult<AdminSchedule> | null>;
  onCancel: () => void;
}) {
  const t = useTranslations('schedules');
  const { showDialog, cancelDialog } = useDialog();
  const pendingChoice = pendingArtist;
  const restored = pendingOperation.current?.input ?? initial;
  const [input, setInput] = useState(restored);
  const [start, setStart] = useState(() =>
    scheduleToLocalDateTime(restored.starts_at),
  );
  const [end, setEnd] = useState(() =>
    restored.ends_at
      ? scheduleToLocalDateTime(restored.ends_at)
      : { date: '', time: '' },
  );
  const [lat, setLat] = useState(
    restored.lat === null ? '' : String(restored.lat),
  );
  const [lng, setLng] = useState(
    restored.lng === null ? '' : String(restored.lng),
  );
  const [confirmed, setConfirmed] = useState(pendingOperation.current !== null);
  const [invalid, setInvalid] = useState(false);
  const [uncertain, setUncertain] = useState(pendingOperation.current !== null);
  const [conflict, setConflict] = useState(false);
  const [artists, setArtists] = useState(initialArtists);
  const [artistPage, setArtistPage] = useState(1);
  const [selectedArtist, setSelectedArtist] =
    useState<ScheduleArtistChoice | null>(() => pendingChoice?.current ?? null);
  const operation = pendingOperation;
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelDialog('schedule-publish');
    };
  }, [cancelDialog]);
  function change<K extends keyof AdminScheduleInput>(
    key: K,
    value: AdminScheduleInput[K],
  ) {
    setInput((current) => ({ ...current, [key]: value }));
    setConfirmed(false);
    setInvalid(false);
  }
  function changed() {
    setConfirmed(false);
    setInvalid(false);
  }
  async function choosePage(page: number) {
    const result = await onArtistPage?.(page);
    if (mounted.current && result?.ok) {
      setArtists(result.data);
      setArtistPage(page);
    }
  }
  async function save() {
    if (running.current || busy || conflict) return;
    running.current = true;
    try {
      if (!operation.current) {
        const endsAt =
          end.date || end.time
            ? scheduleEditedDateTime(restored.ends_at, end.date, end.time)
            : null;
        const parsed = adminScheduleInputSchema.safeParse({
          ...input,
          starts_at: scheduleEditedDateTime(
            restored.starts_at,
            start.date,
            start.time,
          ),
          ends_at: endsAt,
          lat: lat.trim() === '' ? null : Number(lat),
          lng: lng.trim() === '' ? null : Number(lng),
        });
        if (
          !parsed.success ||
          !confirmed ||
          ((end.date !== '' || end.time !== '') && endsAt === null)
        ) {
          setInvalid(true);
          return;
        }
        if (parsed.data.status === 'published') {
          const decision = await showDialog({
            key: 'schedule-publish',
            title: t('publishTitle'),
            description: t('publishDescription'),
            confirmLabel: t('publishConfirm'),
            cancelLabel: t('publishCancel'),
          });
          if (decision !== 'confirmed' || !mounted.current) return;
        }
        if (!event && pendingChoice)
          pendingChoice.current =
            artistOptions.find(
              (choice) => choice.value === parsed.data.artist_id,
            ) ?? null;
        operation.current = {
          operation_id: crypto.randomUUID(),
          schedule_id: event?.id ?? null,
          expected_revision: event?.revision ?? null,
          input: parsed.data,
          confirmed: true,
        };
      }
      const result = await onSave(operation.current);
      if (!mounted.current || !result) return;
      if (result.ok) {
        operation.current = null;
        if (pendingChoice) pendingChoice.current = null;
        setUncertain(false);
      } else if (result.code === 'UNAVAILABLE') setUncertain(true);
      else {
        operation.current = null;
        if (pendingChoice) pendingChoice.current = null;
        setUncertain(false);
        setConflict(result.code === 'CONFLICT');
      }
    } finally {
      running.current = false;
    }
  }
  const artistOptions =
    artists?.artists.map((artist) => ({
      value: artist.id,
      label: t('artistOption', {
        name: artist.name,
        slug: artist.slug,
        status: t(`artistStatuses.${artist.status}`),
      }),
    })) ?? [];
  if (
    selectedArtist &&
    !artistOptions.some((option) => option.value === selectedArtist.value)
  )
    artistOptions.unshift(selectedArtist);
  return (
    <form
      data-testid="admin-schedule-form"
      className={styles.editor}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <fieldset
        className={styles.locked}
        disabled={busy || uncertain || conflict}
      >
        {event ? (
          <p>
            {t('artist')}: {event.artist_name}
          </p>
        ) : (
          <>
            <RadioGroup
              label={t('artistSelect')}
              options={artistOptions}
              value={input.artist_id}
              onChange={(value) => {
                change('artist_id', value);
                setSelectedArtist(
                  artistOptions.find((option) => option.value === value) ??
                    null,
                );
              }}
            />
            {!artistOptions.length && <p>{t('artistEmpty')}</p>}
            <div className={styles.actions}>
              {artistPage > 1 && (
                <Button
                  variant="secondary"
                  onClick={() => void choosePage(artistPage - 1)}
                >
                  {t('artistPrevious')}
                </Button>
              )}
              {artists?.has_more && (
                <Button
                  variant="secondary"
                  onClick={() => void choosePage(artistPage + 1)}
                >
                  {t('artistNext')}
                </Button>
              )}
            </div>
          </>
        )}
        <p className="ui-hint">{t('artistSelectHint')}</p>
        <Input
          label={t('titleLabel')}
          value={input.title}
          onChange={(e) => change('title', e.target.value)}
          required
          autoComplete="off"
        />
        <RadioGroup
          label={t('typeLabel')}
          options={scheduleTypeSchema.options.map((value) => ({
            value,
            label: t(`types.${value}`),
          }))}
          value={input.type}
          onChange={(value) => change('type', value)}
        />
        <RadioGroup
          label={t('statusLabel')}
          options={scheduleStatusSchema.options.map((value) => ({
            value,
            label: t(`statuses.${value}`),
          }))}
          value={input.status}
          onChange={(value) => change('status', value)}
        />
        <p className="ui-hint">{t('statusHint')}</p>
        <p className="ui-hint">{t('timeZone')}</p>
        <Input
          label={t('startDate')}
          type="date"
          value={start.date}
          onChange={(e) => {
            setStart({ ...start, date: e.target.value });
            changed();
          }}
          required
        />
        <Input
          label={t('startTime')}
          type="time"
          value={start.time}
          onChange={(e) => {
            setStart({ ...start, time: e.target.value });
            changed();
          }}
          required
        />
        <Input
          label={t('endDate')}
          type="date"
          value={end.date}
          onChange={(e) => {
            setEnd({ ...end, date: e.target.value });
            changed();
          }}
        />
        <Input
          label={t('endTime')}
          type="time"
          value={end.time}
          onChange={(e) => {
            setEnd({ ...end, time: e.target.value });
            changed();
          }}
          hint={t('endHint')}
        />
        <Input
          label={t('placeName')}
          value={input.place_name ?? ''}
          onChange={(e) => change('place_name', e.target.value || null)}
          autoComplete="off"
        />
        <Input
          label={t('address')}
          value={input.address ?? ''}
          onChange={(e) => change('address', e.target.value || null)}
          autoComplete="off"
        />
        <p className="ui-hint">{t('coordinateHint')}</p>
        <Input
          label={t('latitude')}
          value={lat}
          onChange={(e) => {
            setLat(e.target.value);
            changed();
          }}
          autoComplete="off"
        />
        <Input
          label={t('longitude')}
          value={lng}
          onChange={(e) => {
            setLng(e.target.value);
            changed();
          }}
          autoComplete="off"
        />
        <Textarea
          label={t('descriptionLabel')}
          value={input.description ?? ''}
          onChange={(e) => change('description', e.target.value || null)}
        />
        <Checkbox
          label={t('confirm')}
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
      </fieldset>
      {invalid && <p role="alert">{t('errors.INVALID_INPUT')}</p>}
      {uncertain && <p role="alert">{t('uncertain')}</p>}
      {conflict && <p>{t('conflictHint')}</p>}
      <div className={styles.actions}>
        <Button
          type="submit"
          disabled={busy || conflict || (!uncertain && !confirmed)}
        >
          {t(uncertain ? 'retryOperation' : event ? 'save' : 'createSave')}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}
