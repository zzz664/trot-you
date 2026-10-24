type NoticeProps = { title: string; description: string };

export function Notice({ title, description }: NoticeProps) {
  return (
    <section className="notice" aria-labelledby="notice-title">
      <h2 id="notice-title">{title}</h2>
      <p>{description}</p>
    </section>
  );
}
