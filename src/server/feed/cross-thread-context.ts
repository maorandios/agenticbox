/**
 * O5C.1 / O5C.1.1 — Cross-thread context retrieval via Search + safe link mapping.
 */

import "server-only";
import {
  buildCrossThreadSearchQuery,
  type CrossThreadSearchQueryInput,
} from "./cross-thread-query";
import {
  mapSearchHitsToOwnedThreads,
  type MappedContextHit,
} from "./map-search-hits";
import { searchDocuments } from "@/server/onyx/search";

export type ContextSource = {
  threadId: string;
  documentId: string;
  occurredAt: string | null;
  participants: string[];
  subject: string | null;
  excerpt: string;
  sourceLink: string;
};

export type ContextPack = {
  sources: ContextSource[];
  estimatedChars: number;
  estimatedTokensApprox: number;
  charBudget: number;
};

export type RetrieveCrossThreadContextInput = CrossThreadSearchQueryInput & {
  userId: string;
  mailAccountId: string;
  currentThreadId: string;
};

export type RetrieveCrossThreadContextResult = {
  query: string;
  onyxCalled: boolean;
  latencyMs: number;
  hitCount: number;
  validInternalLinks: number;
  ownershipVerified: number;
  mappedCount: number;
  filteredCount: number;
  filteredReasons: Record<string, number>;
  mapped: MappedContextHit[];
  sources: ContextSource[];
  blocker: string | null;
  openaiCalls: 0;
  onyxChatCalls: 0;
  dbWrites: 0;
};

const CONTEXT_CHAR_BUDGET = 48_000;
const MAX_SOURCES = 5;

export function isCrossThreadContextEnabled(): boolean {
  const raw = process.env.FEED_CROSS_THREAD_CONTEXT_ENABLED?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function buildContextPack(sources: ContextSource[]): ContextPack {
  const sorted = [...sources].sort((a, b) => {
    const ta = a.occurredAt ? Date.parse(a.occurredAt) : 0;
    const tb = b.occurredAt ? Date.parse(b.occurredAt) : 0;
    return ta - tb;
  });

  const out: ContextSource[] = [];
  let used = 0;
  for (const src of sorted.slice(0, MAX_SOURCES)) {
    const excerpt = src.excerpt.slice(0, 2_400);
    const next = used + excerpt.length + (src.subject?.length ?? 0) + 64;
    if (next > CONTEXT_CHAR_BUDGET && out.length > 0) break;
    out.push({ ...src, excerpt });
    used = next;
  }

  return {
    sources: out,
    estimatedChars: used,
    estimatedTokensApprox: Math.ceil(used / 4),
    charBudget: CONTEXT_CHAR_BUDGET,
  };
}

function toContextSources(mapped: MappedContextHit[]): ContextSource[] {
  return mapped.map((m) => ({
    threadId: m.threadId,
    documentId: m.onyxDocumentId,
    occurredAt: m.occurredAt,
    participants: [],
    subject: null,
    excerpt: m.content,
    sourceLink: m.sourceLink,
  }));
}

export async function retrieveCrossThreadContext(
  input: RetrieveCrossThreadContextInput,
): Promise<RetrieveCrossThreadContextResult> {
  const query = buildCrossThreadSearchQuery(input);

  if (!isCrossThreadContextEnabled()) {
    return {
      query,
      onyxCalled: false,
      latencyMs: 0,
      hitCount: 0,
      validInternalLinks: 0,
      ownershipVerified: 0,
      mappedCount: 0,
      filteredCount: 0,
      filteredReasons: {},
      mapped: [],
      sources: [],
      blocker: null,
      openaiCalls: 0,
      onyxChatCalls: 0,
      dbWrites: 0,
    };
  }

  // Fetch a wider raw window so ownership filters can still fill 5 threads.
  const search = await searchDocuments({
    query,
    maxResults: 20,
    skipQueryExpansion: true,
  });

  const mappedRes = await mapSearchHitsToOwnedThreads({
    hits: search.hits,
    userId: input.userId,
    mailAccountId: input.mailAccountId,
    currentThreadId: input.currentThreadId,
    requireIngestionSourceType: true,
  });

  const sources = toContextSources(mappedRes.mapped);
  const filteredCount = Object.values(mappedRes.stats.filtered).reduce(
    (a, b) => a + b,
    0,
  );

  let blocker: string | null = null;
  if (
    search.hits.length > 0 &&
    mappedRes.stats.validInternalLinks === 0
  ) {
    blocker =
      "no_valid_internal_source_links; existing Onyx docs not safely mappable without re-index";
  }

  return {
    query,
    onyxCalled: true,
    latencyMs: search.latencyMs,
    hitCount: mappedRes.stats.totalHits,
    validInternalLinks: mappedRes.stats.validInternalLinks,
    ownershipVerified: mappedRes.stats.ownershipVerified,
    mappedCount: mappedRes.stats.mappedHits,
    filteredCount,
    filteredReasons: mappedRes.stats.filtered,
    mapped: mappedRes.mapped,
    sources: buildContextPack(sources).sources,
    blocker,
    openaiCalls: 0,
    onyxChatCalls: 0,
    dbWrites: 0,
  };
}
