import { Card } from './Card';

type NoticeProps = { title: string; description: string };

export function Notice({ title, description }: NoticeProps) {
  return (
    <Card title={title}>
      <p>{description}</p>
    </Card>
  );
}
