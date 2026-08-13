"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowRight,
  CalendarClock,
  CheckCheck,
  CircleDot,
  GitCommitHorizontal,
  ListTodo,
  Scale,
  ShieldAlert,
} from "lucide-react";
import { SecondaryShell } from "@/components/shell/SecondaryShell";
import type { FeedCardDto, FeedItemType } from "@/types/feed";

function TypeIcon({ type }: { type: FeedItemType }) {
  const props = { className: "size-4", strokeWidth: 1.75 as const };
  switch (type) {
    case "action":
      return <ListTodo {...props} />;
    case "change":
      return <GitCommitHorizontal {...props} />;
    case "decision":
      return <Scale {...props} />;
    case "due":
      return <CalendarClock {...props} />;
    case "alert":
      return <ShieldAlert {...props} />;
    default:
      return <CircleDot {...props} />;
  }
}

function formatWhen(iso: string) {
  try {
    return new Intl.DateTimeFormat("he-IL", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function FeedCard({
  item,
  onStatus,
  busy,
}: {
  item: FeedCardDto;
  onStatus: (id: string, status: "handled" | "irrelevant") => void;
  busy: boolean;
}) {
  const requesterAskLine = item.askLine;

  return (
    <article className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] px-4 py-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 items-center justify-center rounded-[12px] border border-[var(--border)] text-[var(--text-secondary)]">
          <TypeIcon type={item.type} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-medium text-[var(--text-secondary)]">
            {item.typeLabel}
          </div>
          <h2 className="mt-1 text-[15px] font-semibold leading-6 text-[var(--text-primary)]">
            <span className="bidi-content" dir="auto">
              {item.headline}
            </span>
          </h2>
          {requesterAskLine ? (
            <p
              className="bidi-content mt-1 text-[13px] leading-5 text-[var(--text-secondary)]"
              dir="auto"
            >
              {requesterAskLine}
            </p>
          ) : null}
          <div
            className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[var(--text-secondary)]"
            dir="ltr"
          >
            {item.requesterName ? (
              <span className="bidi-content" dir="auto">
                {item.requesterName}
              </span>
            ) : null}
            {item.requesterName && item.assigneeName ? (
              <ArrowRight
                aria-hidden="true"
                className="size-3.5 shrink-0 text-[var(--text-secondary)]"
                strokeWidth={1.75}
              />
            ) : null}
            {item.assigneeName ? (
              <span className="bidi-content" dir="auto">
                {item.assigneeName}
              </span>
            ) : null}
            {(item.requesterName || item.assigneeName) &&
            (item.requestedAt || item.occurredAt) ? (
              <span aria-hidden="true">·</span>
            ) : null}
            <time dir="auto" dateTime={item.requestedAt || item.occurredAt}>
              {formatWhen(item.requestedAt || item.occurredAt)}
            </time>
          </div>
          {item.waitingLine ? (
            <div className="mt-1 text-[12px] text-[var(--text-secondary)]">
              <bdi>{item.waitingLine}</bdi>
            </div>
          ) : null}
          {item.dueAt ? (
            <div className="mt-1 text-[12px] text-[var(--text-secondary)]">
              לביצוע עד: {formatWhen(item.dueAt)}
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href={item.sourceUrl}
              className="rounded-[12px] border border-[var(--border)] px-3 py-1.5 text-[13px] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
            >
              פתח מקור
            </Link>
            {item.canMarkHandled ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => onStatus(item.id, "handled")}
                className="inline-flex items-center gap-1.5 rounded-[12px] border border-[var(--border)] px-3 py-1.5 text-[13px] text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
              >
                <CheckCheck className="size-3.5" strokeWidth={1.75} />
                סמן כטופל
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={() => onStatus(item.id, "irrelevant")}
              className="rounded-[12px] border border-[var(--border)] px-3 py-1.5 text-[13px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
            >
              לא רלוונטי
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

export function FeedPage() {
  const [items, setItems] = React.useState<FeedCardDto[] | null>(null);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [loadingMore, setLoadingMore] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/feed");
        if (!res.ok) {
          if (!cancelled) setError("טעינת הפיד נכשלה");
          return;
        }
        const data = (await res.json()) as {
          items: FeedCardDto[];
          nextCursor: string | null;
        };
        if (!cancelled) {
          setItems(data.items);
          setNextCursor(data.nextCursor);
        }
      } catch {
        if (!cancelled) setError("טעינת הפיד נכשלה");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onStatus = async (id: string, status: "handled" | "irrelevant") => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/feed/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) return;
      setItems((prev) => (prev ? prev.filter((i) => i.id !== id) : prev));
    } finally {
      setBusyId(null);
    }
  };

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const qs = new URLSearchParams({ cursor: nextCursor });
      const res = await fetch(`/api/feed?${qs.toString()}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        items: FeedCardDto[];
        nextCursor: string | null;
      };
      setItems((prev) => [...(prev ?? []), ...data.items]);
      setNextCursor(data.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <SecondaryShell title="פיד">
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-3 px-4 py-4">
        {error ? (
          <p className="text-[14px] text-[var(--text-secondary)]">{error}</p>
        ) : null}
        {items == null && !error ? (
          <p className="text-[14px] text-[var(--text-secondary)]">טוען…</p>
        ) : null}
        {items && items.length === 0 ? (
          <p className="text-[14px] text-[var(--text-secondary)]">
            אין פריטים להצגה
          </p>
        ) : null}
        {items?.map((item) => (
          <FeedCard
            key={item.id}
            item={item}
            busy={busyId === item.id}
            onStatus={onStatus}
          />
        ))}
        {nextCursor ? (
          <button
            type="button"
            disabled={loadingMore}
            onClick={() => void loadMore()}
            className="self-center rounded-[12px] border border-[var(--border)] px-4 py-2 text-[13px] text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
          >
            {loadingMore ? "טוען…" : "עוד"}
          </button>
        ) : null}
      </div>
    </SecondaryShell>
  );
}
