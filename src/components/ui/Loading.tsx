import { useTranslations } from 'next-intl';

export function Loading({ label }: { label?: string }) {
  const t = useTranslations('ui');
  return (
    <div className="ui-loading" role="status" aria-live="polite">
      <span className="ui-spinner" aria-hidden="true" />
      <span>{label ?? t('loading')}</span>
    </div>
  );
}
