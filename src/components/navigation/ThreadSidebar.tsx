"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  ChevronDown,
  CircleAlert,
  FilePenLine,
  Inbox,
  Mail,
  Paperclip,
  Search,
  Send,
  SquarePen,
  Star,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { formatThreadTime } from "@/lib/format";
import { getDisplayInitials } from "@/lib/initials";
import {
  getThreadAttachmentCount,
  getThreadPrimaryParticipant,
  getThreadsByInboxFilter,
  isDraftThread,
  mailboxDisplayCounts,
  type MailboxView,
} from "@/mocks";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useWorkspace } from "@/state/workspace";
import type { Thread } from "@/types/domain";

const SMART_VIEWS: {
  id: MailboxView;
  label: string;
  icon: typeof Inbox;
  countKey: keyof typeof mailboxDisplayCounts;
}[] = [
  { id: "inbox", label: "נכנס", icon: Inbox, countKey: "inbox" },
  { id: "unread", label: "לא נקראו", icon: Mail, countKey: "unread" },
  { id: "starred", label: "מועדפים", icon: Star, countKey: "starred" },
];

const MAILBOX_FOLDERS: {
  id: MailboxView;
  label: string;
  icon: typeof Inbox;
  countKey: keyof typeof mailboxDisplayCounts;
}[] = [
  { id: "sent", label: "נשלחו", icon: Send, countKey: "sent" },
  { id: "drafts", label: "טיוטות", icon: FilePenLine, countKey: "drafts" },
  { id: "archive", label: "ארכיון", icon: Archive, countKey: "archive" },
  { id: "trash", label: "אשפה", icon: Trash2, countKey: "trash" },
];

function resolveThread(thread: Thread, overrides: Record<string, Partial<Thread>>) {
  const override = overrides[thread.id];
  if (!override) return thread;
  return { ...thread, ...override };
}

function mailboxOption(view: MailboxView) {
  return (
    [...SMART_VIEWS, ...MAILBOX_FOLDERS].find((o) => o.id === view) ??
    SMART_VIEWS[0]
  );
}

function mailboxCount(view: MailboxView) {
  return mailboxDisplayCounts[mailboxOption(view).countKey];
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function ThreadAvatar({
  name,
  avatarUrl,
}: {
  name: string;
  avatarUrl?: string;
}) {
  const initials = getDisplayInitials(name);
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt=""
        className="size-9 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--surface-hover)] text-[12px] font-semibold text-[var(--text-primary)]">
      {initials}
    </div>
  );
}

