'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { DialogProvider } from './DialogProvider';

// Route lifetime owns the queue: stale asynchronous callbacks retain only the
// disposed queue scope, never the next screen's queue or same-key dialog requests.
export function DialogRoot({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return <DialogProvider scopeKey={pathname}>{children}</DialogProvider>;
}
