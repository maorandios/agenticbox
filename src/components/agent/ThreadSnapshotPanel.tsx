"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import {
  BadgeCheck,
  ChevronRight,
  CircleUserRound,
  Clock3,
  History,
  ListChecks,
  Mail,
  MoveLeft,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { getEmailDataSource } from "@/lib/email-data-source";
import { useMailUi } from "@/lib/email-data-source/mail-ui-context";
import { NeedsYouCard } from "@/components/agent/NeedsYouCard";
import { ThreadAiPanel } from "@/components/agent/ThreadAiPanel";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useWorkspace } from "@/state/workspace";
import type { ThreadSnapshot, ThreadSnapshotItem } from "@/types/domain";

const PREVIEW_LIMIT = 3;

function sortTasks(items: ThreadSnapshotItem[], currentUserId: string) {
  return [...items].sort((a, b) => {
    const aMine = a.assigneeId === currentUserId ? 0 : 1;
    const bMine = b.assigneeId === currentUserId ? 0 : 1;
    return aMine - bMine;
  });
}

function SectionIcon({ icon: Icon }: { icon: LucideIcon }) {
  return <Icon className="size-3.5 shrink-0 text-[var(--text-secondary)]" strokeWidth={1.75} />;
}

function SnapshotRow({
  item,
  onSelect,
  showDueInline = false,
}: {
  item: ThreadSnapshotItem;
  onSelect: (messageId: string) => void;
  showDueInline?: boolean;
}) {
  const line = item.body ?? item.title;

  return (
    <button
      type="button"
      onClick={() => onSelect(item.sourceMessageId)}
      className="group relative flex w-full items-start gap-2 py-2 text-start"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[8px] opacity-0 transition-opacity duration-[140ms] group-hover:opacity-100"
        style={{
          background:
            "linear-gradient(to right, rgba(241, 243, 245, 0.95) 0%, rgba(241, 243, 245, 0.4) 45%, rgba(241, 243, 245, 0) 100%)",
        }}
      />

      <span className="relative z-[1] min-w-0 flex-1">
        <span className="block text-[12px] leading-[1.5] text-[var(--text-primary)]">
          <span>{line}</span>
          {showDueInline && item.dueLabel ? (
            <span className="text-[var(--text-muted)]"> · {item.dueLabel}</span>
          ) : null}
        </span>

        <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] leading-none text-[var(--text-muted)]">
          <span className="inline-flex min-w-0 items-center gap-1">
            <CircleUserRound className="size-[10.5px] shrink-0" strokeWidth={1.75} />
            <span className="truncate leading-[1.4]">
              <bdi>{item.userName}</bdi>
            </span>
          </span>
          <span className="text-[var(--border-strong)]" aria-hidden>
            ·
          </span>
          <span className="inline-flex min-w-0 items-center gap-1">
            <Mail className="size-[10.5px] shrink-0" strokeWidth={1.75} />
            <span className="truncate leading-[1.4]" dir="ltr">
              <bdi>{item.userEmail}</bdi>
            </span>
          </span>
        </span>
      </span>

      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="relative z-[1] mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[var(--text-secondary)] opacity-0 transition-opacity duration-[140ms] group-hover:opacity-100 group-focus-visible:opacity-100"
            aria-hidden
          >
            <MoveLeft className="size-3.5" strokeWidth={1.75} />
          </span>
        </TooltipTrigger>
        <TooltipContent side="left">הצג בהודעה</TooltipContent>
      </Tooltip>
    </button>
  );
}

