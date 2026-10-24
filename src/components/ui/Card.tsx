import { useId, type ReactNode } from 'react';

type CardProps = { title: string; children: ReactNode };

export function Card({ title, children }: CardProps) {
  const titleId = useId();
  return (
    <section className="ui-card" aria-labelledby={titleId}>
      <h2 id={titleId}>{title}</h2>
      {children}
    </section>
  );
}
