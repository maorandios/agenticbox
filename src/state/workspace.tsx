"use client";

import * as React from "react";
import type { MailboxStatus, QueueId, SearchMode, Task } from "@/types/domain";

export type ComposerMode = "reply" | "replyAll" | "forward";

export type InboxFilter = "all" | "needs_reply" | "waiting" | "starred" | "archived";

export type PrimaryActionStatus =
  | "active"
  | "completed"
  | "waiting"
  | "not_mine"
  | "dismissed";

export type PrimaryActionState = {
  status: PrimaryActionStatus;
  titleOverride?: string;
  linkedTaskId?: string;
};

export type WorkspaceState = {
  selectedQueue: InboxFilter;
  panels: {
    navCollapsed: boolean;
    agentOpen: boolean;
  };
  threadOverrides: Record<
    string,
    Partial<{
      unread: boolean;
      status: QueueId;
      projectId: string;
    }>
  >;
  starredThreadIds: string[];
  archivedThreadIds: string[];
  mutedThreadIds: string[];
  deletedThreadIds: string[];
  completedTaskIds: string[];
  dismissedInsightIds: string[];
  approvedInsightIds: string[];
  /** Tasks created from AI-detected actions after user confirmation */
  userTasks: Task[];
  primaryActionStates: Record<string, PrimaryActionState>;
  composer: {
    mode: ComposerMode;
    text: string;
    draftSavedAt?: string;
    /** When set, composer was opened from NeedsYou actions */
    draftActionCount?: number | null;
  };
  improvePreview: string | null;
  commandMenuOpen: boolean;
  search: {
    query: string;
    mode: SearchMode;
    status: "idle" | "loading" | "done" | "insufficient";
    resultId?: string;
  };
  mailboxStatus: MailboxStatus;
  highlightedMessageId: string | null;
};

export type WorkspaceAction =
  | { type: "SET_QUEUE"; queue: InboxFilter }
  | { type: "SET_AGENT_OPEN"; open: boolean }
  | { type: "TOGGLE_AGENT" }
  | { type: "SET_NAV_COLLAPSED"; collapsed: boolean }
  | { type: "MARK_THREAD_READ"; threadId: string }
  | { type: "COMPLETE_TASK"; taskId: string }
  | { type: "UNDO_COMPLETE_TASK"; taskId: string }
  | { type: "DISMISS_INSIGHT"; insightId: string }
  | { type: "APPROVE_INSIGHT"; insightId: string }
  | { type: "SET_COMPOSER_MODE"; mode: ComposerMode }
  | { type: "SET_COMPOSER_TEXT"; text: string }
  | { type: "SET_COMPOSER_FROM_ACTIONS"; text: string; actionCount: number }
  | { type: "SAVE_DRAFT" }
  | { type: "SET_IMPROVE_PREVIEW"; text: string | null }
  | { type: "SET_COMMAND_MENU"; open: boolean }
  | { type: "SET_SEARCH_QUERY"; query: string }
  | { type: "SET_SEARCH_MODE"; mode: SearchMode }
  | { type: "SET_SEARCH_STATUS"; status: WorkspaceState["search"]["status"]; resultId?: string }
  | { type: "ASSIGN_THREAD_PROJECT"; threadId: string; projectId: string }
  | { type: "SET_MAILBOX_STATUS"; status: MailboxStatus }
  | { type: "HIGHLIGHT_MESSAGE"; messageId: string | null }
  | { type: "TOGGLE_STAR_THREAD"; threadId: string }
  | { type: "ARCHIVE_THREAD"; threadId: string }
  | { type: "UNARCHIVE_THREAD"; threadId: string }
  | { type: "TOGGLE_MUTE_THREAD"; threadId: string }
  | { type: "DELETE_THREAD"; threadId: string }
  | { type: "RESTORE_DELETED_THREAD"; threadId: string }
  | { type: "MARK_THREAD_UNREAD"; threadId: string }
  | { type: "SET_THREAD_STATUS"; threadId: string; status: QueueId }
  | {
      type: "ADD_TASK_FROM_ACTION";
      task: Task;
      actionId: string;
    }
  | {
      type: "SET_PRIMARY_ACTION_STATUS";
      actionId: string;
      status: PrimaryActionStatus;
    }
  | {
      type: "UPDATE_PRIMARY_ACTION_TITLE";
      actionId: string;
      title: string;
    }
  | { type: "REMOVE_USER_TASK"; taskId: string }
  | {
      type: "RESTORE_PRIMARY_ACTION";
      actionId: string;
      previous?: PrimaryActionState;
    };

