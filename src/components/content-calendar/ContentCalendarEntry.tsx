import Link from 'next/link';
import { routes } from '@/config/routes';
import { Card } from '@/components/ui/Card';
export function ContentCalendarEntry({
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
        href={routes.adminContentCalendar}
        prefetch={false}
        className="ui-button ui-button--secondary"
      >
        {label}
      </Link>
    </Card>
  );
}
