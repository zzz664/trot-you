'use client';
import { useTranslations } from 'next-intl';
import type { ContentCalendarEntry } from '@/config/content-calendar';
import { Button } from '@/components/ui/Button';
import styles from './content-calendar.module.css';
export function CalendarEntries({
  entries,
  busy = false,
  onEdit,
  onDelete,
}: {
  entries: ContentCalendarEntry[];
  busy?: boolean;
  onEdit?: (entry: ContentCalendarEntry) => void;
  onDelete?: (entry: ContentCalendarEntry) => void;
}) {
  const t = useTranslations('contentCalendar');
  return (
    <section className={styles.stack}>
      <h2>{t('entriesTitle')}</h2>
      {!entries.length && <p>{t('empty')}</p>}
      <ul className={styles.list} data-testid="content-calendar-list">
        {entries.map((entry) => (
          <li key={entry.id} data-calendar-entry-id={entry.id}>
            <article className="ui-card">
              <h3>
                <time dateTime={entry.date}>{entry.date}</time> · {entry.topic}
              </h3>
              <h4>{t('example')}</h4>
              <p className={styles.body}>
                {entry.example_text ?? t('noExample')}
              </p>
              {onEdit && (
                <p className="ui-hint">
                  {t('revision', { revision: entry.revision })}
                </p>
              )}
              {(onEdit || onDelete) && (
                <div className={styles.actions}>
                  {onEdit && (
                    <Button
                      disabled={busy}
                      variant="secondary"
                      onClick={() => onEdit(entry)}
                    >
                      {t('edit')}
                    </Button>
                  )}
                  {onDelete && (
                    <Button
                      disabled={busy}
                      variant="secondary"
                      onClick={() => onDelete(entry)}
                    >
                      {t('deleteAction')}
                    </Button>
                  )}
                </div>
              )}
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}
