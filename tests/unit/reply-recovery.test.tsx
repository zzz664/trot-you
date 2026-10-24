import { createElement, type ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, expect, it, vi } from 'vitest';
import { ChatErrorScreen } from '@/components/fan/chat/ChatErrorScreen';
import { artistPreviewPath } from '@/config/routes';
import messages from '@/messages/ko.json';

const mock = vi.hoisted(() => ({
  refresh: vi.fn(),
  navigate: null as null | ((event: { preventDefault: () => void }) => void),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mock.refresh }),
}));
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    onNavigate,
  }: {
    href: string;
    children: ReactNode;
    onNavigate?: (event: { preventDefault: () => void }) => void;
  }) => {
    if (onNavigate) mock.navigate = onNavigate;
    return createElement('a', { href }, children);
  },
}));
beforeEach(() => {
  mock.refresh.mockReset();
  mock.navigate = null;
});
it('refreshes the authoritative room projection when subscription recovery targets its current URL', () => {
  render(
    <NextIntlClientProvider locale="ko" messages={messages}>
      <ChatErrorScreen code="SUBSCRIPTION_REQUIRED" slug="fictional-singer" />
    </NextIntlClientProvider>,
  );
  expect(
    screen.getByRole('link', { name: messages.chat.preview }),
  ).toHaveAttribute('href', artistPreviewPath('fictional-singer'));
  const preventDefault = vi.fn();
  // Test the Link callback contract, not Next's browser navigation engine.
  expect(mock.navigate).not.toBeNull();
  mock.navigate!({ preventDefault });
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(mock.refresh).toHaveBeenCalledOnce();
});
it('keeps authentication recovery a normal link rather than refreshing a stale room', () => {
  render(
    <NextIntlClientProvider locale="ko" messages={messages}>
      <ChatErrorScreen code="UNAUTHENTICATED" slug="fictional-singer" />
    </NextIntlClientProvider>,
  );
  expect(mock.navigate).toBeNull();
  expect(mock.refresh).not.toHaveBeenCalled();
});
