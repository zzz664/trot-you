'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useDialog } from '@/components/ui/DialogProvider';
import type { DialogOptions } from '@/components/ui/Dialog';

type Result<T> = { ok: true; data: T } | { ok: false; code: string };
type Confirmation = Omit<DialogOptions, 'key'>;

// Navigation invalidates both pending confirmations and responses. A lost write
// never becomes success or an automatic retry; only a fresh read unlocks UI.
export function useManagementState<T>(initial: T) {
  const router = useRouter();
  const { showDialog, cancelDialog } = useDialog();
  const scope = useId();
  const active = useRef(true);
  const working = useRef(false);
  const writing = useRef(false);
  // The ref gates retained callbacks before React can render the warning.
  const uncertainRef = useRef(false);
  const version = useRef(0);
  const dialogKey = useRef<string | null>(null);
  const [data, setData] = useState(initial);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    active.current = true;
    const invalidate = () => {
      version.current += 1;
      if (dialogKey.current) cancelDialog(dialogKey.current);
      dialogKey.current = null;
      if (writing.current) {
        uncertainRef.current = true;
        setUncertain(true);
        setError('UNAVAILABLE');
      }
      working.current = false;
      writing.current = false;
      setPending(null);
    };
    window.addEventListener('popstate', invalidate);
    return () => {
      active.current = false;
      version.current += 1;
      if (dialogKey.current) cancelDialog(dialogKey.current);
      window.removeEventListener('popstate', invalidate);
    };
  }, [cancelDialog]);

  async function run(
    name: string,
    operation: () => Promise<Result<T>>,
    confirmation?: Confirmation,
    successNotice?: string,
  ) {
    if (
      !active.current ||
      working.current ||
      (uncertainRef.current && name !== 'read')
    )
      return false;
    working.current = true;
    const requestVersion = ++version.current;
    setPending(name);
    setError(null);
    setNotice(null);
    try {
      if (confirmation) {
        const key = `${scope}:${name}:${requestVersion}`;
        dialogKey.current = key;
        const choice = await showDialog({ ...confirmation, key });
        if (dialogKey.current === key) dialogKey.current = null;
        if (
          choice !== 'confirmed' ||
          !active.current ||
          requestVersion !== version.current
        )
          return false;
      }
      writing.current = name !== 'read';
      const result = await operation();
      if (!active.current || requestVersion !== version.current) return false;
      if (!result.ok) {
        setError(result.code);
        // Even a known conflict needs a fresh authoritative projection before
        // another command. No UI inference can replace DB/provider state.
        if (name !== 'read') {
          uncertainRef.current = true;
          setUncertain(true);
        }
        return false;
      }
      setData(result.data);
      uncertainRef.current = false;
      setUncertain(false);
      if (successNotice) setNotice(successNotice);
      return true;
    } catch {
      if (active.current && requestVersion === version.current) {
        setError('UNAVAILABLE');
        if (name !== 'read') {
          uncertainRef.current = true;
          setUncertain(true);
        }
      }
      return false;
    } finally {
      if (requestVersion === version.current) {
        working.current = false;
        writing.current = false;
        if (active.current) setPending(null);
      }
    }
  }

  function leave(path: string) {
    version.current += 1;
    if (dialogKey.current) cancelDialog(dialogKey.current);
    dialogKey.current = null;
    if (writing.current) {
      uncertainRef.current = true;
      setUncertain(true);
      setError('UNAVAILABLE');
    }
    working.current = false;
    writing.current = false;
    setPending(null);
    router.replace(path);
  }

  return {
    data,
    pending,
    error,
    uncertain,
    notice,
    busy: pending !== null,
    run,
    leave,
  };
}
