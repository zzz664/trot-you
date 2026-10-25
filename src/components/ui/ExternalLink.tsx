import type { ReactNode } from 'react';

// Explicit user navigation only. No prefetch, provider SDK, redirect timer,
// geolocation, referrer or opener is attached to external destinations.
export function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      referrerPolicy="no-referrer"
      className="ui-button ui-button--secondary"
    >
      {children}
    </a>
  );
}
