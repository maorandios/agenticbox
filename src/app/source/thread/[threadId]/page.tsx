import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { requireUser } from "@/server/auth/require-user";
import { loadSourceThreadForUser } from "@/server/search/source-thread";
import { SecondaryShell } from "@/components/shell/SecondaryShell";
import { SourceMessageScroller } from "@/components/search/SourceMessageScroller";

export const dynamic = "force-dynamic";

function formatWhen(iso: string | null | undefined) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("he-IL", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default async function SourceThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ threadId: string }>;
  searchParams: Promise<{ message?: string }>;
}) {
  const { user } = await requireUser();
  if (!user) {
    redirect("/login?next=/search");
  }

  const { threadId } = await params;
  const { message: highlightMessageId } = await searchParams;

  const result = await loadSourceThreadForUser({
    userId: user.id,
    threadId,
  });

  if (result.status === "no_account") {
    redirect("/settings");
  }
  if (result.status !== "ok") {
    notFound();
  }

  const { thread, messages, messageParticipants, attachments } = result;
  const participantsById = new Map(messageParticipants.map((p) => [p.id, p]));

  return (
    <SecondaryShell title="מקור">
      <SourceMessageScroller messageId={highlightMessageId} />
      <div className="mx-auto w-full max-w-3xl px-6 py-6">
        <div className="mb-4 flex items-center gap-3">
          <Link
            href="/search"
            className="inline-flex items-center gap-1 rounded-[12px] border border-[var(--border)] px-3 py-1.5 text-[13px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
          >
            <ArrowRight className="size-4" strokeWidth={1.75} />
            חזרה לשאל
          </Link>
        </div>

        <h1 className="text-[22px] font-semibold tracking-tight text-[var(--text-primary)]">
          <span className="bidi-content" dir="auto">
            {thread.subject || "ללא נושא"}
          </span>
        </h1>
        <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
          תצוגת מקור לקריאה בלבד · {messages.length} הודעות
        </p>

        <div className="mt-6 space-y-4">
          {messages.map((message) => {
            const from = participantsById.get(message.fromId);
            const toPeople = message.toIds
              .map((id) => participantsById.get(id))
              .filter(Boolean);
            const msgAttachments = attachments.filter(
              (a) =>
                !a.inlineInBody && message.attachmentIds?.includes(a.id),
            );
            const highlighted = highlightMessageId === message.id;
            const bodyText = (message.body || "").trim();

            return (
              <article
                key={message.id}
                id={`message-${message.id}`}
                className={`rounded-[16px] border px-4 py-4 ${
                  highlighted
                    ? "border-[var(--action-primary)] bg-[var(--surface-selected)]"
                    : "border-[var(--border)] bg-[var(--surface)]"
                }`}
              >
                <header className="space-y-1 text-[13px] text-[var(--text-secondary)]">
                  <div>
                    מאת:{" "}
                    <bdi>
                      {from?.name || from?.email || "לא ידוע"}
                      {from?.email ? ` <${from.email}>` : ""}
                    </bdi>
                  </div>
                  {toPeople.length ? (
                    <div>
                      אל:{" "}
                      <bdi>
                        {toPeople
                          .map((p) => p!.name || p!.email)
                          .filter(Boolean)
                          .join(", ")}
                      </bdi>
                    </div>
                  ) : null}
                  <div>נשלח: {formatWhen(message.sentAt)}</div>
                </header>

                <div
                  className="bidi-content mt-3 whitespace-pre-wrap text-[14px] leading-6 text-[var(--text-primary)]"
                  dir="auto"
                >
                  {bodyText || "(אין תוכן טקסט להצגה)"}
                </div>

                {msgAttachments.length ? (
                  <ul className="mt-3 space-y-1 border-t border-[var(--border)] pt-3 text-[12px] text-[var(--text-secondary)]">
                    {msgAttachments.map((att) => (
                      <li key={att.id}>
                        קובץ מצורף: <bdi>{att.fileName}</bdi>
                        {att.mimeType ? ` · ${att.mimeType}` : ""}
                        {att.sizeLabel ? ` · ${att.sizeLabel}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </article>
            );
          })}
        </div>
      </div>
    </SecondaryShell>
  );
}
