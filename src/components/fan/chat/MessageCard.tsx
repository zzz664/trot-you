'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SecureMedia } from '@/components/media/SecureMedia';
import type { ChatMessage } from '@/config/chat';
import { chatDate } from './format';

export function MessageCard({
  message,
  pending,
  failed,
  suspended,
  observationEpoch,
  markRead,
}: {
  message: ChatMessage;
  pending: boolean;
  failed: boolean;
  suspended: boolean;
  observationEpoch: number;
  markRead: (messageId: string) => Promise<void>;
}) {
  const t = useTranslations('chat');
  const kinds = useTranslations('artists.messageKinds');
  const element = useRef<HTMLLIElement>(null);
  const attempted = useRef(false);
  useEffect(() => {
    attempted.current = false;
  }, [observationEpoch]);
  useEffect(() => {
    const target = element.current;
    if (
      !target ||
      message.readAt ||
      failed ||
      suspended ||
      typeof IntersectionObserver === 'undefined'
    )
      return;
    let visible = false;
    const readVisible = () => {
      if (
        !visible ||
        document.visibilityState !== 'visible' ||
        attempted.current
      )
        return;
      attempted.current = true;
      void markRead(message.id);
    };
    const observer = new IntersectionObserver((entries) => {
      visible = entries.some(
        (entry) => entry.target === target && entry.isIntersecting,
      );
      readVisible();
    });
    observer.observe(target);
    document.addEventListener('visibilitychange', readVisible);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', readVisible);
    };
  }, [
    failed,
    markRead,
    message.id,
    message.readAt,
    observationEpoch,
    suspended,
  ]);
  return (
    <li ref={element} className="chat-message" data-message-id={message.id}>
      <Card title={kinds(message.kind)}>
        <time dateTime={message.sentAt} className="chat-message-time">
          {chatDate(message.sentAt)}
        </time>
        {message.text !== null && (
          <p className="chat-message-copy">{message.text}</p>
        )}
        {message.media.map((media) => (
          <SecureMedia
            key={media.id}
            mediaId={media.id}
            kind={media.kind}
            preview={false}
          />
        ))}
        <p className="chat-read-status" aria-live="polite">
          {t(message.readAt ? 'read' : pending ? 'markingRead' : 'unread')}
        </p>
        {!message.readAt && (
          <Button
            variant="secondary"
            disabled={pending || suspended}
            isLoading={pending}
            onClick={() => void markRead(message.id)}
          >
            {t(failed ? 'retryRead' : 'markRead')}
          </Button>
        )}
        {failed && (
          <p role="alert" className="chat-read-error">
            {t('readFailed')}
          </p>
        )}
      </Card>
    </li>
  );
}
