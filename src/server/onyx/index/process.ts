import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  deleteDocument as onyxDeleteDocument,
  upsertDocument as onyxUpsertDocument,
  OnyxError,
} from "@/server/onyx/adapter";
import { onyxLog } from "@/server/onyx/log";
import { buildNormalizedThreadDocument } from "./load-thread";
import { getIndexMaxAttempts, type OnyxDeleteThreadJob, type OnyxIndexThreadJob } from "./types";

function safeErrorFields(error: unknown): { code: string; message: string } {
  if (error instanceof OnyxError) {
    return {
      code: error.code,
      message: error.message.slice(0, 240),
    };
  }
  if (error instanceof Error) {
    return {
      code: "index_error",
      message: error.message.replace(/[^\w.:\-]+/g, "_").slice(0, 240),
    };
  }
  return { code: "index_error", message: "unknown" };
}

export async function processIndexJob(
  job: OnyxIndexThreadJob,
): Promise<"indexed" | "skipped" | "failed" | "retry"> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const maxAttempts = getIndexMaxAttempts();

  onyxLog("info", "onyx_index_started", {
    userId: job.userId,
    mailAccountId: job.mailAccountId,
    threadId: job.threadId,
  });

  const { data: state } = await admin
    .from("onyx_index_state")
    .select("id,content_hash,status,attempt_count,onyx_document_id")
    .eq("user_id", job.userId)
    .eq("thread_id", job.threadId)
    .maybeSingle();

  await admin
    .from("onyx_index_state")
    .update({
      status: "processing",
      last_attempt_at: now,
      updated_at: now,
    })
    .eq("user_id", job.userId)
    .eq("thread_id", job.threadId);

  try {
    const normalized = await buildNormalizedThreadDocument({
      userId: job.userId,
      mailAccountId: job.mailAccountId,
      threadId: job.threadId,
    });

    if (!normalized) {
      throw new Error("thread_not_found");
    }

    if (
      state?.content_hash &&
      state.content_hash === normalized.contentHash &&
      state.onyx_document_id
    ) {
      await admin
        .from("onyx_index_state")
        .update({
          status: "indexed",
          onyx_document_id: normalized.id,
          updated_at: new Date().toISOString(),
          last_error_code: null,
          last_error_message: null,
        })
        .eq("user_id", job.userId)
        .eq("thread_id", job.threadId);

      onyxLog("info", "onyx_thread_skipped_unchanged", {
        userId: job.userId,
        threadId: job.threadId,
        sectionCount: normalized.quality.sectionCount,
        plainFallback: normalized.quality.plainTextFallbackCount,
        cleanCount: normalized.quality.cleanConversationCount,
      });
      return "skipped";
    }

    const upsert = await onyxUpsertDocument({
      id: normalized.id,
      semanticIdentifier: normalized.semanticIdentifier,
      title: normalized.title,
      sections: normalized.sections,
      metadata: normalized.metadata,
    });

    await admin
      .from("onyx_index_state")
      .update({
        status: "indexed",
        // Always persist the canonical AgenticBox document id (not a URL-encoded echo).
        onyx_document_id: normalized.id,
        content_hash: normalized.contentHash,
        indexed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        attempt_count: 0,
        last_error_code: null,
        last_error_message: null,
      })
      .eq("user_id", job.userId)
      .eq("thread_id", job.threadId);

    onyxLog("info", "onyx_thread_indexed", {
      userId: job.userId,
      threadId: job.threadId,
      documentId: normalized.id,
      sectionCount: normalized.quality.sectionCount,
      plainFallback: normalized.quality.plainTextFallbackCount,
      cleanCount: normalized.quality.cleanConversationCount,
      alreadyExisted: upsert.alreadyExisted,
    });

    return "indexed";
  } catch (error) {
    const fields = safeErrorFields(error);
    const attemptCount = Number(state?.attempt_count ?? 0) + 1;
    const isMissing =
      error instanceof Error && error.message.startsWith("thread_not_found");
    const retryable = isMissing
      ? false
      : error instanceof OnyxError
        ? error.retryable
        : true;

    const terminal = !retryable || attemptCount >= maxAttempts;

    await admin
      .from("onyx_index_state")
      .update({
        status: terminal ? "failed" : "pending",
        attempt_count: attemptCount,
        last_error_code: fields.code,
        last_error_message: fields.message,
        last_attempt_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", job.userId)
      .eq("thread_id", job.threadId);

    onyxLog(terminal ? "error" : "warn", terminal ? "onyx_index_failed" : "onyx_index_retry", {
      userId: job.userId,
      threadId: job.threadId,
      attemptCount,
      code: fields.code,
    });

    return terminal ? "failed" : "retry";
  }
}

export async function processDeleteJob(
  job: OnyxDeleteThreadJob,
): Promise<"deleted" | "failed" | "retry"> {
  const admin = createAdminClient();
  const maxAttempts = getIndexMaxAttempts();

  const { data: state } = await admin
    .from("onyx_index_state")
    .select("attempt_count")
    .eq("user_id", job.userId)
    .eq("thread_id", job.threadId)
    .maybeSingle();

  try {
    await onyxDeleteDocument(job.onyxDocumentId);
    await admin
      .from("onyx_index_state")
      .update({
        status: "deleted",
        updated_at: new Date().toISOString(),
        last_error_code: null,
        last_error_message: null,
      })
      .eq("user_id", job.userId)
      .eq("thread_id", job.threadId);

    onyxLog("info", "onyx_document_deleted", {
      userId: job.userId,
      threadId: job.threadId,
      documentId: job.onyxDocumentId,
    });
    return "deleted";
  } catch (error) {
    const fields = safeErrorFields(error);
    const attemptCount = Number(state?.attempt_count ?? 0) + 1;
    const retryable = error instanceof OnyxError ? error.retryable : true;
    const terminal = !retryable || attemptCount >= maxAttempts;

    await admin
      .from("onyx_index_state")
      .update({
        status: terminal ? "failed" : "deleting",
        attempt_count: attemptCount,
        last_error_code: fields.code,
        last_error_message: fields.message,
        last_attempt_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", job.userId)
      .eq("thread_id", job.threadId);

    onyxLog(terminal ? "error" : "warn", terminal ? "onyx_index_failed" : "onyx_index_retry", {
      userId: job.userId,
      threadId: job.threadId,
      attemptCount,
      code: fields.code,
      op: "delete",
    });

    return terminal ? "failed" : "retry";
  }
}
