'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { submitArtistSelection } from '@/client/artists';
import { useDialog } from '@/components/ui/DialogProvider';
import type { ArtistError, ArtistSummary } from '@/config/artists';

export function useArtistSelection() {
  const router = useRouter();
  const t = useTranslations('artists');
  const { showDialog, cancelDialog } = useDialog();
  const dialogScope = useId();
  const pendingDialog = useRef<string | null>(null);
  const active = useRef(true);
  const working = useRef(false);
  const lastSelection = useRef<ArtistSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [error, setError] = useState<ArtistError | null>(null);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      // Query-only pagination can replace this screen without replacing the
      // pathname-scoped provider. The departing screen owns its confirmation.
      if (pendingDialog.current) cancelDialog(pendingDialog.current);
    };
  }, [cancelDialog]);

  async function select(artist: ArtistSummary, confirmed = false) {
    if (working.current || refreshing) return;
    working.current = true;
    setBusy(true);
    setError(null);
    try {
      if (!confirmed) {
        pendingDialog.current = `${dialogScope}:${artist.slug}`;
        const decision = await showDialog({
          key: pendingDialog.current,
          title: t('selectionDialogTitle'),
          description: t('selectionDialogDescription', { name: artist.name }),
          confirmLabel: t('selectionConfirm'),
        });
        pendingDialog.current = null;
        if (decision !== 'confirmed' || !active.current) return;
      }
      lastSelection.current = artist;
      setSaving(true);
      const result = await submitArtistSelection({ slug: artist.slug });
      if (!active.current) return;
      if (!result.ok) {
        setError(result.code);
        return;
      }
      router.push(result.next);
      router.refresh();
    } catch {
      if (active.current) setError('UNAVAILABLE');
    } finally {
      working.current = false;
      if (active.current) {
        setBusy(false);
        setSaving(false);
      }
    }
  }

  function retry() {
    if (working.current || refreshing) return;
    if (error === 'UNAVAILABLE' && lastSelection.current)
      return select(lastSelection.current, true);
    startRefresh(() => router.refresh());
  }

  return { select, retry, busy: busy || refreshing, saving, error };
}
