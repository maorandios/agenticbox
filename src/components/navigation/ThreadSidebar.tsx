"use client";

import Link from "next/link";
import { MoreHorizontal, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { formatThreadTime } from "@/lib/format";
import { getThreadPrimaryParticipant, getThreadsByInboxFilter } from "@/mocks";
import { MonoPill } from "@/components/shared/MonoPill";
import { IconButton } from "@/components/shared/IconButton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspace, type InboxFilter } from "@/state/workspace";
import type { Thread } from "@/types/domain";

const filters: { id: InboxFilter; label: string }[] = [
  { id: "all", label: "הכל" },
  { id: "needs_reply", label: "דורש ממני" },
  { id: "waiting", label: "ממתין" },
];

function resolveThread(thread: Thread, overrides: Record<string, Partial<Thread>>) {
  const override = overrides[thread.id];
  if (!override) return thread;
  return { ...thread, ...override };
}

function statusLabel(thread: Thread) {
  if (thread.status === "needs_reply") return "דורש ממני";
  if (thread.status === "waiting") return "ממתין";
  if (thread.unread) return "לא נקרא";
  return null;
}

export function ThreadSidebar({ activeThreadId }: { activeThreadId: string | null }) {
  const { state, dispatch } = useWorkspace();
  const list = getThreadsByInboxFilter(state.selectedQueue).map((t) =>
    resolveThread(t, state.threadOverrides as Record<string, Partial<Thread>>),
  );

  return (
    <aside className="flex h-full min-h-0 w-full flex-col">
      <div className="space-y-3 border-b border-[var(--border)] px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-[18px] font-semibold tracking-tight text-[var(--text-primary)]">
              תיבת עבודה
            </h1>
            <p className="mt-0.5 text-[13px] text-[var(--text-secondary)]">
              שיחות שמחכות לטיפול
            </p>
          </div>
          <IconButton
            label="שיחה חדשה"
            onClick={() => toast("פעולה מדומה — יצירת שיחה חדשה אינה מחוברת עדיין")}
          >
            <Plus className="size-[18px]" strokeWidth={1.75} />
          </IconButton>
        </div>

        <label className="relative block">
          <span className="sr-only">חיפוש בשיחות</span>
          <Search
            className="pointer-events-none absolute top-1/2 right-3 size-[18px] -translate-y-1/2 text-[var(--text-muted)]"
            strokeWidth={1.75}
          />
          <input
            type="search"
            placeholder="חיפוש בשיחות"
            className="h-10 w-full rounded-[var(--radius-field)] border border-[var(--border)] bg-[var(--surface)] pe-3 ps-10 text-[14px] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)]"
          />
        </label>

        <div className="flex items-center gap-1">
          {filters.map((filter) => (
            <MonoPill
              key={filter.id}
              size="sm"
              active={state.selectedQueue === filter.id}
              onClick={() => dispatch({ type: "SET_QUEUE", queue: filter.id })}
            >
              {filter.label}
            </MonoPill>
          ))}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex size-8 items-center justify-center rounded-[var(--radius-icon)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
                aria-label="עוד פילטרים"
              >
                <MoreHorizontal className="size-4" strokeWidth={1.75} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => toast("מסנן הושלם יופיע במסך המשימות")}>
                הושלם
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => toast("מסנן משימות זמין במסך המשימות")}>
                משימות
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto" role="listbox" aria-label="רשימת שיחות">
        {list.length === 0 ? (
          <div className="px-4 py-10 text-center text-[14px] text-[var(--text-secondary)]">
            אין שיחות בתור זה
          </div>
        ) : (
          list.map((thread, index) => {
            const person = getThreadPrimaryParticipant(thread);
            const selected = thread.id === activeThreadId;
            const status = statusLabel(thread);

            return (
              <div key={thread.id}>
                {index > 0 ? <div className="mx-4 h-px bg-[var(--border)]" /> : null}
                <Link
                  href={`/inbox/${thread.id}`}
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    if (thread.unread) {
                      dispatch({ type: "MARK_THREAD_READ", threadId: thread.id });
                    }
                  }}
                  className={cn(
                    "relative flex gap-3 px-4 py-3",
                    selected ? "bg-[var(--surface-selected)]" : "hover:bg-[var(--surface-hover)]",
                  )}
                >
                  {selected ? (
                    <span className="absolute top-3 bottom-3 right-0 w-[2px] bg-[var(--action-primary)]" />
                  ) : null}

                  <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-avatar)] bg-[var(--surface)] text-[12px] font-semibold text-[var(--text-primary)] ring-1 ring-[var(--border)]">
                    {person?.initials ?? "?"}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="truncate text-[14px] font-medium text-[var(--text-primary)]">
                        <bdi>{person?.name ?? "ללא שם"}</bdi>
                      </div>
                      <time
                        className="shrink-0 text-[12px] text-[var(--text-muted)]"
                        dateTime={thread.updatedAt}
                      >
                        {formatThreadTime(thread.updatedAt)}
                      </time>
                    </div>
                    <div className="mt-0.5 truncate text-[13px] text-[var(--text-primary)]">
                      <span className="bidi-content" dir="auto">
                        {thread.subject}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-[13px] text-[var(--text-secondary)]">
                      <span className="bidi-content" dir="auto">
                        {thread.snippet}
                      </span>
                    </div>
                    {status ? (
                      <div className="mt-1 text-[12px] text-[var(--text-muted)]">{status}</div>
                    ) : null}
                  </div>
                </Link>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
