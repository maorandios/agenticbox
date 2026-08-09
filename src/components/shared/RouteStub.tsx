import Link from "next/link";

export function RouteStub({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="flex h-dvh items-center justify-center bg-[var(--background)] p-4">
      <div className="w-full max-w-lg rounded-[var(--radius-shell)] border border-[var(--border)] bg-[var(--surface)] p-8 shadow-[var(--shadow-shell)]">
        <div className="text-[13px] font-medium text-[var(--text-muted)]">AgenticBox</div>
        <h1 className="mt-2 text-[22px] font-semibold">{title}</h1>
        <p className="mt-3 text-[14px] leading-6 text-[var(--text-secondary)]">{body}</p>
        <Link
          href="/inbox"
          className="mt-6 inline-flex h-11 items-center rounded-full bg-[var(--action-primary)] px-5 text-[14px] font-medium text-[var(--action-on-primary)] transition-colors hover:bg-[var(--action-primary-hover)]"
        >
          חזרה לתיבה
        </Link>
      </div>
    </div>
  );
}
