'use client';

import { useTranslations } from 'next-intl';
import type { ChatError } from '@/config/chat';
import { Button } from '@/components/ui/Button';
import { InlineError } from '@/components/ui/InlineError';
import { Textarea } from '@/components/ui/Textarea';
import { chatDate } from '@/components/fan/chat/format';
import { useFanReplies } from './useFanReplies';

export function FanReplies({
  slug,
  onAccessLost,
}: {
  slug: string;
  onAccessLost: (code: ChatError) => void;
}) {
  const t = useTranslations('replies');
  const state = useFanReplies(slug, onAccessLost);
  const data = state.data;
  const busy = state.pending !== null || state.sendPending;
  const count = Array.from(state.draft).length;
  const fieldError =
    state.sendError === 'INVALID_INPUT' ||
    state.sendError === 'TOO_LONG' ||
    state.sendError === 'FORBIDDEN_CONTENT'
      ? t(`errors.${state.sendError}`)
      : undefined;
  return (
    <section
      className="reply-panel"
      aria-label={t('section')}
      aria-busy={busy || undefined}
    >
      <h2>{t('title')}</h2>
      <p className="ui-hint">{t('privacy')}</p>
      {state.pageError && (
        <InlineError
          message={t(`errors.${state.pageError}`)}
          onRetry={state.retryPage}
        />
      )}
      {!data && state.pending !== null && <p role="status">{t('loading')}</p>}
      {data && (
        <>
          {!data.sendReady ? (
            <p role="status">{t('unavailable')}</p>
          ) : state.open ? (
            <form
              className="reply-composer"
              onSubmit={(event) => {
                event.preventDefault();
                void state.submit();
              }}
            >
              <Textarea
                label={t('label')}
                value={state.draft}
                onChange={(event) => state.edit(event.target.value)}
                hint={t('count', { count, max: data.maxLength })}
                disabled={state.sendPending}
                readOnly={state.uncertain}
                error={fieldError}
              />
              {state.sendError && !fieldError && (
                <p className="ui-error-text" role="alert">
                  {t(`errors.${state.sendError}`)}
                </p>
              )}
              {state.uncertain && <p className="ui-hint">{t('uncertain')}</p>}
              <div className="reply-actions">
                <Button
                  type="submit"
                  disabled={state.pending !== null}
                  isLoading={state.sendPending}
                >
                  {t(
                    state.sendPending
                      ? 'sending'
                      : state.uncertain
                        ? 'retrySend'
                        : 'send',
                  )}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => state.setOpen(false)}
                >
                  {t('close')}
                </Button>
              </div>
            </form>
          ) : (
            <Button onClick={() => state.setOpen(true)}>{t('open')}</Button>
          )}
          {state.sent && <p role="status">{t('sent')}</p>}
          <div className="reply-feed-heading">
            <h3>{t('history')}</h3>
            <Button
              variant="secondary"
              disabled={busy || state.uncertain}
              isLoading={state.pending === 'refresh'}
              onClick={() => void state.load()}
            >
              {t(state.pending === 'refresh' ? 'refreshing' : 'refresh')}
            </Button>
          </div>
          <p className="ui-hint">{t('historyNotice')}</p>
          {data.replies.length === 0 ? (
            <p>{t('empty')}</p>
          ) : (
            <ol className="reply-list" aria-label={t('history')}>
              {data.replies.map((reply) => (
                <li
                  key={reply.id}
                  className="reply-item"
                  data-reply-id={reply.id}
                >
                  <div className="ui-card">
                    <p className="reply-body">
                      {reply.blocked ? t('blocked') : reply.body}
                    </p>
                    <time
                      className="chat-message-time"
                      dateTime={reply.createdAt}
                    >
                      {chatDate(reply.createdAt)}
                    </time>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {data.nextCursor !== null ? (
            <Button
              variant="secondary"
              disabled={busy || state.uncertain}
              isLoading={state.pending === 'older'}
              onClick={() => void state.load(true)}
            >
              {t(state.pending === 'older' ? 'loadingOlder' : 'older')}
            </Button>
          ) : (
            data.replies.length > 0 && <p className="ui-hint">{t('end')}</p>
          )}
        </>
      )}
    </section>
  );
}
