'use client';

import { useEffect } from 'react';
import { subscribeInstallBrowser } from '@/client/install-browser';

// Keep the real one-use prompt event while moving between onboarding pages.
// Mounting this observer never opens an install or notification permission UI.
export function InstallPromptCapture() {
  useEffect(() => subscribeInstallBrowser(() => {}), []);
  return null;
}
