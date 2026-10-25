import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { routes } from '@/config/routes';
export function AdminSettingsEntry({
  title,
  description,
  label,
}: {
  title: string;
  description: string;
  label: string;
}) {
  return (
    <Card title={title}>
      <p>{description}</p>
      <Link
        href={routes.adminSettings}
        prefetch={false}
        className="ui-button ui-button--secondary"
      >
        {label}
      </Link>
    </Card>
  );
}