export const initialWorkspaceState: WorkspaceState = {
  selectedQueue: "all",
  panels: {
    navCollapsed: false,
    agentOpen: false,
  },
  threadOverrides: {},
  starredThreadIds: [],
  archivedThreadIds: [],
  mutedThreadIds: [],
  deletedThreadIds: [],
  completedTaskIds: [],
  dismissedInsightIds: [],
  approvedInsightIds: [],
  userTasks: [],
  primaryActionStates: {},
  composer: {
    mode: "reply",
    text: "",
    draftActionCount: null,
  },
  improvePreview: null,
  commandMenuOpen: false,
  search: {
    query: "",
    mode: "nl",
    status: "idle",
  },
  mailboxStatus: "connected",
  highlightedMessageId: null,
};

function patchPrimaryAction(
  state: WorkspaceState,
  actionId: string,
  patch: Partial<PrimaryActionState>,
): WorkspaceState {
  const current = state.primaryActionStates[actionId] ?? { status: "active" as const };
  return {
    ...state,
    primaryActionStates: {
      ...state.primaryActionStates,
      [actionId]: { ...current, ...patch },
    },
  };
}

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  switch (action.type) {
    case "SET_QUEUE":
      return { ...state, selectedQueue: action.queue };
    case "SET_AGENT_OPEN":
      return {
        ...state,
        panels: { ...state.panels, agentOpen: action.open },
      };
    case "TOGGLE_AGENT":
      return {
        ...state,
        panels: { ...state.panels, agentOpen: !state.panels.agentOpen },
      };
    case "SET_NAV_COLLAPSED":
      return {
        ...state,
        panels: { ...state.panels, navCollapsed: action.collapsed },
      };
    case "MARK_THREAD_READ":
      return {
        ...state,
        threadOverrides: {
          ...state.threadOverrides,
          [action.threadId]: {
            ...state.threadOverrides[action.threadId],
            unread: false,
          },
        },
      };
    case "COMPLETE_TASK":
      if (state.completedTaskIds.includes(action.taskId)) return state;
      return {
        ...state,
        completedTaskIds: [...state.completedTaskIds, action.taskId],
        userTasks: state.userTasks.map((t) =>
          t.id === action.taskId ? { ...t, status: "done" } : t,
        ),
      };
    case "UNDO_COMPLETE_TASK":
      return {
        ...state,
        completedTaskIds: state.completedTaskIds.filter((id) => id !== action.taskId),
        userTasks: state.userTasks.map((t) =>
          t.id === action.taskId ? { ...t, status: "open" } : t,
        ),
      };
    case "DISMISS_INSIGHT":
      return {
        ...state,
        dismissedInsightIds: [...state.dismissedInsightIds, action.insightId],
      };
    case "APPROVE_INSIGHT":
      return {
        ...state,
        approvedInsightIds: [...state.approvedInsightIds, action.insightId],
      };
    case "SET_COMPOSER_MODE":
      return { ...state, composer: { ...state.composer, mode: action.mode } };
    case "SET_COMPOSER_TEXT":
      return {
        ...state,
        composer: {
          ...state.composer,
          text: action.text,
          draftActionCount: null,
        },
      };
    case "SET_COMPOSER_FROM_ACTIONS":
      return {
        ...state,
        composer: {
          ...state.composer,
          text: action.text,
          draftActionCount: action.actionCount,
          mode: "replyAll",
        },
      };
    case "SAVE_DRAFT":
      return {
        ...state,
        composer: {
          ...state.composer,
          draftSavedAt: new Date().toISOString(),
        },
      };
    case "SET_IMPROVE_PREVIEW":
      return { ...state, improvePreview: action.text };
    case "SET_COMMAND_MENU":
      return { ...state, commandMenuOpen: action.open };
    case "SET_SEARCH_QUERY":
      return { ...state, search: { ...state.search, query: action.query } };
    case "SET_SEARCH_MODE":
      return { ...state, search: { ...state.search, mode: action.mode } };
    case "SET_SEARCH_STATUS":
      return {
        ...state,
        search: {
          ...state.search,
          status: action.status,
          resultId: action.resultId,
        },
      };
    case "ASSIGN_THREAD_PROJECT":
      return {
        ...state,
        threadOverrides: {
          ...state.threadOverrides,
          [action.threadId]: {
            ...state.threadOverrides[action.threadId],
            projectId: action.projectId,
          },
        },
      };
    case "SET_MAILBOX_STATUS":
      return { ...state, mailboxStatus: action.status };
    case "HIGHLIGHT_MESSAGE":
      return { ...state, highlightedMessageId: action.messageId };
    case "TOGGLE_STAR_THREAD": {
      const starred = state.starredThreadIds.includes(action.threadId);
      return {
        ...state,
        starredThreadIds: starred
          ? state.starredThreadIds.filter((id) => id !== action.threadId)
          : [...state.starredThreadIds, action.threadId],
      };
    }
    case "ARCHIVE_THREAD":
      if (state.archivedThreadIds.includes(action.threadId)) return state;
      return {
        ...state,
        archivedThreadIds: [...state.archivedThreadIds, action.threadId],
      };
    case "UNARCHIVE_THREAD":
      return {
        ...state,
        archivedThreadIds: state.archivedThreadIds.filter((id) => id !== action.threadId),
      };
    case "TOGGLE_MUTE_THREAD": {
      const muted = state.mutedThreadIds.includes(action.threadId);
      return {
        ...state,
        mutedThreadIds: muted
          ? state.mutedThreadIds.filter((id) => id !== action.threadId)
          : [...state.mutedThreadIds, action.threadId],
      };
    }
    case "DELETE_THREAD":
      if (state.deletedThreadIds.includes(action.threadId)) return state;
      return {
        ...state,
        deletedThreadIds: [...state.deletedThreadIds, action.threadId],
      };
    case "RESTORE_DELETED_THREAD":
      return {
        ...state,
        deletedThreadIds: state.deletedThreadIds.filter((id) => id !== action.threadId),
      };
    case "MARK_THREAD_UNREAD":
      return {
        ...state,
        threadOverrides: {
          ...state.threadOverrides,
          [action.threadId]: {
            ...state.threadOverrides[action.threadId],
            unread: true,
          },
        },
      };
    case "SET_THREAD_STATUS":
      return {
        ...state,
        threadOverrides: {
          ...state.threadOverrides,
          [action.threadId]: {
            ...state.threadOverrides[action.threadId],
            status: action.status,
          },
        },
      };
    case "ADD_TASK_FROM_ACTION": {
      if (state.userTasks.some((t) => t.id === action.task.id)) {
        return patchPrimaryAction(state, action.actionId, {
          linkedTaskId: action.task.id,
          status: "active",
        });
      }
      return patchPrimaryAction(
        {
          ...state,
          userTasks: [...state.userTasks, action.task],
        },
        action.actionId,
        { linkedTaskId: action.task.id, status: "active" },
      );
    }
    case "SET_PRIMARY_ACTION_STATUS": {
      let next = patchPrimaryAction(state, action.actionId, {
        status: action.status,
      });
      const linkedId = next.primaryActionStates[action.actionId]?.linkedTaskId;
      if (linkedId && action.status === "completed") {
        next = {
          ...next,
          completedTaskIds: next.completedTaskIds.includes(linkedId)
            ? next.completedTaskIds
            : [...next.completedTaskIds, linkedId],
          userTasks: next.userTasks.map((t) =>
            t.id === linkedId ? { ...t, status: "done" } : t,
          ),
        };
      }
      if (linkedId && action.status === "waiting") {
        next = {
          ...next,
          userTasks: next.userTasks.map((t) =>
            t.id === linkedId ? { ...t, status: "waiting" } : t,
          ),
        };
      }
      if (linkedId && action.status === "not_mine") {
        next = {
          ...next,
          userTasks: next.userTasks.filter((t) => t.id !== linkedId),
          primaryActionStates: {
            ...next.primaryActionStates,
            [action.actionId]: {
              ...next.primaryActionStates[action.actionId],
              linkedTaskId: undefined,
              status: "not_mine",
            },
          },
        };
      }
      return next;
    }
    case "UPDATE_PRIMARY_ACTION_TITLE":
      return patchPrimaryAction(state, action.actionId, {
        titleOverride: action.title,
      });
    case "REMOVE_USER_TASK":
      return {
        ...state,
        userTasks: state.userTasks.filter((t) => t.id !== action.taskId),
      };
    case "RESTORE_PRIMARY_ACTION":
      if (!action.previous) {
        const { [action.actionId]: _, ...rest } = state.primaryActionStates;
        return { ...state, primaryActionStates: rest };
      }
      return {
        ...state,
        primaryActionStates: {
          ...state.primaryActionStates,
          [action.actionId]: action.previous,
        },
      };
    default:
      return state;
  }
}

type WorkspaceContextValue = {
  state: WorkspaceState;
  dispatch: React.Dispatch<WorkspaceAction>;
};

const WorkspaceContext = React.createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = React.useReducer(workspaceReducer, initialWorkspaceState);

  const value = React.useMemo(() => ({ state, dispatch }), [state]);

  return (
    <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const ctx = React.useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used within WorkspaceProvider");
  }
  return ctx;
}

export function getPrimaryActionState(
  states: Record<string, PrimaryActionState>,
  actionId: string,
): PrimaryActionState {
  return states[actionId] ?? { status: "active" };
}
