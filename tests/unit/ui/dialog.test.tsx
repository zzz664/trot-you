import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import {
  StrictMode,
  useLayoutEffect,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/Button';
import { DialogProvider, useDialog } from '@/components/ui/DialogProvider';
import type { DialogOptions } from '@/components/ui/Dialog';
import messages from '@/messages/ko.json';

let pathname = '/';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
let api: ReturnType<typeof useDialog>;
const first: DialogOptions = {
  key: 'first',
  title: 'First dialog',
  description: 'First description',
};
const second: DialogOptions = {
  key: 'second',
  title: 'Second dialog',
  description: 'Second description',
};
function Consumer() {
  const queue = useDialog();
  useLayoutEffect(() => {
    api = queue;
  }, [queue]);
  return (
    <main tabIndex={-1}>
      <Button
        onClick={() => {
          void queue.showDialog(first);
        }}
      >
        Open
      </Button>
    </main>
  );
}
function Wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="ko" messages={messages} timeZone="UTC">
      <DialogProvider scopeKey={pathname}>{children}</DialogProvider>
    </NextIntlClientProvider>
  );
}
function setup() {
  return render(<Consumer />, { wrapper: Wrapper });
}
beforeEach(() => {
  pathname = '/';
});

describe('single dialog queue', () => {
  it('labels the modal and traps keyboard focus, then Escape restores its opener', async () => {
    const user = userEvent.setup();
    setup();
    const opener = screen.getByRole('button', { name: 'Open' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: first.title });
    expect(dialog).toHaveAccessibleDescription(first.description);
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const cancel = within(dialog).getByRole('button', {
      name: messages.ui.cancel,
    });
    expect(cancel).toHaveFocus();
    await user.tab({ shift: true });
    expect(
      within(dialog).getByRole('button', { name: messages.ui.close }),
    ).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(opener).toHaveFocus());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each([
    [messages.ui.confirm, 'confirmed'],
    [messages.ui.cancel, 'canceled'],
    [messages.ui.close, 'dismissed'],
  ])(
    'settles %s exactly once even on repeated clicks',
    async (label, result) => {
      setup();
      let promise!: ReturnType<typeof api.showDialog>;
      act(() => {
        promise = api.showDialog(first);
      });
      const settled = vi.fn();
      void promise.then(settled);
      const button = screen.getByRole('button', { name: label });
      fireEvent.click(button);
      fireEvent.click(button);
      await expect(promise).resolves.toBe(result);
      expect(settled).toHaveBeenCalledTimes(1);
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
    },
  );

  it('deduplicates repeated keys and opens queued dialogs only after prior focus cleanup', async () => {
    setup();
    let promise!: ReturnType<typeof api.showDialog>;
    act(() => {
      promise = api.showDialog(first);
      expect(api.showDialog(first)).toBe(promise);
      void api.showDialog(second);
    });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog')).toHaveAccessibleName(first.title);
    await userEvent.click(
      screen.getByRole('button', { name: messages.ui.confirm }),
    );
    await expect(promise).resolves.toBe('confirmed');
    await waitFor(() =>
      expect(screen.getByRole('dialog')).toHaveAccessibleName(second.title),
    );
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: messages.ui.cancel }),
    ).toHaveFocus();
    await userEvent.keyboard('{Escape}');
  });

  it('cancels a waiting entry without disturbing the active dialog or its focus', async () => {
    setup();
    let waiting!: ReturnType<typeof api.showDialog>;
    act(() => {
      void api.showDialog(first);
      waiting = api.showDialog(second);
    });
    const focused = document.activeElement;
    act(() => api.cancelDialog(second.key));
    await expect(waiting).resolves.toBe('canceled');
    expect(document.activeElement).toBe(focused);
    await userEvent.click(
      screen.getByRole('button', { name: messages.ui.cancel }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(screen.queryByText(second.title)).not.toBeInTheDocument();
  });

  it('cancels active and queued entries, and lets the queue be reused', async () => {
    setup();
    let promises!: ReturnType<typeof api.showDialog>[];
    act(() => {
      promises = [api.showDialog(first), api.showDialog(second)];
    });
    act(() => api.cancelAll());
    await expect(Promise.all(promises)).resolves.toEqual([
      'canceled',
      'canceled',
    ]);
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    act(() => {
      void api.showDialog(first);
    });
    expect(screen.getByRole('dialog')).toHaveAccessibleName(first.title);
  });

  it('advances after a request is canceled before it ever mounts', async () => {
    setup();
    let canceled!: ReturnType<typeof api.showDialog>;
    act(() => {
      canceled = api.showDialog(first);
      api.cancelDialog(first.key);
      void api.showDialog(second);
    });
    await expect(canceled).resolves.toBe('canceled');
    expect(screen.getByRole('dialog')).toHaveAccessibleName(second.title);
  });

  it('does not strand effect-driven requests during StrictMode replay', async () => {
    const requests: ReturnType<typeof api.showDialog>[] = [];
    function EffectConsumer() {
      const { showDialog } = useDialog();
      useEffect(() => {
        requests.push(showDialog(first));
      }, [showDialog]);
      return <Consumer />;
    }
    render(
      <StrictMode>
        <Wrapper>
          <EffectConsumer />
        </Wrapper>
      </StrictMode>,
    );
    expect(screen.getByRole('dialog')).toHaveAccessibleName(first.title);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toBe(requests[1]);
    act(() => api.cancelAll());
    await expect(Promise.all(requests)).resolves.toEqual([
      'canceled',
      'canceled',
    ]);
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  it('flushes requests requeued by StrictMode effect cleanup', async () => {
    function EffectConsumer() {
      const { showDialog, cancelDialog } = useDialog();
      useEffect(() => {
        void showDialog(first);
        return () => cancelDialog(first.key);
      }, [showDialog, cancelDialog]);
      return <Consumer />;
    }
    render(
      <StrictMode>
        <Wrapper>
          <EffectConsumer />
        </Wrapper>
      </StrictMode>,
    );
    await waitFor(() =>
      expect(screen.getByRole('dialog')).toHaveAccessibleName(first.title),
    );
    act(() => api.cancelAll());
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  it('resolves all pending requests on unmount, including StrictMode lifecycle', async () => {
    const view = render(
      <StrictMode>
        <Wrapper>
          <Consumer />
        </Wrapper>
      </StrictMode>,
    );
    let promises!: ReturnType<typeof api.showDialog>[];
    act(() => {
      promises = [api.showDialog(first), api.showDialog(second)];
    });
    view.unmount();
    await expect(Promise.all(promises)).resolves.toEqual([
      'canceled',
      'canceled',
    ]);
    await expect(api.showDialog(first)).resolves.toBe('canceled');
  });

  it('restores focus to main when the opener has been removed', async () => {
    const view = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    view.rerender(<main tabIndex={-1}>Fallback</main>);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByRole('main')).toHaveFocus());
  });

  it('keeps the new route request even when its effect runs before route cleanup', async () => {
    const view = setup();
    let oldRequest!: ReturnType<typeof api.showDialog>;
    act(() => {
      oldRequest = api.showDialog(first);
    });
    function NewPage() {
      const { showDialog } = useDialog();
      useEffect(() => {
        void showDialog({ ...first, title: second.title });
      }, [showDialog]);
      return <Consumer />;
    }
    pathname = '/new-route';
    view.rerender(<NewPage />);
    await expect(oldRequest).resolves.toBe('canceled');
    await waitFor(() =>
      expect(screen.getByRole('dialog')).toHaveAccessibleName(second.title),
    );
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(
      screen.getByRole('button', { name: messages.ui.cancel }),
    ).toHaveFocus();
  });

  it('changes queue scope without resetting persistent child state', async () => {
    function Stateful() {
      const [count, setCount] = useState(0);
      return (
        <Button onClick={() => setCount(count + 1)}>{String(count)}</Button>
      );
    }
    const view = render(<Stateful />, { wrapper: Wrapper });
    await userEvent.click(screen.getByRole('button', { name: '0' }));
    pathname = '/new-route';
    view.rerender(<Stateful />);
    expect(screen.getByRole('button', { name: '1' })).toBeVisible();
  });

  it('rejects stale old-route callbacks without canceling newer same-key requests', async () => {
    const view = setup();
    const stale = api;
    pathname = '/new-route';
    view.rerender(<Consumer />);
    await expect(stale.showDialog(first)).resolves.toBe('canceled');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    act(() => {
      void api.showDialog(first);
    });
    act(() => stale.cancelDialog(first.key));
    expect(screen.getByRole('dialog')).toHaveAccessibleName(first.title);
  });

  it('cancels the queue when navigation moves to a newer pathname', async () => {
    const view = setup();
    let promise!: ReturnType<typeof api.showDialog>;
    act(() => {
      promise = api.showDialog(first);
    });
    pathname = '/new-route';
    view.rerender(<Consumer />);
    await expect(promise).resolves.toBe('canceled');
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });
});
