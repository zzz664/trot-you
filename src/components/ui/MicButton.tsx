'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslations } from 'next-intl';
import {
  createSpeechSession,
  supportsSpeechRecognition,
  type SpeechSession,
} from '@/client/speech';
import { recordVoiceInput } from '@/client/analytics';
import type { SpeechError, SpeechPhase } from '@/config/speech';
import { Button } from './Button';

const subscribe = () => () => {};
const serverSupport = () => false;

type MicButtonProps = {
  maxLength: number;
  onResult: (text: string) => boolean | void;
  // Called before the disclosure steals editor focus. The composer freezes its
  // current selection/draft and supplies the remaining Unicode-scalar capacity.
  onPrepare?: () => number;
  onActiveChange?: (active: boolean) => void;
  disabled?: boolean;
  analyticsContext?: 'reply' | 'post' | 'comment';
};

export function MicButton(props: MicButtonProps) {
  const t = useTranslations('speech');
  const id = useId();
  const supported = useSyncExternalStore(
    subscribe,
    supportsSpeechRecognition,
    serverSupport,
  );
  const [phase, setPhase] = useState<'idle' | 'notice' | SpeechPhase>('idle');
  const [preview, setPreview] = useState('');
  const [error, setError] = useState<SpeechError | null>(null);
  const [status, setStatus] = useState<'applied' | 'canceled' | null>(null);
  const callbacks = useRef(props);
  const active = useRef(false);
  const session = useRef<SpeechSession | null>(null);
  const capacity = useRef(props.maxLength);
  const telemetry = useRef(new Set<AbortController>());
  const opener = useRef<HTMLButtonElement>(null);
  const starter = useRef<HTMLButtonElement>(null);
  const restoreOpener = useRef(false);
  useEffect(() => {
    callbacks.current = props;
  }, [props]);
  const release = useCallback(() => {
    active.current = false;
    session.current = null;
    setPhase('idle');
    setPreview('');
    callbacks.current.onActiveChange?.(false);
  }, []);
  const cancel = useCallback(() => {
    const wasActive = active.current;
    session.current?.abort();
    if (wasActive) {
      release();
      setError(null);
      setStatus('canceled');
    }
    telemetry.current.forEach((controller) => controller.abort());
    telemetry.current.clear();
  }, [release]);
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === 'hidden') cancel();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && active.current) {
        event.preventDefault();
        restoreOpener.current = true;
        cancel();
      }
    };
    window.addEventListener('popstate', cancel);
    window.addEventListener('pagehide', cancel);
    document.addEventListener('visibilitychange', hidden);
    document.addEventListener('keydown', key);
    const analytics = telemetry.current;
    return () => {
      window.removeEventListener('popstate', cancel);
      window.removeEventListener('pagehide', cancel);
      document.removeEventListener('visibilitychange', hidden);
      document.removeEventListener('keydown', key);
      // Detach all callbacks before native abort. Late browser events cannot
      // repopulate a dismissed or no-longer-authorized composer.
      session.current?.abort();
      if (active.current) callbacks.current.onActiveChange?.(false);
      active.current = false;
      analytics.forEach((controller) => controller.abort());
      analytics.clear();
    };
  }, [cancel]);
  useEffect(() => {
    if (props.disabled) cancel();
  }, [props.disabled, cancel]);
  useEffect(() => {
    if (phase === 'notice') starter.current?.focus();
    if (phase === 'idle' && restoreOpener.current) {
      restoreOpener.current = false;
      opener.current?.focus();
    }
  }, [phase]);
  const open = () => {
    if (active.current || props.disabled || !supported) return;
    const remaining = props.onPrepare?.() ?? props.maxLength;
    setStatus(null);
    setError(null);
    if (!Number.isInteger(remaining) || remaining <= 0) {
      setError('tooLong');
      return;
    }
    capacity.current = Math.min(remaining, props.maxLength);
    active.current = true;
    props.onActiveChange?.(true);
    setPhase('notice');
  };
  const start = () => {
    if (!active.current || session.current || props.disabled) return;
    const next = createSpeechSession({
      maxLength: capacity.current,
      onPhase: setPhase,
      onPreview: setPreview,
      onResult(text) {
        if (!active.current || callbacks.current.disabled) return;
        if (callbacks.current.onResult(text) === false) {
          setError('unavailable');
          return;
        }
        setStatus('applied');
        const context = callbacks.current.analyticsContext;
        if (context) {
          // No transcript, duration, audio, error details, device or user data.
          // Best effort: analytics failure never undoes a user's draft.
          try {
            const controller = new AbortController();
            telemetry.current.add(controller);
            void recordVoiceInput(
              context,
              crypto.randomUUID(),
              controller.signal,
            )
              .catch(() => {})
              .finally(() => telemetry.current.delete(controller));
          } catch {
            /* Analytics cannot prevent typing. */
          }
        }
      },
      onError: setError,
      onEnd: release,
    });
    session.current = next;
    // Intentionally synchronous in this explicit user click, after disclosure.
    next.start();
  };
  return (
    <section className="speech-input" aria-label={t('title')}>
      {!supported ? (
        <p className="ui-hint">{t('unsupported')}</p>
      ) : (
        <>
          {phase === 'idle' ? (
            <Button
              ref={opener}
              variant="secondary"
              disabled={props.disabled}
              onClick={open}
            >
              {t('open')}
            </Button>
          ) : (
            <>
              {phase === 'notice' ? (
                <p id={`${id}-privacy`}>{t('privacy')}</p>
              ) : (
                <p role="status">{t(phase)}</p>
              )}
              <p className="ui-hint">{t('draftNotice')}</p>
              {preview && (
                <div className="speech-preview">
                  <p className="ui-hint">{t('preview')}</p>
                  <p aria-live="polite">{preview}</p>
                </div>
              )}
              <div className="ui-actions">
                {phase === 'notice' && (
                  <Button
                    ref={starter}
                    describedBy={`${id}-privacy`}
                    onClick={start}
                  >
                    {t('start')}
                  </Button>
                )}
                {phase === 'listening' && (
                  <Button onClick={() => session.current?.stop()}>
                    {t('stop')}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  onClick={() => {
                    restoreOpener.current = true;
                    cancel();
                  }}
                >
                  {t('cancel')}
                </Button>
              </div>
            </>
          )}
          {error && (
            <p className="ui-error-text" role="alert">
              {t(`errors.${error}`)}
            </p>
          )}
          {status && <p role="status">{t(status)}</p>}
        </>
      )}
    </section>
  );
}
