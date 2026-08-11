import "server-only";
import type { OnyxConfig } from "./config";
import { OnyxError } from "./errors";
import type { OnyxHttpClient } from "./http";
import { createOnyxHttpClient } from "./http";
import { onyxLog } from "./log";
import {
  onyxIngestionResultSchema,
  onyxUpsertDocumentInputSchema,
  type OnyxUpsertDocumentInput,
} from "./schemas";
import type { OnyxDeleteResult, OnyxUpsertResult } from "./types";

export function createIngestionClient(config: OnyxConfig): OnyxHttpClient {
  return createOnyxHttpClient({
    purpose: "ingestion",
    baseUrl: config.baseUrl,
    apiKey: config.ingestionApiKey,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
  });
}

export async function upsertDocument(opts: {
  config: OnyxConfig;
  client: OnyxHttpClient;
  input: OnyxUpsertDocumentInput;
  requestId: string;
}): Promise<OnyxUpsertResult> {
  const input = onyxUpsertDocumentInputSchema.parse(opts.input);
  const payload = {
    document: {
      id: input.id,
      semantic_identifier: input.semanticIdentifier,
      title: input.title ?? input.semanticIdentifier,
      sections: input.sections.map((section) => ({
        text: section.text,
        ...(section.link ? { link: section.link } : {}),
      })),
      source: "ingestion_api" as const,
      metadata: input.metadata ?? {},
    },
    cc_pair_id: opts.config.ccPairId,
  };

  onyxLog("info", "onyx_upsert_started", {
    requestId: opts.requestId,
    documentId: input.id,
    sectionCount: input.sections.length,
    ccPairId: opts.config.ccPairId,
  });

  const { data, latencyMs } = await opts.client.request({
    method: "POST",
    path: "/onyx-api/ingestion",
    body: payload,
    requestId: opts.requestId,
    schema: onyxIngestionResultSchema,
  });

  if (!data) {
    throw new OnyxError({
      code: "malformed",
      message: "onyx_upsert_empty_response",
      retryable: false,
      requestId: opts.requestId,
    });
  }

  onyxLog("info", "onyx_upsert_completed", {
    requestId: opts.requestId,
    documentId: data.document_id,
    alreadyExisted: data.already_existed,
    latencyMs,
  });

  return {
    documentId: data.document_id,
    alreadyExisted: data.already_existed,
    requestId: opts.requestId,
    latencyMs,
  };
}

export async function deleteDocument(opts: {
  client: OnyxHttpClient;
  documentId: string;
  requestId: string;
}): Promise<OnyxDeleteResult> {
  const documentId = opts.documentId.trim();
  onyxLog("info", "onyx_delete_started", {
    requestId: opts.requestId,
    documentId,
  });

  const { status, latencyMs } = await opts.client.request({
    method: "DELETE",
    path: `/onyx-api/ingestion/${encodeURIComponent(documentId)}`,
    requestId: opts.requestId,
    acceptNotFound: true,
  });

  const alreadyAbsent = status === 404;
  const deleted = status === 200 || status === 204 || alreadyAbsent;

  onyxLog("info", "onyx_delete_completed", {
    requestId: opts.requestId,
    documentId,
    status,
    alreadyAbsent,
    latencyMs,
  });

  return {
    documentId,
    deleted,
    alreadyAbsent,
    requestId: opts.requestId,
    latencyMs,
  };
}
