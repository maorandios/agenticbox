/** Minimal Nylas shapes used by backfill (avoid brittle deep import paths). */

export type NylasEmailName = {
  email?: string;
  name?: string;
};

export type NylasAttachment = {
  id: string;
  filename?: string;
  contentType?: string;
  size?: number;
  isInline?: boolean;
  contentId?: string;
  contentDisposition?: string;
};

export type NylasMessage = {
  id: string;
  grantId?: string;
  date?: number;
  folders?: string[];
  to?: NylasEmailName[];
  from?: NylasEmailName[];
  cc?: NylasEmailName[];
  bcc?: NylasEmailName[];
  replyTo?: NylasEmailName[];
  subject?: string;
  body?: string;
  starred?: boolean;
  unread?: boolean;
  snippet?: string;
  threadId?: string;
  attachments?: NylasAttachment[];
};

export type NylasThread = {
  id: string;
  grantId?: string;
  subject?: string;
  snippet?: string;
  unread?: boolean;
  starred?: boolean;
  folders?: string[];
  participants?: NylasEmailName[];
  messageIds?: string[];
  earliestMessageDate?: number;
  latestMessageReceivedDate?: number;
  latestMessageSentDate?: number;
};