function SnapshotSection({
  title,
  icon,
  items,
  onSelect,
  currentUserId,
  prioritizeCurrentUser = false,
  showDueInline = false,
}: {
  title: string;
  icon: LucideIcon;
  items: ThreadSnapshotItem[];
  onSelect: (messageId: string) => void;
  currentUserId: string;
  prioritizeCurrentUser?: boolean;
  showDueInline?: boolean;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const ordered = prioritizeCurrentUser
    ? sortTasks(items, currentUserId)
    : items;
  const preview = ordered.slice(0, PREVIEW_LIMIT);
  const rest = ordered.slice(PREVIEW_LIMIT);

  if (ordered.length === 0) return null;

  return (
    <section className="rounded-[14px] border border-[var(--border)] bg-white p-[14px]">
      <div className="mb-1 flex items-center gap-2">
        <SectionIcon icon={icon} />
        <h3 className="text-[11.5px] font-semibold text-[var(--text-secondary)]">{title}</h3>
      </div>

      <div className="divide-y divide-[var(--border)]">
        {preview.map((item) => (
          <SnapshotRow
            key={item.id}
            item={item}
            onSelect={onSelect}
            showDueInline={showDueInline}
          />
        ))}
      </div>

      {rest.length > 0 ? (
        <>
          <div
            className={cn(
              "grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
              expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
            )}
          >
            <div className="min-h-0 overflow-hidden">
              <div className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
                {rest.map((item) => (
                  <SnapshotRow
                    key={item.id}
                    item={item}
                    onSelect={onSelect}
                    showDueInline={showDueInline}
                  />
                ))}
              </div>
            </div>
          </div>

          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-1.5 text-[11.5px] font-medium text-[var(--text-secondary)] transition-colors duration-[140ms] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
          >
            <ChevronRight
              className={cn(
                "size-3.5 shrink-0 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                expanded ? "-rotate-90" : "rotate-90",
              )}
              strokeWidth={1.75}
            />
            {expanded ? "הצג פחות" : `הצג עוד ${rest.length}`}
          </button>
        </>
      ) : null}
    </section>
  );
}

function SnapshotShell({
  threadId,
  ariaLabel,
  children,
}: {
  threadId: string;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  const { state, dispatch } = useWorkspace();
  const insightsRef = React.useRef<HTMLDivElement>(null);
  const aiOpen = state.leftPanelMode === "thread-ai";

  React.useEffect(() => {
    dispatch({ type: "ON_THREAD_CHANGE", threadId });
  }, [threadId, dispatch]);

  React.useEffect(() => {
    if (aiOpen) return;
    const el = insightsRef.current;
    if (!el) return;
    el.scrollTop = state.insightsScrollTop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiOpen, threadId]);

  return (
    <aside
      className="snapshot-panel relative flex h-full w-[var(--snapshot-width)] shrink-0 flex-col overflow-hidden border-r border-[var(--border)] bg-white"
      aria-label={ariaLabel}
    >
      <div
        className={cn(
          "absolute inset-0 flex flex-col transition-[transform,opacity] duration-[320ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform",
          aiOpen
            ? "pointer-events-none translate-x-8 opacity-0"
            : "translate-x-0 opacity-100",
        )}
        aria-hidden={aiOpen}
      >
        <div
          ref={insightsRef}
          className="snapshot-scroll thin-scroll min-h-0 flex-1 space-y-[10px] overflow-y-auto px-[14px] pt-[14px] pb-[14px]"
          onScroll={(e) => {
            dispatch({
              type: "SET_INSIGHTS_SCROLL",
              scrollTop: e.currentTarget.scrollTop,
            });
          }}
        >
          {children}
        </div>
      </div>

      <div
        className={cn(
          "absolute inset-0 flex flex-col transition-[transform,opacity] duration-[320ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform",
          aiOpen
            ? "translate-x-0 opacity-100"
            : "pointer-events-none -translate-x-8 opacity-0",
        )}
        aria-hidden={!aiOpen}
      >
        <ThreadAiPanel threadId={threadId} />
      </div>
    </aside>
  );
}

export function ThreadSnapshotPanel({ threadId }: { threadId: string }) {
  const ds = getEmailDataSource();
  const mail = useMailUi();
  const { dispatch } = useWorkspace();
  const [snapshot, setSnapshot] = React.useState<ThreadSnapshot | null>(null);

  React.useEffect(() => {
    if (!ds.supportsMockAi()) {
      return;
    }
    let cancelled = false;
    void ds.getThreadSnapshot(threadId).then((value) => {
      if (!cancelled) setSnapshot(value);
    });
    return () => {
      cancelled = true;
    };
  }, [ds, threadId]);

  const showSource = (messageId: string) => {
    dispatch({ type: "HIGHLIGHT_MESSAGE", messageId });
  };

  if (!ds.supportsMockAi()) {
    return (
      <SnapshotShell threadId={threadId} ariaLabel="תמונת השרשור">
        <div className="rounded-[14px] border border-[var(--border)] bg-white p-[14px]">
          <p className="text-[12.5px] leading-[1.5] text-[var(--text-secondary)]">
            תובנות הסוכן אינן זמינות במצב קריאה בלבד.
          </p>
        </div>
      </SnapshotShell>
    );
  }

  if (!snapshot) {
    return (
      <SnapshotShell threadId={threadId} ariaLabel="תמונת השרשור">
        <div className="h-24 animate-pulse rounded-[14px] bg-[var(--surface-subtle)]" />
      </SnapshotShell>
    );
  }

  return (
    <SnapshotShell threadId={threadId} ariaLabel="תמונת השרשור">
      {snapshot.primary.mode === "needs_you" ? (
        <NeedsYouCard
          threadId={threadId}
          actions={snapshot.primary.actions}
          draftReply={snapshot.primary.draftReply}
        />
      ) : null}

      <SnapshotSection
        title="שינויים אחרונים"
        icon={History}
        items={snapshot.recentChanges}
        onSelect={showSource}
        currentUserId={mail.currentUserId}
      />
      <SnapshotSection
        title="משימות פתוחות"
        icon={ListChecks}
        items={snapshot.openTasks}
        onSelect={showSource}
        currentUserId={mail.currentUserId}
        prioritizeCurrentUser
        showDueInline
      />
      <SnapshotSection
        title="החלטות שהתקבלו"
        icon={BadgeCheck}
        items={snapshot.decisions}
        onSelect={showSource}
        currentUserId={mail.currentUserId}
      />
      <SnapshotSection
        title="ממתינים"
        icon={Clock3}
        items={snapshot.waitingOn}
        onSelect={showSource}
        currentUserId={mail.currentUserId}
      />
    </SnapshotShell>
  );
}
