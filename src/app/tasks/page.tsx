"use client";

import Link from "next/link";
import { CheckCircle2, Circle, ListTodo } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatMessageDateTime } from "@/lib/format";
import { getAllTasks, getThread } from "@/mocks";
import { SecondaryShell } from "@/components/shell/SecondaryShell";
import { useWorkspace } from "@/state/workspace";
import type { Task } from "@/types/domain";

function TaskRow({
  task,
  completed,
  onToggle,
}: {
  task: Task;
  completed: boolean;
  onToggle: () => void;
}) {
  const thread = getThread(task.sourceThreadId);
  const status = completed || task.status === "completed" ? "completed" : task.status;

  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <button
        type="button"
        aria-label={status === "completed" ? "סמן כפתוח" : "סמן כהושלם"}
        onClick={onToggle}
        className="mt-0.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      >
        {status === "completed" ? (
          <CheckCircle2 className="size-5" strokeWidth={1.75} />
        ) : (
          <Circle className="size-5" strokeWidth={1.75} />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-[14.5px] font-medium text-[var(--text-primary)]",
            status === "completed" && "text-[var(--text-muted)] line-through",
            status === "cancelled" && "text-[var(--text-muted)]",
          )}
        >
          {task.title}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-[var(--text-secondary)]">
          <bdi>{task.sourceSenderName}</bdi>
          <span aria-hidden>·</span>
          <span dir="ltr">{task.sourceSenderEmail}</span>
          {task.dueDate ? (
            <>
              <span aria-hidden>·</span>
              <span>יעד {formatMessageDateTime(task.dueDate)}</span>
            </>
          ) : null}
        </div>
        {thread ? (
          <Link
            href={`/inbox/${task.sourceThreadId}?m=${task.sourceMessageId}`}
            className="mt-1.5 inline-block text-[12.5px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            {thread.subject}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

export default function TasksPage() {
  const { state, dispatch } = useWorkspace();
  const mockTasks = getAllTasks();
  const allTasks = [...state.userTasks, ...mockTasks.filter(
    (t) => !state.userTasks.some((u) => u.id === t.id),
  )];

  const open = allTasks.filter(
    (t) =>
      t.status === "open" &&
      !state.completedTaskIds.includes(t.id),
  );
  const done = allTasks.filter(
    (t) =>
      t.status === "completed" ||
      state.completedTaskIds.includes(t.id),
  );

  const toggle = (task: Task) => {
    const isDone =
      task.status === "completed" || state.completedTaskIds.includes(task.id);
    if (isDone) {
      dispatch({ type: "UNDO_COMPLETE_TASK", taskId: task.id });
    } else {
      dispatch({ type: "COMPLETE_TASK", taskId: task.id });
    }
  };

  return (
    <SecondaryShell title="משימות">
      <div className="border-b border-[var(--border)] px-8 py-5">
        <div className="flex items-center gap-2">
          <ListTodo className="size-5 text-[var(--text-secondary)]" strokeWidth={1.75} />
          <h1 className="text-[22px] font-semibold tracking-tight text-[var(--text-primary)]">
            משימות
          </h1>
        </div>
        <p className="mt-1 text-[14px] text-[var(--text-secondary)]">
          משימות שנוצרו מהודעות או מפעולות שזוהו ואושרו
        </p>
      </div>

      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <section className="mb-8 max-w-2xl">
          <h2 className="mb-2 text-[13px] font-semibold text-[var(--text-primary)]">
            פתוחות · {open.length}
          </h2>
          {open.length === 0 ? (
            <p className="text-[14px] text-[var(--text-secondary)]">אין משימות פתוחות</p>
          ) : (
            <div className="divide-y divide-[var(--border)] rounded-[16px] border border-[var(--border)] bg-white">
              {open.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  completed={false}
                  onToggle={() => toggle(task)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="max-w-2xl">
          <h2 className="mb-2 text-[13px] font-semibold text-[var(--text-primary)]">
            הושלמו · {done.length}
          </h2>
          {done.length === 0 ? (
            <p className="text-[14px] text-[var(--text-secondary)]">אין משימות שהושלמו</p>
          ) : (
            <div className="divide-y divide-[var(--border)] rounded-[16px] border border-[var(--border)] bg-white">
              {done.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  completed
                  onToggle={() => toggle(task)}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </SecondaryShell>
  );
}