function ThreadRow({
  thread,
  selected,
  starred,
  onSelect,
  onStar,
  onArchive,
}: {
  thread: Thread;
  selected: boolean;
  starred: boolean;
  onSelect: () => void;
  onStar: (e: React.MouseEvent) => void;
  onArchive: (e: React.MouseEvent) => void;
}) {
  const person = getThreadPrimaryParticipant(thread);
  const name = person?.name ?? "ללא שם";
  const unread = thread.unread;
  const draft = isDraftThread(thread.id);
  const hasFiles = getThreadAttachmentCount(thread.id) > 0;
  const sendFailed = Boolean(thread.sendFailed);

  return (
    <Link
      href={`/inbox/${thread.id}`}
      prefetch={false}
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        "group relative flex gap-3 border-b border-[var(--border)] px-3 py-3 transition-[background-color] duration-[120ms]",
        selected
          ? "bg-[var(--surface-selected)]"
          : "hover:bg-[var(--surface-hover)]",
      )}
      style={
        selected
          ? { borderInlineStart: "2px solid var(--border-strong)" }
          : undefined
      }
    >
      <ThreadAvatar name={name} avatarUrl={person?.avatarUrl} />

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span
              className={cn(
                "truncate text-[13.5px] text-[#212529]",
                unread ? "font-semibold" : "font-medium",
              )}
            >
              <bdi>{name}</bdi>
            </span>
            {unread ? (
              <span
                className="size-1.5 shrink-0 rounded-full bg-[#003BFF]"
                aria-label="לא נקרא"
              />
            ) : null}
            {starred ? (
              <Star
                className="size-3.5 shrink-0 text-[#212529]"
                strokeWidth={1.75}
                fill="currentColor"
                aria-label="מועדף"
              />
            ) : null}
          </div>

          <div className="relative flex h-7 shrink-0 items-center justify-end gap-1.5">
            <div className="flex items-center gap-1 transition-opacity group-hover:pointer-events-none group-hover:opacity-0">
              {hasFiles ? (
                <Paperclip
                  className="size-3.5 text-[#9AA0A6]"
                  strokeWidth={1.75}
                  aria-label="קבצים מצורפים"
                />
              ) : null}
              <time
                className="text-[11.5px] text-[#9AA0A6]"
                dateTime={thread.updatedAt}
              >
                {formatThreadTime(thread.updatedAt)}
              </time>
            </div>
            <div className="absolute end-0 top-0 hidden items-center gap-0.5 group-hover:flex">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={starred ? "הסר ממועדפים" : "הוסף למועדפים"}
                    onClick={onStar}
                    className="inline-flex size-7 items-center justify-center rounded-[8px] text-[#9AA0A6] hover:bg-white hover:text-[#212529]"
                  >
                    <Star
                      className="size-4"
                      strokeWidth={1.75}
                      fill={starred ? "currentColor" : "none"}
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {starred ? "הסר ממועדפים" : "הוסף למועדפים"}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="העבר לארכיון"
                    onClick={onArchive}
                    className="inline-flex size-7 items-center justify-center rounded-[8px] text-[#9AA0A6] hover:bg-white hover:text-[#212529]"
                  >
                    <Archive className="size-4" strokeWidth={1.75} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>העבר לארכיון</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>

        <div
          className={cn(
            "mt-0.5 truncate text-[13px] text-[#212529]",
            unread ? "font-semibold" : "font-medium",
          )}
        >
          <span className="bidi-content" dir="auto">
            {thread.subject}
          </span>
        </div>

        <div className="mt-0.5 line-clamp-2 text-[12.5px] leading-[1.35] text-[#6C757D]">
          {draft ? (
            <>
              <span className="font-semibold text-[#212529]">טיוטה:</span>{" "}
            </>
          ) : null}
          <span
            className="bidi-content"
            dir="auto"
            style={{ unicodeBidi: "plaintext" }}
          >
            {thread.snippet}
          </span>
        </div>

        {sendFailed ? (
          <div className="mt-1.5 flex items-center gap-1 text-[11.5px] font-medium text-red-600">
            <CircleAlert className="size-3.5 shrink-0" strokeWidth={1.75} />
            <span>השליחה נכשלה</span>
          </div>
        ) : null}
      </div>
    </Link>
  );
}

