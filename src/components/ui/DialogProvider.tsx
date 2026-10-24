'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Dialog, type DialogOptions, type DialogResult } from './Dialog';

type Entry = {
  options: DialogOptions;
  opener: HTMLElement | null;
  promise: Promise<DialogResult>;
  resolve: (result: DialogResult) => void;
  isSettled: boolean;
  isPresented: boolean;
};
class QueueScope {
  readonly queue: Entry[] = [];
  active: Entry | null = null;
  isMounted = true;
  isDisposed = false;
  constructor(readonly key: string) {}
  takeNext() {
    this.active = this.queue.shift() ?? null;
    return this.active;
  }
  clearActive() {
    this.active = null;
  }
  mount() {
    this.isMounted = true;
    this.isDisposed = false;
  }
  unmount() {
    this.isMounted = false;
  }
  dispose() {
    if (this.isMounted) return;
    this.isDisposed = true;
    if (this.active) settle(this.active, 'canceled');
    this.active = null;
    this.queue.splice(0).forEach((entry) => settle(entry, 'canceled'));
  }
  markPresented(entry: Entry) {
    if (this.active === entry) entry.isPresented = true;
  }
}
type DialogQueue = {
  showDialog: (options: DialogOptions) => Promise<DialogResult>;
  cancelDialog: (key: string) => void;
  cancelAll: () => void;
};
type View = { scope: QueueScope; entry: Entry; isOpen: boolean };
const DialogContext = createContext<DialogQueue | null>(null);

function settle(entry: Entry, result: DialogResult) {
  if (entry.isSettled) return;
  entry.isSettled = true;
  entry.resolve(result);
}

function restoreFocus(opener: HTMLElement | null) {
  if (opener?.isConnected && !opener.matches(':disabled, [inert], [hidden]')) {
    opener.focus();
    if (document.activeElement === opener) return;
  }
  const fallback = document.querySelector('main') ?? document.body;
  const previousTabIndex = fallback.getAttribute('tabindex');
  fallback.setAttribute('tabindex', '-1');
  fallback.focus();
  if (previousTabIndex === null) fallback.removeAttribute('tabindex');
  else fallback.setAttribute('tabindex', previousTabIndex);
}

export function DialogProvider({
  children,
  scopeKey = '',
}: {
  children: ReactNode;
  scopeKey?: string;
}) {
  const parent = useContext(DialogContext);
  // Scope changes isolate queue ownership without remounting app/layout children.
  // Old async callbacks retain their disposed scope, not the newer route's queue.
  const scope = useMemo(() => new QueueScope(scopeKey), [scopeKey]);
  const [view, setView] = useState<View | null>(null);

  const advance = useCallback(() => {
    if (!scope.isMounted || scope.active) return;
    const entry = scope.takeNext();
    setView(entry ? { scope, entry, isOpen: true } : null);
  }, [scope]);

  const finish = useCallback(
    (entry: Entry, result: DialogResult) => {
      if (scope.active !== entry || entry.isSettled) return;
      settle(entry, result);
      setView((current) =>
        current?.scope === scope ? { ...current, isOpen: false } : current,
      );
      if (!entry.isPresented) {
        // No mounted focus scope means there will be no close-autofocus event.
        scope.clearActive();
        advance();
      }
    },
    [advance, scope],
  );

  const afterClose = useCallback(
    (entry: Entry) => {
      if (!scope.isMounted) {
        // A newer route may already own a modal. Never steal its focus.
        if (!document.querySelector('[role="dialog"]'))
          restoreFocus(entry.opener);
        return;
      }
      if (scope.active !== entry || !entry.isSettled) return;
      restoreFocus(entry.opener);
      scope.clearActive();
      // Radix has completed its focus-scope teardown before the next one mounts.
      advance();
    },
    [advance, scope],
  );

  const showDialog = useCallback(
    (options: DialogOptions) => {
      if (scope.isDisposed) return Promise.resolve<DialogResult>('canceled');
      const duplicate = [scope.active, ...scope.queue].find(
        (entry) => entry?.options.key === options.key,
      );
      if (duplicate) return duplicate.promise;
      let resolve!: Entry['resolve'];
      const promise = new Promise<DialogResult>((done) => {
        resolve = done;
      });
      const focused = document.activeElement;
      const opener =
        focused instanceof HTMLElement && !focused.closest('[role="dialog"]')
          ? focused
          : (scope.active?.opener ?? null);
      scope.queue.push({
        options,
        opener,
        promise,
        resolve,
        isSettled: false,
        isPresented: false,
      });
      advance();
      return promise;
    },
    [advance, scope],
  );

  const cancelDialog = useCallback(
    (key: string) => {
      if (scope.active?.options.key === key) {
        finish(scope.active, 'canceled');
        return;
      }
      const index = scope.queue.findIndex((entry) => entry.options.key === key);
      if (index < 0) return;
      const [entry] = scope.queue.splice(index, 1);
      if (entry) settle(entry, 'canceled');
    },
    [finish, scope],
  );

  const cancelAll = useCallback(() => {
    scope.queue.splice(0).forEach((entry) => settle(entry, 'canceled'));
    if (scope.active) finish(scope.active, 'canceled');
  }, [finish, scope]);

  useEffect(() => {
    scope.mount();
    // A replayed child effect can enqueue while this scope is temporarily paused.
    queueMicrotask(() => {
      if (!scope.active && scope.queue.length) advance();
    });
    return () => {
      scope.unmount();
      // StrictMode replays setup synchronously; only real teardown cancels.
      queueMicrotask(() => scope.dispose());
    };
  }, [advance, scope]);

  const value = useMemo(
    () => ({ showDialog, cancelDialog, cancelAll }),
    [showDialog, cancelDialog, cancelAll],
  );
  if (parent) throw new Error('Mount only one DialogProvider at the app root.');
  const activeView = view?.scope === scope ? view : null;
  return (
    <DialogContext.Provider value={value}>
      {children}
      {activeView && (
        <Dialog
          key={activeView.entry.options.key}
          options={activeView.entry.options}
          isOpen={activeView.isOpen}
          onFinish={(result) => finish(activeView.entry, result)}
          onAfterClose={() => afterClose(activeView.entry)}
          onPresented={() => {
            scope.markPresented(activeView.entry);
          }}
        />
      )}
    </DialogContext.Provider>
  );
}

export function useDialog(): DialogQueue {
  const context = useContext(DialogContext);
  if (!context) throw new Error('useDialog requires DialogProvider.');
  return context;
}
