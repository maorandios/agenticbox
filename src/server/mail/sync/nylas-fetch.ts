import "server-only";
import { getNylasClient } from "@/server/nylas/client";
import { syncLog } from "./log";
import { withNylasRetry } from "./rate-limit";
import type { NylasMessage, NylasThread } from "./nylas-types";

export type ThreadsPage = {
  threads: NylasThread[];
  nextCursor: string | null;
};

export async function listThreadsPage(params: {
  grantId: string;
  latestMessageAfter: number;
  limit: number;
  pageToken?: string | null;
  onRateLimitRetry?: (attempt: number, waitMs: number) => void;
}): Promise<ThreadsPage> {
  const nylas = getNylasClient();
  const response = await withNylasRetry(
    () =>
      nylas.threads.list({
        identifier: params.grantId,
        queryParams: {
          limit: params.limit,
          latestMessageAfter: params.latestMessageAfter,
          ...(params.pageToken ? { pageToken: params.pageToken } : {}),
        },
      }),
    { onRetry: params.onRateLimitRetry },
  );

  return {
    threads: (response.data ?? []) as NylasThread[],
    nextCursor: response.nextCursor ?? null,
  };
}

export async function listMessagesForThread(params: {
  grantId: string;
  threadId: string;
  onRateLimitRetry?: (attempt: number, waitMs: number) => void;
}): Promise<NylasMessage[]> {
  const nylas = getNylasClient();
  const all: NylasMessage[] = [];
  let pageToken: string | undefined;

  do {
    const response = await withNylasRetry(
      () =>
        nylas.messages.list({
          identifier: params.grantId,
          queryParams: {
            threadId: params.threadId,
            limit: 50,
            ...(pageToken ? { pageToken } : {}),
          },
        }),
      { onRetry: params.onRateLimitRetry },
    );
    all.push(...((response.data ?? []) as NylasMessage[]));
    pageToken = response.nextCursor ?? undefined;
  } while (pageToken);

  syncLog("info", "nylas_messages_listed", {
    messageCount: all.length,
  });

  return all;
}
