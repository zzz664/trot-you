import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BackButton } from '@/components/ui/BackButton';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { IconButton } from '@/components/ui/IconButton';
import { InlineError } from '@/components/ui/InlineError';
import { Input } from '@/components/ui/Input';
import { Loading } from '@/components/ui/Loading';
import { isUiPreviewEnabled } from '@/config/env';
import { routes } from '@/config/routes';
import messages from '@/messages/ko.json';

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));
function Intl({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="ko" messages={messages} timeZone="UTC">
      {children}
    </NextIntlClientProvider>
  );
}

describe('accessible primitives', () => {
  it('uses a non-submit button by default and supports keyboard activation', async () => {
    const user = userEvent.setup();
    const click = vi.fn();
    const submit = vi.fn((event) => event.preventDefault());
    render(
      <form onSubmit={submit}>
        <Button onClick={click}>Action</Button>
      </form>,
    );
    await user.tab();
    await user.keyboard('{Enter} ');
    expect(click).toHaveBeenCalledTimes(2);
    expect(submit).not.toHaveBeenCalled();
  });

  it('preserves its label while disabled/loading and blocks repeated activation', async () => {
    const click = vi.fn();
    render(
      <Button isLoading onClick={click}>
        Waiting
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Waiting' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await userEvent.dblClick(button);
    expect(click).not.toHaveBeenCalled();
  });

  it('requires a visible icon label and hides the decorative icon from its name', () => {
    render(<IconButton label="Back" icon="←" />);
    expect(screen.getByRole('button', { name: 'Back' })).toBeVisible();
    expect(screen.getByText('Back')).toBeVisible();
    expect(screen.getByText('←')).toHaveAttribute('aria-hidden', 'true');
  });

  it('connects unique input labels, hint and error while preserving native semantics', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Input label="First" hint="Hint" error="Invalid" required />
        <Input label="Second" disabled />
      </>,
    );
    const first = screen.getByRole('textbox', { name: 'First' });
    const second = screen.getByRole('textbox', { name: 'Second' });
    expect(first.id).not.toBe(second.id);
    expect(first).toBeRequired();
    expect(first).toHaveAttribute('aria-invalid', 'true');
    expect(first).toHaveAccessibleDescription('Hint Invalid');
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid');
    expect(second).toBeDisabled();
    expect(second).not.toHaveAttribute('aria-invalid');
    await user.click(screen.getByText('First'));
    expect(first).toHaveFocus();
    await user.type(first, 'test');
    expect(first).toHaveValue('test');
  });

  it('gives every card a unique heading association', () => {
    render(
      <>
        <Card title="First">One</Card>
        <Card title="Second">Two</Card>
      </>,
    );
    expect(screen.getByRole('region', { name: 'First' })).toHaveTextContent(
      'One',
    );
    expect(screen.getByRole('region', { name: 'Second' })).toHaveTextContent(
      'Two',
    );
  });

  it('announces loading with visible text instead of a skeleton', () => {
    render(<Loading />, { wrapper: Intl });
    expect(screen.getByRole('status')).toHaveTextContent(messages.ui.loading);
  });

  it('guards concurrent retries and keeps the error on rejected retry', async () => {
    let reject!: (reason: Error) => void;
    const onRetry = vi.fn(
      () =>
        new Promise<void>((_resolve, rejectPromise) => {
          reject = rejectPromise;
        }),
    );
    render(<InlineError message="Still failed" onRetry={onRetry} />, {
      wrapper: Intl,
    });
    const retry = screen.getByRole('button', { name: messages.ui.retry });
    fireEvent.click(retry);
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(retry).toBeDisabled();
    await act(async () => reject(new Error('offline')));
    expect(screen.getByRole('alert')).toHaveTextContent('Still failed');
    expect(
      screen.getByRole('button', { name: messages.ui.retry }),
    ).toBeEnabled();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('uses a known parent fallback rather than untrusted browser history', async () => {
    render(<BackButton />, { wrapper: Intl });
    await userEvent.click(
      screen.getByRole('button', { name: messages.ui.back }),
    );
    expect(replace).toHaveBeenCalledWith(routes.home);
  });

  it.each([undefined, 'false', '1', 'TRUE'])(
    'disables the preview without exact opt-in (%s)',
    (flag) => {
      vi.stubEnv('UI_PREVIEW_ENABLED', flag);
      expect(isUiPreviewEnabled()).toBe(false);
      vi.unstubAllEnvs();
    },
  );

  it('enables the preview only on the server opt-in flag', () => {
    vi.stubEnv('UI_PREVIEW_ENABLED', 'true');
    expect(isUiPreviewEnabled()).toBe(true);
    vi.unstubAllEnvs();
  });
});
