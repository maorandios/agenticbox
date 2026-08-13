/**
 * O5C.1 — Onyx Document Search (POST /search) against the live OpenAPI contract.
 * document_id is intentionally absent from Search hits — map via internal links + DB.
 */

import "server-only";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { getOnyxConfig, requireOnyxEnabled } from "./config";
import { createOnyxHttpClient } from "./http";
import { onyxLog } from "./log";

/** Live OpenAPI SearchResult (verified against cloud.onyx.app). */
export const onyxLiveSearchResultSchema = z.object({
  citation_id: z.union([z.number(), z.string()]).nullable(),
  title: z.string().nullable().optional(),
  content: z.string(),
  link: z.string().nullable(),
  source_type: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});

export const onyxLiveSearchResponseSchema = z.object({
  results: z.array(onyxLiveSearchResultSchema),
});

/** Normalized Search hit — never invents documentId. */
export type OnyxSearchHit = {
  citationId: number | string | null;
  title: string | null;
  content: string;
  link: string | null;
  sourceType: string | null;
  updatedAt: string | null;
};

export type OnyxSearchResult = {
  hits: OnyxSearchHit[];
  requestId: string | null;
  latencyMs: number;
};

export type SearchDocumentsInput = {
  query: string;
  /** Soft cap after response (API has no num_results). Default 5. */
  maxResults?: number;
  skipQueryExpansion?: boolean;
};

/** @deprecated Use OnyxSearchHit */
export type OnyxLiveSearchHit = OnyxSearchHit;
/** @deprecated Use OnyxSearchResult */
export type OnyxLiveSearchResult = OnyxSearchResult;

function newRequestId(): string {
  return randomUUID();
}

export function createSearchClient(config: {
  baseUrl: string;
  ingestionApiKey: string;
  searchTimeoutMs: number;
  maxRetries: number;
}) {
  return createOnyxHttpClient({
    purpose: "ingestion",
    baseUrl: config.baseUrl,
    apiKey: config.ingestionApiKey,
    timeoutMs: config.searchTimeoutMs,
    maxRetries: Math.min(config.maxRetries, 2),
  });
}

/**
 * Document Search only — never Chat. Uses ingestion (Basic) API key.
 * Sets skip_query_expansion=true so AgenticBox does not request LLM rewriting.
 */
export async function searchDocuments(
  input: SearchDocumentsInput,
): Promise<OnyxSearchResult> {
  const requestId = newRequestId();
  const config = requireOnyxEnabled(requestId);
  const searchTimeoutMs = Number(process.env.ONYX_SEARCH_TIMEOUT_MS ?? 30_000);
  const timeoutMs =
    Number.isFinite(searchTimeoutMs) && searchTimeoutMs > 0
      ? Math.floor(searchTimeoutMs)
      : 30_000;

  const query = input.query.replace(/\s+/g, " ").trim().slice(0, 2048);
  if (!query) {
    return {
      hits: [],
      requestId,
      latencyMs: 0,
    };
  }

  const maxResults = Math.min(Math.max(input.maxResults ?? 5, 1), 20);
  const client = createSearchClient({
    baseUrl: config.baseUrl,
    ingestionApiKey: config.ingestionApiKey,
    searchTimeoutMs: timeoutMs,
    maxRetries: config.maxRetries,
  });

  onyxLog("info", "onyx_search_started", {
    requestId,
    queryLength: query.length,
    maxResults,
  });

  const { data, latencyMs } = await client.request({
    method: "POST",
    path: "/search",
    body: {
      query,
      skip_query_expansion: input.skipQueryExpansion ?? true,
    },
    requestId,
    schema: onyxLiveSearchResponseSchema,
  });

  const hits: OnyxSearchHit[] = (data?.results ?? [])
    .slice(0, maxResults)
    .map((r) => ({
      citationId: r.citation_id,
      title: r.title ?? null,
      content: r.content,
      link: r.link,
      sourceType: r.source_type ?? null,
      updatedAt: r.updated_at ?? null,
    }));

  onyxLog("info", "onyx_search_completed", {
    requestId,
    hitCount: hits.length,
    latencyMs,
  });

  return {
    hits,
    requestId,
    latencyMs,
  };
}

export function peekOnyxSearchConfig() {
  return getOnyxConfig("search-config");
}