export function ThreadSidebar({ activeThreadId }: { activeThreadId: string | null }) {
  const router = useRouter();
  const { state, dispatch } = useWorkspace();
  const [query, setQuery] = React.useState("");
  const searchRef = React.useRef<HTMLInputElement>(null);

  const list = getThreadsByInboxFilter(state.mailboxView, {
    starredThreadIds: state.starredThreadIds,
    archivedThreadIds: state.archivedThreadIds,
    deletedThreadIds: state.deletedThreadIds,
    smartFilter: "all",
    query,
    includeComposeDraft: Boolean(state.composer.composeNew),
  }).map((t) =>
    resolveThread(t, state.threadOverrides as Record<string, Partial<Thread>>),
  );

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        router.push("/search");
        return;
      }
      if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        if (isEditableTarget(event.target)) return;
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router]);

  const count = mailboxCount(state.mailboxView);
  const current = mailboxOption(state.mailboxView);
  const TitleIcon = current.icon;
  const title = current.label;
  const searching = query.trim().length > 0;

  const composeNew = () => {
    dispatch({ type: "START_COMPOSE_NEW" });
    dispatch({ type: "SAVE_DRAFT" });
    router.push("/inbox/compose");
    toast.success("טיוטה חדשה נשמרה", {
      action: {
        label: "ביטול",
        onClick: () => {
          dispatch({ type: "CLEAR_COMPOSE_NEW" });
          router.push("/inbox");
        },
      },
    });
  };

  return (
    <aside className="flex h-full min-h-0 w-full flex-col bg-white">
      <div className="sticky top-0 z-10 shrink-0 space-y-3 border-b border-[var(--border)] bg-white px-3 pt-3 pb-3">
        <div className="flex items-center justify-between gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex min-w-0 items-center gap-1.5 rounded-[10px] px-1.5 py-1 text-start hover:bg-[var(--surface-hover)]"
              >
                <TitleIcon
                  className="size-4 shrink-0 text-[var(--text-secondary)]"
                  strokeWidth={1.75}
                />
                <span className="truncate text-[16px] font-semibold tracking-tight text-[var(--text-primary)]">
                  {title}
                </span>
                {count != null ? (
                  <span className="text-[14px] font-medium text-[var(--text-muted)]">
                    {count}
                  </span>
                ) : null}
                <ChevronDown
                  className="size-4 shrink-0 text-[var(--text-secondary)]"
                  strokeWidth={1.75}
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[200px]">
              {SMART_VIEWS.map((option) => {
                const Icon = option.icon;
                return (
                  <DropdownMenuItem
                    key={option.id}
                    onSelect={() =>
                      dispatch({ type: "SET_MAILBOX_VIEW", view: option.id })
                    }
                    className="gap-2"
                  >
                    <Icon className="size-4" strokeWidth={1.75} />
                    <span className="flex-1">{option.label}</span>
                    <span className="text-[12px] text-[var(--text-muted)]">
                      {mailboxDisplayCounts[option.countKey]}
                    </span>
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuSeparator />
              {MAILBOX_FOLDERS.map((option) => {
                const Icon = option.icon;
                return (
                  <DropdownMenuItem
                    key={option.id}
                    onSelect={() =>
                      dispatch({ type: "SET_MAILBOX_VIEW", view: option.id })
                    }
                    className="gap-2"
                  >
                    <Icon className="size-4" strokeWidth={1.75} />
                    <span className="flex-1">{option.label}</span>
                    <span className="text-[12px] text-[var(--text-muted)]">
                      {mailboxDisplayCounts[option.countKey]}
                    </span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          <button
            type="button"
            onClick={composeNew}
            className="inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-[var(--radius-pill)] bg-[#3F4548] px-3.5 text-[13px] font-medium text-white transition-colors hover:bg-[#2F3437]"
          >
            <SquarePen className="size-4" strokeWidth={1.75} />
            מייל חדש
          </button>
        </div>

        <label className="relative block">
          <span className="sr-only">חיפוש</span>
          <Search
            className="pointer-events-none absolute top-1/2 right-3 size-[16px] -translate-y-1/2 text-[var(--text-muted)]"
            strokeWidth={1.75}
          />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setQuery("");
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder="חיפוש"
            className="h-9 w-full rounded-[10px] border border-[var(--border)] bg-white pe-3 ps-10 text-[13.5px] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)]"
          />
        </label>
      </div>

      <div
        className="thin-scroll min-h-0 flex-1 overflow-y-auto"
        role="listbox"
        aria-label="רשימת שיחות"
      >
        {list.length === 0 ? (
          <div className="px-4 py-12 text-center text-[14px] text-[#6C757D]">
            {searching
              ? "לא נמצאו מיילים שתואמים לסינון"
              : "אין כאן שיחות כרגע"}
          </div>
        ) : (
          list.map((thread) => {
            const starred = state.starredThreadIds.includes(thread.id);
            return (
              <ThreadRow
                key={thread.id}
                thread={thread}
                selected={thread.id === activeThreadId}
                starred={starred}
                onSelect={() => {
                  dispatch({ type: "CLEAR_COMPOSE_NEW" });
                  if (thread.unread) {
                    dispatch({
                      type: "MARK_THREAD_READ",
                      threadId: thread.id,
                    });
                  }
                }}
                onStar={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  dispatch({ type: "TOGGLE_STAR_THREAD", threadId: thread.id });
                  toast(starred ? "הוסר מהמועדפים" : "השיחה נוספה למועדפים", {
                    action: {
                      label: "ביטול",
                      onClick: () =>
                        dispatch({
                          type: "TOGGLE_STAR_THREAD",
                          threadId: thread.id,
                        }),
                    },
                  });
                }}
                onArchive={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  dispatch({ type: "ARCHIVE_THREAD", threadId: thread.id });
                  toast("השיחה הועברה לארכיון", {
                    action: {
                      label: "ביטול",
                      onClick: () =>
                        dispatch({
                          type: "UNARCHIVE_THREAD",
                          threadId: thread.id,
                        }),
                    },
                  });
                }}
              />
            );
          })
        )}
      </div>
    </aside>
  );
}
