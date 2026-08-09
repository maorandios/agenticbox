"use client";

import * as React from "react";
import {
  ChevronRight,
  ListPlus,
  ListTodo,
  MoreHorizontal,
  PencilSparkles,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { CURRENT_USER_ID } from "@/mocks";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getPrimaryActionState,
  useWorkspace,
  type PrimaryActionState,
} from "@/state/workspace";
import type { ThreadPrimaryAction } from "@/types/domain";

const ACTION_PREVIEW_LIMIT = 4;

export function composeDraftFromActions(actions: { title: string }[]) {
  if (actions.length === 0) return "";
  if (actions.length === 1) {
    return `שלום,\n\nמתייחס לנושא: ${actions[0].title}.\n\nאשמח לעדכן בהתאם.`;
  }
  const bullets = actions.map((a, i) => `${i + 1}. ${a.title}`).join("\n");
  return `שלום,\n\nמתייחס לפעולות הבאות:\n${bullets}\n\nאשמח לעדכן בהתאם.`;
}

export function resolvePrimaryActionTitle(
  action: ThreadPrimaryAction,
  actionState: PrimaryActionState,
) {
  return actionState.titleOverride?.trim() || action.title;
}

function ActionRow({
  title,
  editing,
  draftTitle,
  inputRef,
  onDraftTitleChange,
  onCommitEdit,
  onCancelEdit,
  onAddTask,
  onComplete,
  onWaiting,
  onNotMine,
  onDismiss,
  onStartEdit,
}: {
  title: string;
  editing: boolean;
  draftTitle: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onDraftTitleChange: (value: string) => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onAddTask: () => void;
  onComplete: () => void;
  onWaiting: () => void;
  onNotMine: () => void;
  onDismiss: () => void;
  onStartEdit: () => void;
}) {
  return (
    <div className="flex items-start gap-2 py-[11px]">
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            ref={inputRef}
            value={draftTitle}
            onChange={(e) => onDraftTitleChange(e.target.value)}
            onBlur={onCommitEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onCommitEdit();
              }
              if (e.key === "Escape") onCancelEdit();
            }}
            className="w-full rounded-[8px] border border-white/25 bg-white/10 px-2 py-1 text-[14px] font-semibold text-white outline-none focus:border-white/50"
            dir="auto"
          />
        ) : (
          <p className="text-[14px] leading-[1.45] font-semibold text-white">
            {title}
          </p>
        )}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-white/65 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="אפשרויות פעולה"
          >
            <MoreHorizontal className="size-4" strokeWidth={1.75} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[200px]">
          <DropdownMenuItem onSelect={onAddTask}>הוסף למשימות שלי</DropdownMenuItem>
          <DropdownMenuItem onSelect={onComplete}>כבר בוצע</DropdownMenuItem>
          <DropdownMenuItem onSelect={onWaiting}>סמן כממתין</DropdownMenuItem>
          <DropdownMenuItem onSelect={onNotMine}>לא באחריותי</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onDismiss}>זו לא משימה</DropdownMenuItem>
          <DropdownMenuItem onSelect={onStartEdit}>ערוך פעולה</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function NeedsYouCard({
  threadId,
  actions,
  draftReply,
}: {
  threadId: string;
  actions: ThreadPrimaryAction[];
  draftReply?: string;
}) {
  const { state, dispatch } = useWorkspace();
  const [expanded, setExpanded] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draftTitle, setDraftTitle] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  const active = React.useMemo(() => {
    return actions
      .map((action) => {
        const actionState = getPrimaryActionState(
          state.primaryActionStates,
          action.id,
        );
        return {
          action,
          actionState,
          title: resolvePrimaryActionTitle(action, actionState),
        };
      })
      .filter((r) => r.actionState.status === "active");
  }, [actions, state.primaryActionStates]);

  React.useEffect(() => {
    if (editingId) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editingId]);

  if (active.length === 0) return null;

  const preview = active.slice(0, ACTION_PREVIEW_LIMIT);
  const rest = active.slice(ACTION_PREVIEW_LIMIT);

  const addTask = (action: ThreadPrimaryAction, title: string) => {
    const existing = getPrimaryActionState(state.primaryActionStates, action.id);
    if (existing.linkedTaskId) {
      toast("הפעולה כבר נוספה למשימות");
      return;
    }
    dispatch({
      type: "ADD_TASK_FROM_ACTION",
      actionId: action.id,
      task: {
        id: `user-task-${action.id}`,
        title,
        threadId,
        assigneeId: CURRENT_USER_ID,
        status: "open",
        sourceMessageId: action.sourceMessageId,
      },
    });
    toast.success("נוסף למשימות שלך");
  };

  const addAllTasks = () => {
    let added = 0;
    for (const { action, title, actionState } of active) {
      if (actionState.linkedTaskId) continue;
      dispatch({
        type: "ADD_TASK_FROM_ACTION",
        actionId: action.id,
        task: {
          id: `user-task-${action.id}`,
          title,
          threadId,
          assigneeId: CURRENT_USER_ID,
          status: "open",
          sourceMessageId: action.sourceMessageId,
        },
      });
      added += 1;
    }
    if (added === 0) toast("כל הפעולות כבר במשימות");
    else toast.success(added === 1 ? "נוספה משימה אחת" : `נוספו ${added} משימות`);
  };

  const dismissAction = (actionId: string, previous: PrimaryActionState) => {
    dispatch({
      type: "SET_PRIMARY_ACTION_STATUS",
      actionId,
      status: "dismissed",
    });
    toast("הפעולה הוסרה ולא תתווסף למשימות שלך", {
      action: {
        label: "ביטול",
        onClick: () =>
          dispatch({
            type: "RESTORE_PRIMARY_ACTION",
            actionId,
            previous,
          }),
      },
    });
  };

  const commitEdit = (actionId: string) => {
    const next = draftTitle.trim();
    if (next) {
      dispatch({
        type: "UPDATE_PRIMARY_ACTION_TITLE",
        actionId,
        title: next,
      });
    }
    setEditingId(null);
  };

  const draftText =
    active.length === actions.length && draftReply
      ? draftReply
      : composeDraftFromActions(active.map((a) => ({ title: a.title })));

  const rowProps = (item: (typeof active)[number]) => ({
    title: item.title,
    editing: editingId === item.action.id,
    draftTitle,
    inputRef,
    onDraftTitleChange: setDraftTitle,
    onCommitEdit: () => commitEdit(item.action.id),
    onCancelEdit: () => setEditingId(null),
    onAddTask: () => addTask(item.action, item.title),
    onComplete: () => {
      dispatch({
        type: "SET_PRIMARY_ACTION_STATUS",
        actionId: item.action.id,
        status: "completed",
      });
      toast.success("סומן כבוצע");
    },
    onWaiting: () => {
      dispatch({
        type: "SET_PRIMARY_ACTION_STATUS",
        actionId: item.action.id,
        status: "waiting",
      });
      toast("סומן כממתין");
    },
    onNotMine: () => {
      dispatch({
        type: "SET_PRIMARY_ACTION_STATUS",
        actionId: item.action.id,
        status: "not_mine",
      });
      toast("הוסר ממשימות שלך — נשאר במצב השרשור");
    },
    onDismiss: () => dismissAction(item.action.id, item.actionState),
    onStartEdit: () => {
      setDraftTitle(item.title);
      setEditingId(item.action.id);
    },
  });

  return (
    <section className="sticky top-0 z-10 rounded-[16px] border border-[var(--action-primary)] bg-[var(--action-primary)] p-4 text-[var(--action-on-primary)]">
      <div className="mb-1 flex items-center gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <ListTodo className="size-3.5 shrink-0 text-white/85" strokeWidth={1.75} />
          <h3 className="text-[12.5px] font-semibold text-white/85">נדרש ממך</h3>
        </div>
      </div>

      <div className="divide-y divide-white/15">
        {preview.map((item) => (
          <ActionRow key={item.action.id} {...rowProps(item)} />
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
              <div className="divide-y divide-white/15 border-t border-white/15">
                {rest.map((item) => (
                  <ActionRow key={item.action.id} {...rowProps(item)} />
                ))}
              </div>
            </div>
          </div>

          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-[10px] border border-white/25 bg-white/5 px-3 py-1.5 text-[11.5px] font-medium text-white/75 transition-colors hover:bg-white/10 hover:text-white"
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

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            dispatch({ type: "SET_COMPOSER_TEXT", text: draftText });
            toast.success("טיוטת תשובה הוכנסה ל־Composer");
          }}
          className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-pill)] bg-white px-3.5 text-[12px] font-medium text-[var(--action-primary)] transition-colors duration-[140ms] hover:bg-white/90"
        >
          <PencilSparkles className="size-3.5" strokeWidth={1.75} />
          נסח תשובה
        </button>
        <button
          type="button"
          onClick={addAllTasks}
          className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-pill)] border border-white/40 bg-transparent px-3.5 text-[12px] font-medium text-white transition-colors duration-[140ms] hover:bg-white/10"
        >
          <ListPlus className="size-3.5" strokeWidth={1.75} />
          הוסף הכל למשימות שלי
        </button>
      </div>
    </section>
  );
}
