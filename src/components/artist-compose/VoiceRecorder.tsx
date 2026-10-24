'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import {
  createComposeRecording,
  supportsComposeRecording,
  type CapturePhase,
  type ComposeRecording,
  type RecordingError,
} from '@/client/compose-recording';
import { MEDIA_MILLISECONDS_PER_SECOND } from '@/config/media';
import { COMPOSE_RECORDING } from '@/config/compose-capture';
import styles from './artist-compose.module.css';

const subscribe = () => () => {};
const serverSupport = () => false;
type Props = {
  maxSeconds: number;
  maxBytes: number;
  disabled: boolean;
  onFile: (file: File) => void;
  onBusy: (busy: boolean) => void;
};
export function VoiceRecorder(props: Props) {
  const t = useTranslations('artistCompose');
  const effectiveSeconds = Math.min(
    props.maxSeconds,
    COMPOSE_RECORDING.maxDurationMs / MEDIA_MILLISECONDS_PER_SECOND,
  );
  const effectiveBytes = Math.min(props.maxBytes, COMPOSE_RECORDING.maxBytes);
  const supported = useSyncExternalStore(
    subscribe,
    supportsComposeRecording,
    serverSupport,
  );
  const [phase, setPhase] = useState<CapturePhase | 'notice' | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<RecordingError | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const callbacks = useRef(props);
  const recording = useRef<ComposeRecording | null>(null);
  const active = useRef(true);
  const version = useRef(0);
  useEffect(() => {
    callbacks.current = props;
  }, [props]);
  const cancel = useCallback(() => {
    version.current += 1;
    recording.current?.cancel();
    recording.current = null;
    setPhase(null);
    setFile(null);
    setElapsed(0);
    setError(null);
    callbacks.current.onBusy(false);
  }, []);
  useEffect(() => {
    active.current = true;
    const hidden = () => {
      if (document.visibilityState === 'hidden') cancel();
    };
    window.addEventListener('pagehide', cancel);
    window.addEventListener('popstate', cancel);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      active.current = false;
      version.current += 1;
      recording.current?.cancel();
      recording.current = null;
      window.removeEventListener('pagehide', cancel);
      window.removeEventListener('popstate', cancel);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [cancel]);
  function start() {
    if (recording.current || props.disabled) return;
    const owner = ++version.current;
    const live = () => active.current && owner === version.current;
    setError(null);
    setFile(null);
    callbacks.current.onBusy(true);
    const session = createComposeRecording({
      maxDurationMs: effectiveSeconds * MEDIA_MILLISECONDS_PER_SECOND,
      maxBytes: effectiveBytes,
      onPhase(next) {
        if (live()) setPhase(next);
      },
      onElapsed(ms) {
        if (live()) setElapsed(Math.floor(ms / MEDIA_MILLISECONDS_PER_SECOND));
      },
      onResult(result) {
        if (live()) setFile(result);
      },
      onError(code) {
        if (live()) setError(code);
      },
      onEnd() {
        if (!live()) return;
        recording.current = null;
        setPhase(null);
        callbacks.current.onBusy(false);
      },
    });
    recording.current = session;
    session.start();
  }
  if (!supported) return <p className="ui-hint">{t('recordUnavailable')}</p>;
  return (
    <section className={styles.recorder} aria-label={t('record')}>
      {error && (
        <p className="ui-error-text" role="alert">
          {t(`errors.${error}`)}
        </p>
      )}
      {phase === 'notice' ? (
        <>
          <p>{t('recordNotice', { seconds: effectiveSeconds })}</p>
          <div className={styles.actions}>
            <Button disabled={props.disabled} onClick={start}>
              {t('recordStart')}
            </Button>
            <Button variant="secondary" onClick={cancel}>
              {t('recordCancel')}
            </Button>
          </div>
        </>
      ) : phase ? (
        <>
          <p role="status">
            {phase === 'recording'
              ? t('recording', { seconds: elapsed })
              : t(
                  phase === 'requesting'
                    ? 'recordRequesting'
                    : 'recordStopping',
                )}
          </p>
          <div className={styles.actions}>
            {phase === 'recording' && (
              <Button onClick={() => recording.current?.stop()}>
                {t('recordStop')}
              </Button>
            )}
            <Button variant="secondary" onClick={cancel}>
              {t('recordCancel')}
            </Button>
          </div>
        </>
      ) : file ? (
        <>
          <p role="status">{t('recordReady')}</p>
          <div className={styles.actions}>
            <Button
              disabled={props.disabled}
              onClick={() => {
                const ready = file;
                setFile(null);
                props.onFile(ready);
              }}
            >
              {t('recordUpload')}
            </Button>
            <Button variant="secondary" onClick={cancel}>
              {t('recordCancel')}
            </Button>
          </div>
        </>
      ) : (
        <Button
          variant="secondary"
          disabled={props.disabled}
          onClick={() => {
            setError(null);
            setPhase('notice');
          }}
        >
          {t('record')}
        </Button>
      )}
    </section>
  );
}
