"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BadgeCheck,
  Contact,
  FileText,
  ListTodo,
  Mail,
  MessageSquareText,
  Search,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  recentSearches,
  searchMailbox,
  searchMock,
} from "@/mocks";
import { SecondaryShell } from "@/components/shell/SecondaryShell";
import { useWorkspace } from "@/state/workspace";
import type { GroupedSearchResults, SearchHit } from "@/types/domain";

const GROUPS: {
  key: keyof Omit<GroupedSearchResults, "query">;
  label: string;
  icon: typeof Mail;
}[] = [
  { key: "threads", label: "מיילים", icon: Mail },
  { key: "messages", label: "הודעות", icon: MessageSquareText },
  { key: "tasks", label: "משימות", icon: ListTodo },
  { key: "decisions", label: "החלטות", icon: BadgeCheck },
  { key: "files", label: "קבצים", icon: FileText },
  { key: "signatures", label: "פרטי חתימות", icon: Contact },
];

function ResultRow({ hit }: { hit: SearchHit }) {
  const { dispatch } = useWorkspace();
  const href = hit.sourceMessageId
    ? `/inbox/${hit.threadId}?m=${hit.sourceMessageId}`
    : `/inbox/${hit.threadId}`;

  return (
    <Link
      href={href}
      onClick={() => {
        if (hit.sourceMessageId) {
          dispatch({ type: "HIGHLIGHT_MESSAGE", messageId: hit.sourceMessageId });
        }
      }}
      className="block rounded-[12px] px-3 py-2.5 transition-colors hover:bg-[var(--surface-hover)]"
    >
      <div className="truncate text-[14px] font-medium text-[var(--text-primary)]">
        <span className="bidi-content" dir="auto">
          {hit.title}
        </span>
      </div>
      <div className="mt-0.5 line-clamp-2 text-[13px] text-[var(--text-secondary)]">
        <span className="bidi-content" dir="auto">
          {hit.snippet}
        </span>
      </div>
      {hit.meta ? (
        <div className="mt-1 text-[12px] text-[var(--text-muted)]">
          <bdi>{hit.meta}</bdi>
        </div>
      ) : null}
    </Link>
  );
}

function SearchPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const initial = params.get("q") ?? "";
  const [query, setQuery] = React.useState(initial);
  const [submitted, setSubmitted] = React.useState(initial);

  React.useEffect(() => {
    setQuery(initial);
    setSubmitted(initial);
  }, [initial]);

  const results = React.useMemo(
    () => (submitted.trim() ? searchMailbox(submitted) : null),
    [submitted],
  );
  const nlAnswer = React.useMemo(
    () => (submitted.trim() ? searchMock(submitted) : null),
    [submitted],
  );

  const total = results
    ? GROUPS.reduce((sum, g) => sum + results[g.key].length, 0)
    : 0;

  const runSearch = (value: string) => {
    const next = value.trim();
    setSubmitted(next);
    router.replace(next ? `/search?q=${encodeURIComponent(next)}` : "/search");
  };

  return (
    <SecondaryShell title="חיפוש">
      <div className="border-b border-[var(--border)] px-8 py-5">
        <h1 className="text-[22px] font-semibold tracking-tight text-[var(--text-primary)]">
          חיפוש
        </h1>
        <p className="mt-1 text-[14px] text-[var(--text-secondary)]">
          חיפוש לפי נושא, תוכן, שולחים, קבצים, משימות, החלטות וחתימות
        </p>
        <div className="mt-4 flex h-12 max-w-2xl items-center overflow-hidden rounded-full border border-[var(--border)] bg-white shadow-[0_0_0_1px_var(--border)]">
          <Search
            className="ms-4 size-[18px] shrink-0 text-[var(--text-muted)]"
            strokeWidth={1.75}
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") runSearch(query);
            }}
            placeholder="מה תרצו למצוא?"
            className="h-full min-w-0 flex-1 bg-transparent px-3 text-[15px] outline-none placeholder:text-[var(--text-muted)]"
            dir="rtl"
            autoFocus
          />
          <button
            type="button"
            onClick={() => runSearch(query)}
            className="me-2 rounded-full bg-[var(--action-primary)] px-4 py-2 text-[13px] font-medium text-white hover:bg-[var(--action-primary-hover)]"
          >
            חפש
          </button>
        </div>

        {!submitted ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {recentSearches.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  setQuery(item);
                  runSearch(item);
                }}
                className="rounded-full border border-[var(--border)] px-3 py-1.5 text-[12.5px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
              >
                {item}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-8 py-6">
        {!submitted ? (
          <p className="text-[14px] text-[var(--text-secondary)]">
            התחילו להקליד כדי לחפש בכל התיבה.
          </p>
        ) : null}

        {submitted && nlAnswer?.answer ? (
          <section className="mb-6 max-w-2xl rounded-[16px] border border-[var(--border)] bg-[var(--surface-subtle)] p-4">
            <p className="text-[12px] font-semibold text-[var(--text-muted)]">
              תשובה קצרה
            </p>
            <p className="mt-2 text-[14.5px] leading-6 text-[var(--text-primary)]">
              {nlAnswer.answer}
            </p>
            {nlAnswer.sourceMessageIds.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {nlAnswer.sourceMessageIds.map((id, index) => (
                  <Link
                    key={id}
                    href={`/inbox/${nlAnswer.threadIds[index] ?? nlAnswer.threadIds[0]}?m=${id}`}
                    className="text-[12.5px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    מקור {index + 1}
                  </Link>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        {submitted && nlAnswer?.insufficient ? (
          <p className="mb-6 text-[14px] text-[var(--text-secondary)]">
            לא נמצא מספיק מידע בתיבה לשאלה הזו.
          </p>
        ) : null}

        {submitted && total === 0 && !nlAnswer?.answer ? (
          <p className="text-[14px] text-[var(--text-secondary)]">
            לא נמצאו תוצאות עבור “{submitted}”.
          </p>
        ) : null}

        {results
          ? GROUPS.map(({ key, label, icon: Icon }) => {
              const items = results[key];
              if (items.length === 0) return null;
              return (
                <section key={key} className="mb-7 max-w-2xl">
                  <div className="mb-2 flex items-center gap-2">
                    <Icon
                      className="size-4 text-[var(--text-secondary)]"
                      strokeWidth={1.75}
                    />
                    <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">
                      {label}
                    </h2>
                    <span className="text-[12px] text-[var(--text-muted)]">
                      {items.length}
                    </span>
                  </div>
                  <div
                    className={cn(
                      "divide-y divide-[var(--border)] rounded-[16px] border border-[var(--border)] bg-white",
                    )}
                  >
                    {items.map((hit) => (
                      <ResultRow key={hit.id} hit={hit} />
                    ))}
                  </div>
                </section>
              );
            })
          : null}
      </div>
    </SecondaryShell>
  );
}

export default function SearchPage() {
  return (
    <React.Suspense
      fallback={
        <SecondaryShell title="חיפוש">
          <div className="p-8 text-[14px] text-[var(--text-secondary)]">טוען חיפוש…</div>
        </SecondaryShell>
      }
    >
      <SearchPageInner />
    </React.Suspense>
  );
}
