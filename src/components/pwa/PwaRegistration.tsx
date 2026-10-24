'use client';

import { useEffect } from 'react';
import { isProductionBuild } from '@/config/env';
import { PWA } from '@/config/pwa';

export function PwaRegistration() {
  useEffect(() => {
    if (
      !isProductionBuild() ||
      !window.isSecureContext ||
      !('serviceWorker' in navigator)
    )
      return;
    // Failure must not block online access or imply installation succeeded.
    void navigator.serviceWorker
      .register(PWA.workerUrl, { scope: PWA.scope, updateViaCache: 'none' })
      .catch(() => undefined);
  }, []);
  return null;
}
