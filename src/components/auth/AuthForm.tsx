'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';

export function AuthForm({
  action,
  label,
  pendingLabel,
  disabled = false,
  describedBy,
}: {
  action: string;
  label: string;
  pendingLabel: string;
  disabled?: boolean;
  describedBy?: string;
}) {
  const [pending, setPending] = useState(false);
  useEffect(() => {
    // Returning from a provider or restoring history must not leave a permanently
    // disabled control or restore a private page after logout in another page.
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
      else setPending(false);
    };
    window.addEventListener('pageshow', restore);
    return () => window.removeEventListener('pageshow', restore);
  }, []);
  return (
    <form action={action} method="post" onSubmit={() => setPending(true)}>
      <Button
        type="submit"
        disabled={disabled}
        isLoading={pending}
        describedBy={describedBy}
      >
        {pending ? pendingLabel : label}
      </Button>
    </form>
  );
}
