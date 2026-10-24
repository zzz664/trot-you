'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { InlineError } from '@/components/ui/InlineError';
import type { ChatPage } from '@/config/chat';
import { routes } from '@/config/routes';
import { ChatErrorScreen } from './ChatErrorScreen';
import { ChatLoading } from './ChatLoading';
import { MessageCard } from './MessageCard';
import { useFanChat } from './useFanChat';

export function FanChat({ data }: { data: ChatPage }) {
  // A fresh RSC projection is authoritative even when its slug is unchanged.
  // Reset during rendering, rather than briefly displaying the old room after
  // a prop synchronization effect. The prior owner aborts all pending requests.
  const [snapshot, setSnapshot] = useState({ data, revision: 0 });
  if (snapshot.data !== data) {
    setSnapshot({ data, revision: snapshot.revision + 1 });
  }
  return (
    <Conversation
      key={`${data.artist.slug}:${snapshot.revision}`}
      initial={data}
    />
  );
}

function Conversation({ initial }: { initial: ChatPage }) {
  const t = useTranslations('chat');
  const ui = useTranslations('ui');
  const router = useRouter();
  const state = useFanChat(initial);
  const data = state.data;
  if (!data && state.pending !== null) return <ChatLoading />;
  if (!data || !data.hasAccess)
    return (
      <ChatErrorScreen
        code={state.error ?? 'SUBSCRIPTION_REQUIRED'}
        slug={initial.artist.slug}
        onRetry={() => state.load()}
      />
    );
  return (
    <main
      className="app-shell chat-shell"
      aria-busy={state.pending !== null || undefined}
    >
      <nav className="chat-navigation" aria-label={t('navigation')}>
        <Button
          variant="secondary"
          onClick={() => {
            state.clear();
            router.replace(routes.artists);
          }}
        >
          {ui('back')}
        </Button>
        <Link
          className="ui-button ui-button--secondary"
          href={routes.subscriptions}
          prefetch={false}
          onNavigate={() => state.clear()}
        >
          {t('subscriptions')}
        </Link>
      </nav>
      <header className="chat-heading">
        <h1>{t('title', { name: data.artist.name })}</h1>
        <p>{t('description')}</p>
        <p className="ui-hint">{t('historyNotice')}</p>
        <p role="status">{t('readCount', { count: data.readCount })}</p>
        <Button
          variant="secondary"
          disabled={state.pending !== null}
          isLoading={state.pending === 'refresh'}
          onClick={() => void state.load()}
        >
          {t(state.pending === 'refresh' ? 'refreshing' : 'refresh')}
        </Button>
      </header>
      {state.error && (
        <InlineError
          message={t(`errors.${state.error}`)}
          onRetry={state.retry}
        />
      )}
      {data.messages.length === 0 ? (
        <Card title={t('emptyTitle')}>
          <p>{t('emptyDescription')}</p>
        </Card>
      ) : (
        <ol className="chat-messages" aria-label={t('messages')}>
          {data.messages.map((message) => (
            <MessageCard
              key={message.id}
              message={message}
              pending={state.readPending.has(message.id)}
              failed={state.readErrors.has(message.id)}
              suspended={state.pending !== null}
              observationEpoch={state.observationEpoch}
              markRead={state.markRead}
            />
          ))}
        </ol>
      )}
      {data.nextCursor !== null ? (
        <div className="chat-pagination">
          <Button
            disabled={state.pending !== null}
            isLoading={state.pending === 'older'}
            onClick={() => void state.load(true)}
          >
            {t(state.pending === 'older' ? 'loadingOlder' : 'older')}
          </Button>
        </div>
      ) : (
        data.messages.length > 0 && <p className="ui-hint">{t('end')}</p>
      )}
    </main>
  );
}
