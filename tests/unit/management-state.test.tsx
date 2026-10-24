import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useManagementState } from '@/components/subscription/useManagementState';
import type { DialogOptions, DialogResult } from '@/components/ui/Dialog';

const mocks = vi.hoisted(() => ({
  show: vi.fn<(options: DialogOptions) => Promise<DialogResult>>(),
  cancel: vi.fn(),
  replace: vi.fn(),
  execute: vi.fn(),
}));
vi.mock('@/components/ui/DialogProvider', () => ({
  useDialog: () => ({ showDialog: mocks.show, cancelDialog: mocks.cancel }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function Screen() {
  const state = useManagementState({ marker: 'initial' });
  return (
    <>
      <button
        onClick={() =>
          void state.run('execute', mocks.execute, {
            title: 'Confirm',
            description: 'Confirm only',
          })
        }
      >
        Open
      </button>
      <p>{state.data.marker}</p>
    </>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.execute.mockResolvedValue({ ok: true, data: { marker: 'done' } });
});
describe('dialog ownership survives superseded asynchronous continuations', () => {
  it('uses generation-specific keys and stale confirmation cannot clear newer dialog cleanup ownership', async () => {
    const oldDialog = deferred<DialogResult>();
    const newDialog = deferred<DialogResult>();
    mocks.show
      .mockReturnValueOnce(oldDialog.promise)
      .mockReturnValueOnce(newDialog.promise);
    const view = render(<Screen />);
    fireEvent.click(screen.getByRole('button'));
    const oldKey = mocks.show.mock.calls[0]![0].key;
    fireEvent.popState(window);
    expect(mocks.cancel).toHaveBeenCalledWith(oldKey);
    fireEvent.click(screen.getByRole('button'));
    const newKey = mocks.show.mock.calls[1]![0].key;
    expect(newKey).not.toBe(oldKey);
    await act(async () => oldDialog.resolve('confirmed'));
    expect(mocks.execute).not.toHaveBeenCalled();
    view.unmount();
    expect(mocks.cancel).toHaveBeenLastCalledWith(newKey);
    await act(async () => newDialog.resolve('confirmed'));
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('new confirmation may execute once after an older canceled continuation settles', async () => {
    const oldDialog = deferred<DialogResult>();
    const newDialog = deferred<DialogResult>();
    mocks.show
      .mockReturnValueOnce(oldDialog.promise)
      .mockReturnValueOnce(newDialog.promise);
    render(<Screen />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.popState(window);
    fireEvent.click(screen.getByRole('button'));
    await act(async () => oldDialog.resolve('canceled'));
    await act(async () => newDialog.resolve('confirmed'));
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(screen.getByText('done')).toBeVisible();
  });
});

describe('synchronous uncertainty guard', () => {
  it.each(['popstate', 'leave'] as const)(
    'blocks a same-tick second write after %s before React rerenders',
    async (navigation) => {
      const pending = deferred<{ ok: true; data: { marker: string } }>();
      const first = vi.fn(() => pending.promise);
      const second = vi.fn(async () => ({
        ok: true as const,
        data: { marker: 'unsafe-second' },
      }));
      const { result } = renderHook(() =>
        useManagementState({ marker: 'initial' }),
      );
      const stale = result.current;
      let firstResult!: Promise<boolean>;
      let secondResult!: Promise<boolean>;
      act(() => {
        firstResult = stale.run('execute', first);
        if (navigation === 'popstate')
          window.dispatchEvent(new PopStateEvent('popstate'));
        else stale.leave('/known-parent');
        secondResult = stale.run('execute', second);
      });
      expect(await secondResult).toBe(false);
      expect(first).toHaveBeenCalledTimes(1);
      expect(second).not.toHaveBeenCalled();
      expect(result.current.uncertain).toBe(true);
      await act(async () =>
        pending.resolve({ ok: true, data: { marker: 'stale' } }),
      );
      expect(await firstResult).toBe(false);
      expect(result.current.data.marker).toBe('initial');
      expect(result.current.uncertain).toBe(true);
    },
  );

  it.each(['returned', 'thrown'] as const)(
    'blocks a retained callback immediately after %s write failure',
    async (failure) => {
      const first = vi.fn(async () => {
        if (failure === 'thrown') throw new Error('network');
        return { ok: false as const, code: 'UNAVAILABLE' };
      });
      const second = vi.fn(async () => ({
        ok: true as const,
        data: { marker: 'unsafe-second' },
      }));
      const { result } = renderHook(() =>
        useManagementState({ marker: 'initial' }),
      );
      const staleRun = result.current.run;
      await act(async () => {
        expect(await staleRun('execute', first)).toBe(false);
        expect(await staleRun('execute', second)).toBe(false);
      });
      expect(second).not.toHaveBeenCalled();
      expect(result.current.uncertain).toBe(true);
    },
  );

  it('failed or superseded reads cannot unlock a pending unknown write', async () => {
    const first = deferred<{ ok: true; data: { marker: string } }>();
    const superseded = deferred<{ ok: true; data: { marker: string } }>();
    const nextWrite = vi.fn(async () => ({
      ok: true as const,
      data: { marker: 'unsafe-second' },
    }));
    const { result } = renderHook(() =>
      useManagementState({ marker: 'initial' }),
    );
    const staleRun = result.current.run;
    act(() => {
      void staleRun('execute', () => first.promise);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await act(async () => {
      await staleRun('read', async () => ({ ok: false, code: 'UNAVAILABLE' }));
      expect(await staleRun('execute', nextWrite)).toBe(false);
    });
    act(() => {
      void staleRun('read', () => superseded.promise);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await act(async () =>
      superseded.resolve({ ok: true, data: { marker: 'stale-read' } }),
    );
    await act(async () =>
      expect(await staleRun('execute', nextWrite)).toBe(false),
    );
    expect(nextWrite).not.toHaveBeenCalled();
    expect(result.current.uncertain).toBe(true);
    expect(result.current.data.marker).toBe('initial');
    await act(async () =>
      first.resolve({ ok: true, data: { marker: 'stale-write' } }),
    );
  });

  it('only a successful current read synchronously unlocks subsequent explicit mutation', async () => {
    const nextWrite = vi.fn(async () => ({
      ok: true as const,
      data: { marker: 'new-success' },
    }));
    const { result } = renderHook(() =>
      useManagementState({ marker: 'initial' }),
    );
    const staleRun = result.current.run;
    await act(async () => {
      await staleRun('execute', async () => ({
        ok: false,
        code: 'UNAVAILABLE',
      }));
      expect(await staleRun('execute', nextWrite)).toBe(false);
      expect(
        await staleRun('read', async () => ({
          ok: true,
          data: { marker: 'fresh' },
        })),
      ).toBe(true);
      expect(await staleRun('execute', nextWrite)).toBe(true);
    });
    expect(nextWrite).toHaveBeenCalledTimes(1);
    expect(result.current.uncertain).toBe(false);
    expect(result.current.data.marker).toBe('new-success');
  });

  it('retained callbacks after unmount cannot start network work or another confirmation', async () => {
    const operation = vi.fn(async () => ({
      ok: true as const,
      data: { marker: 'unsafe' },
    }));
    const { result, unmount } = renderHook(() =>
      useManagementState({ marker: 'initial' }),
    );
    const staleRun = result.current.run;
    unmount();
    expect(await staleRun('execute', operation)).toBe(false);
    expect(await staleRun('read', operation)).toBe(false);
    expect(
      await staleRun('execute', operation, {
        title: 'Stale',
        description: 'Stale',
      }),
    ).toBe(false);
    expect(operation).not.toHaveBeenCalled();
    expect(mocks.show).not.toHaveBeenCalled();
  });
});
