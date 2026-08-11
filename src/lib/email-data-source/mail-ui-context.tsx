"use client";

import * as React from "react";
import {
  getEmailDataSource,
  isApiEmailDataSource,
} from "@/lib/email-data-source";
import {
  CURRENT_USER_ID,
  getParticipant as mockGetParticipant,
} from "@/mocks";
import type { Attachment, Participant } from "@/types/domain";
import type { MailAccountSummary } from "./types";

type MailUiContextValue = {
  mode: "mock" | "api";
  writeActionsDisabled: boolean;
  currentUserId: string;
  account: MailAccountSummary | null;
  participants: Map<string, Participant>;
  attachmentsByMessage: Map<string, Attachment[]>;
  setParticipants: (list: Participant[]) => void;
  setAttachments: (list: Attachment[]) => void;
  setAccount: (account: MailAccountSummary | null) => void;
  getParticipant: (id: string) => Participant | undefined;
  getBubbleAttachments: (messageId: string, attachmentIds?: string[]) => Attachment[];
};

const MailUiContext = React.createContext<MailUiContextValue | null>(null);

export function MailUiProvider({ children }: { children: React.ReactNode }) {
  const ds = getEmailDataSource();
  const apiMode = isApiEmailDataSource();
  const [account, setAccount] = React.useState<MailAccountSummary | null>(null);
  const [participants, setParticipantsState] = React.useState(
    () => new Map<string, Participant>(),
  );
  const [attachmentsByMessage, setAttachmentsState] = React.useState(
    () => new Map<string, Attachment[]>(),
  );

  React.useEffect(() => {
    if (!apiMode) return;
    let cancelled = false;
    void ds.getMailAccount().then((value) => {
      if (!cancelled) setAccount(value);
    }).catch(() => {
      if (!cancelled) setAccount(null);
    });
    return () => {
      cancelled = true;
    };
  }, [apiMode, ds]);

  const setParticipants = React.useCallback((list: Participant[]) => {
    setParticipantsState((prev) => {
      const next = new Map(prev);
      for (const p of list) next.set(p.id, p);
      return next;
    });
  }, []);

  const setAttachments = React.useCallback((list: Attachment[]) => {
    setAttachmentsState((prev) => {
      const next = new Map(prev);
      for (const a of list) {
        const existing = next.get(a.messageId) ?? [];
        if (!existing.some((x) => x.id === a.id)) {
          next.set(a.messageId, [...existing, a]);
        }
      }
      return next;
    });
  }, []);

  const currentUserId = apiMode
    ? account
      ? `p:${account.email.trim().toLowerCase()}`
      : ""
    : CURRENT_USER_ID;

  const value = React.useMemo<MailUiContextValue>(
    () => ({
      mode: ds.mode,
      writeActionsDisabled: apiMode,
      currentUserId,
      account,
      participants,
      attachmentsByMessage,
      setParticipants,
      setAttachments,
      setAccount,
      getParticipant: (id: string) => {
        if (!apiMode) return mockGetParticipant(id);
        return participants.get(id);
      },
      getBubbleAttachments: (messageId, attachmentIds) => {
        if (!apiMode) {
          // Mock path uses mocks helpers from callers
          return [];
        }
        const cached = attachmentsByMessage.get(messageId);
        if (cached) return cached.filter((a) => !a.inlineInBody);
        return (attachmentIds ?? []).map((id) => ({
          id,
          fileName: "attachment",
          mimeType: "application/octet-stream",
          sizeLabel: "",
          messageId,
          src: `/api/mail/attachments/${id}`,
        }));
      },
    }),
    [
      apiMode,
      account,
      attachmentsByMessage,
      currentUserId,
      ds.mode,
      participants,
      setAttachments,
      setParticipants,
    ],
  );

  return (
    <MailUiContext.Provider value={value}>{children}</MailUiContext.Provider>
  );
}

export function useMailUi() {
  const ctx = React.useContext(MailUiContext);
  if (!ctx) {
    const apiMode = isApiEmailDataSource();
    return {
      mode: getEmailDataSource().mode,
      writeActionsDisabled: apiMode,
      currentUserId: CURRENT_USER_ID,
      account: null as MailAccountSummary | null,
      participants: new Map<string, Participant>(),
      attachmentsByMessage: new Map<string, Attachment[]>(),
      setParticipants: () => {},
      setAttachments: () => {},
      setAccount: () => {},
      getParticipant: (id: string) =>
        apiMode ? undefined : mockGetParticipant(id),
      getBubbleAttachments: () => [] as Attachment[],
    } satisfies MailUiContextValue;
  }
  return ctx;
}
