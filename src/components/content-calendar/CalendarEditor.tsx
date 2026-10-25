'use client';
import { useRef, useState, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import {
  CONTENT_CALENDAR,
  contentCalendarInputSchema,
  type ContentCalendarEntry,
  type ContentCalendarSaveInput,
  type ContentCalendarResult,
} from '@/config/content-calendar';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Button } from '@/components/ui/Button';
import styles from './content-calendar.module.css';
export function CalendarEditor({
  entry,
  artistId,
  month,
  busy,
  pendingOperation,
  onSave,
  onCancel,
}: {
  entry: ContentCalendarEntry | null;
  artistId: string;
  month: string;
  busy: boolean;
  pendingOperation: RefObject<ContentCalendarSaveInput | null>;
  onSave: (
    input: ContentCalendarSaveInput,
  ) => Promise<ContentCalendarResult<ContentCalendarEntry> | null>;
  onCancel: () => void;
}) {
  const t = useTranslations('contentCalendar');
  const restored = pendingOperation.current?.input ?? entry;
  const [date, setDate] = useState(restored?.date ?? `${month}-01`);
  const [topic, setTopic] = useState(restored?.topic ?? '');
  const [example, setExample] = useState(restored?.example_text ?? '');
  const [invalid, setInvalid] = useState(false);
  const [uncertain, setUncertain] = useState(pendingOperation.current !== null);
  const [conflict, setConflict] = useState(false);
  const running = useRef(false);
  async function save() {
    if (busy || conflict || running.current) return;
    running.current = true;
    try {
      if (!pendingOperation.current) {
        const parsed = contentCalendarInputSchema.safeParse({
          artist_id: artistId,
          date,
          topic,
          example_text: example === '' ? null : example,
        });
        if (
          !parsed.success ||
          date.slice(0, CONTENT_CALENDAR.monthLength) !== month
        ) {
          setInvalid(true);
          return;
        }
        pendingOperation.current = {
          operation_id: crypto.randomUUID(),
          entry_id: entry?.id ?? null,
          expected_revision: entry?.revision ?? null,
          input: parsed.data,
        };
      }
      const result = await onSave(pendingOperation.current);
      if (!result) return;
      if (!result.ok && result.code === 'UNAVAILABLE') setUncertain(true);
      else {
        pendingOperation.current = null;
        setUncertain(false);
        setConflict(
          !result.ok &&
            (result.code === 'CONFLICT' || result.code === 'DATE_CONFLICT'),
        );
      }
    } finally {
      running.current = false;
    }
  }
  return (
    <form
      className={styles.editor}
      data-testid="content-calendar-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <h2>{t(entry ? 'editTitle' : 'createTitle')}</h2>
      <p className="ui-hint">{t('privateHint')}</p>
      <fieldset
        className={styles.fields}
        disabled={busy || uncertain || conflict}
      >
        <Input
          label={t('date')}
          type="date"
          value={date}
          readOnly={Boolean(entry)}
          hint={t('dateHint')}
          required
          onChange={(event) => {
            setDate(event.target.value);
            setInvalid(false);
          }}
        />
        <Input
          label={t('topic')}
          value={topic}
          required
          autoComplete="off"
          onChange={(event) => {
            setTopic(event.target.value);
            setInvalid(false);
          }}
        />
        <Textarea
          label={t('exampleLabel')}
          value={example}
          onChange={(event) => {
            setExample(event.target.value);
            setInvalid(false);
          }}
        />
      </fieldset>
      {invalid && <p role="alert">{t('errors.INVALID_INPUT')}</p>}
      {uncertain && <p role="alert">{t('uncertain')}</p>}
      {conflict && <p>{t('conflictHint')}</p>}
      <div className={styles.actions}>
        <Button type="submit" disabled={busy || conflict}>
          {t(uncertain ? 'retryOperation' : entry ? 'save' : 'createSave')}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}
