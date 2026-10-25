'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { SecureMedia } from '@/components/media/SecureMedia';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { APP_LOCALE } from '@/config/constants';
import { ADMIN_ARTIST_TIME_ZONE } from '@/config/admin-artists';
import type {
  AdminArtistDetail,
  AdminArtistMessage,
} from '@/config/admin-artists';
import styles from './admin-artists.module.css';

export function adminArtistDate(value: string) {
  return new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone: ADMIN_ARTIST_TIME_ZONE,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}
export function ArtistPreviews({
  detail,
  onSave,
}: {
  detail: AdminArtistDetail;
  onSave: (ids: string[]) => Promise<unknown>;
}) {
  const t = useTranslations('adminArtists');
  const [selected, setSelected] = useState(
    detail.previews.map((message) => message.id),
  );
  const candidates = [
    ...detail.previews,
    ...detail.messages.filter(
      (message) =>
        !detail.previews.some((preview) => preview.id === message.id),
    ),
  ];
  const same =
    selected.join() === detail.previews.map((message) => message.id).join();
  function move(id: string, direction: -1 | 1) {
    setSelected((current) => {
      const next = [...current];
      const index = next.indexOf(id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }
  function messageContent(message: AdminArtistMessage) {
    return (
      <>
        <p>{t(`messageKinds.${message.kind}`)}</p>
        <p className="ui-hint">
          {t('messageAt', { date: adminArtistDate(message.sent_at) })}
        </p>
        {message.body && <p className={styles.message}>{message.body}</p>}
        {message.media.map((media) => (
          <SecureMedia
            key={media.id}
            mediaId={media.id}
            kind={media.kind}
            preview={false}
          />
        ))}
      </>
    );
  }
  return (
    <Card title={t('previewTitle')}>
      <p>{t('previewDescription')}</p>
      {detail.preview_max_count === 0 && (
        <p role="status">{t('previewUnavailable')}</p>
      )}
      <p>{t('previewPublicNote')}</p>
      <p>{t('previewLimit', { count: detail.preview_max_count })}</p>
      {detail.messages_has_more && (
        <p className="ui-hint">{t('boundedMessages')}</p>
      )}
      <p>{t('previewSelected', { count: selected.length })}</p>
      {selected.length > 0 && (
        <ol className={styles.previewList}>
          {selected.map((id, index) => {
            const message = candidates.find((item) => item.id === id)!;
            return (
              <li key={id} data-admin-selected-preview-id={id}>
                <p>{t('previewOrder', { order: index + 1 })}</p>
                <p>{message.body ?? t(`messageKinds.${message.kind}`)}</p>
                <div className={styles.actions}>
                  <Button
                    variant="secondary"
                    disabled={index === 0}
                    onClick={() => move(id, -1)}
                  >
                    {t('previewUp')}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={index === selected.length - 1}
                    onClick={() => move(id, 1)}
                  >
                    {t('previewDown')}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setSelected((current) =>
                        current.filter((item) => item !== id),
                      )
                    }
                  >
                    {t('previewRemove')}
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {candidates.length === 0 ? (
        <p>{t('previewEmpty')}</p>
      ) : (
        <ul className={styles.previewList}>
          {candidates.map((message) => (
            <li
              key={message.id}
              data-admin-preview-id={message.id}
              className={styles.notice}
            >
              {messageContent(message)}
              <Checkbox
                label={t('previewCheck')}
                checked={selected.includes(message.id)}
                disabled={
                  !selected.includes(message.id) &&
                  selected.length >= detail.preview_max_count
                }
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked
                      ? [...current, message.id]
                      : current.filter((id) => id !== message.id),
                  )
                }
              />
            </li>
          ))}
        </ul>
      )}
      <div className={styles.actions}>
        <Button
          disabled={same || selected.length > detail.preview_max_count}
          onClick={() => void onSave(selected)}
        >
          {t('previewSave')}
        </Button>
        <Button
          variant="secondary"
          disabled={same || selected.length > detail.preview_max_count}
          onClick={() =>
            setSelected(detail.previews.map((message) => message.id))
          }
        >
          {t('cancel')}
        </Button>
      </div>
    </Card>
  );
}
