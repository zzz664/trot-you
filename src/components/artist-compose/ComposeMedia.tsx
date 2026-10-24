'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ComposeDraft, ComposePolicy } from '@/config/artist-compose';
import { COMPOSE_MEDIA_ACCEPT } from '@/config/compose-media';
import { Button } from '@/components/ui/Button';
import { FileInput } from '@/components/ui/FileInput';
import { SecureMedia } from '@/components/media/SecureMedia';
import { useComposeUpload } from './useComposeUpload';
import { VoiceRecorder } from './VoiceRecorder';
import styles from './artist-compose.module.css';

type Props = {
  draft: ComposeDraft;
  policy: ComposePolicy;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onChanged: () => Promise<boolean>;
  onAccessLost: () => void;
  onRemove: (mediaId: string) => void;
};
export function ComposeMedia(props: Props) {
  const t = useTranslations('artistCompose');
  const [recording, setRecording] = useState(false);
  const callbacks = useRef(props);
  const uploadBusy = useRef(false);
  const recordingBusy = useRef(false);
  useEffect(() => {
    callbacks.current = props;
  }, [props]);
  const onUploadBusy = useCallback((busy: boolean) => {
    uploadBusy.current = busy;
    callbacks.current.onBusy(busy || recordingBusy.current);
  }, []);
  const onRecordingBusy = useCallback((busy: boolean) => {
    recordingBusy.current = busy;
    setRecording(busy);
    callbacks.current.onBusy(busy || uploadBusy.current);
  }, []);
  const upload = useComposeUpload({ ...props, onBusy: onUploadBusy });
  const kind = props.draft.kind;
  if (kind === 'text') return null;
  const count = props.draft.media.length;
  const max = kind === 'photo' ? props.policy.maxPhotoCount : 1;
  const pending = props.draft.pendingUploadIds.length > 0;
  const disabled =
    props.disabled ||
    recording ||
    upload.phase !== null ||
    count >= max ||
    pending;
  return (
    <section className={styles.media} aria-label={t('media')}>
      <h2>{t('media')}</h2>
      <p>{t('mediaCount', { count, max })}</p>
      {props.disabled && <p className="ui-hint">{t('saveBeforeChange')}</p>}
      <FileInput
        label={t(`fileLabel.${kind}`)}
        accept={COMPOSE_MEDIA_ACCEPT[kind]}
        hint={t(`fileHint.${kind}`, {
          seconds:
            kind === 'voice'
              ? props.policy.maxVoiceSeconds
              : props.policy.maxVideoSeconds,
        })}
        disabled={disabled}
        onFile={(file) => void upload.select(file)}
      />
      {kind === 'voice' && (
        <VoiceRecorder
          maxSeconds={props.policy.maxVoiceSeconds}
          maxBytes={props.policy.voiceMaxBytes}
          disabled={
            props.disabled || upload.phase !== null || count >= max || pending
          }
          onBusy={onRecordingBusy}
          onFile={(file) => void upload.select(file)}
        />
      )}
      {upload.error && (
        <p className="ui-error-text" role="alert">
          {t(`errors.${upload.error}`)}
        </p>
      )}
      {upload.notice && <p role="status">{t(upload.notice)}</p>}
      {upload.phase && (
        <>
          <p role="status">
            {t(
              upload.phase === 'ready'
                ? 'fileReady'
                : upload.phase === 'preparing'
                  ? 'preparing'
                  : upload.phase === 'uncertain'
                    ? 'uploadUncertain'
                    : upload.phase === 'canceling'
                      ? 'canceling'
                      : 'uploading',
            )}
          </p>
          <div className={styles.actions}>
            {(upload.phase === 'ready' ||
              (upload.phase === 'uncertain' &&
                (upload.error === 'UNAVAILABLE' ||
                  upload.error === 'SETUP_NOT_READY'))) && (
              <Button onClick={() => void upload.upload()}>
                {t(upload.phase === 'ready' ? 'upload' : 'uploadRetry')}
              </Button>
            )}
            <Button
              variant="secondary"
              disabled={upload.phase === 'canceling'}
              onClick={() => void upload.cancel()}
            >
              {t('cancelUpload')}
            </Button>
          </div>
        </>
      )}
      {pending && (
        <>
          <p>{t('pendingUploads')}</p>
          <Button
            variant="secondary"
            disabled={props.disabled || recording || upload.phase !== null}
            onClick={() => void upload.clearPending()}
          >
            {t('clearPending')}
          </Button>
        </>
      )}
      <ol className={styles.mediaList}>
        {props.draft.media.map((item, index) => (
          <li key={item.id} data-media-id={item.id}>
            <SecureMedia mediaId={item.id} kind={item.kind} preview={false} />
            <Button
              variant="secondary"
              disabled={
                props.disabled || recording || upload.phase !== null || pending
              }
              onClick={() => props.onRemove(item.id)}
            >
              {t('remove', { number: index + 1 })}
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}
