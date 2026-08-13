/**
 * O5C.2/O5C.3/O5C.3.1 — Extract → optional cross-thread retrieval + completion.
 */

import "server-only";
import type { FeedThreadContext } from "./context";
import { buildCrossThreadSearchQuery } from "./cross-thread-query";
import {
  buildContextPack,
  isCrossThreadContextEnabled,
  type ContextPack,
  type ContextSource,
} from "./cross-thread-context";
import { mapSearchHitsToOwnedThreads } from "./map-search-hits";
import {
  emptyContextRequest,
  type ContextRequest,
  type ContextResolution,
  type FeedExtractionResult,
  type SupportedCalculation,
  type SupportingSource,
} from "./schemas";
import { searchDocuments } from "@/server/onyx/search";
import type { FeedOpenAiCallResult } from "./extract";
import {
  completeContextResolutionLive,
  type ContextCompletionLiveResult,
} from "./context-completion";
import {
  detectCrossThreadDependencySignals,
  hasStrongCrossThreadDependencySignals,
  type CrossThreadDependencySignal,
} from "./context-dependency-signals";

export type ContextStatus =
  | "not_needed"
  | "flag_disabled"
  | "insufficient_context"
  | "pack_ready"
  | "stale_only"
  | "failed"
  | "resolved"
  | "conflicting"
  | "candidate_gate_disagreement"
  | "needs_context_review";

export type ExtractWithContextResult = {
  extraction: FeedExtractionResult;
  /** Always Stage 1 items — never dropped on context failure. */
  stage1Items: FeedExtractionResult["items"];
  contextRequest: ContextRequest;
  contextStatus: ContextStatus;
  contextPack: ContextPack | null;
  searchQuery: string | null;
  mappedCount: number;
  totalHits: number;
  staleExcluded: number;
  filteredReasons: Record<string, number>;
  searchCalled: boolean;
  completionCalled: boolean;
  searchLatencyMs: number;
  completion: ContextCompletionLiveResult | null;
  openaiLiveCalls: number;
  onyxLiveCalls: number;
  dbWrites: 0;
  resolution: ContextResolution | null;
  dependencySignals: CrossThreadDependencySignal[];
  gateDisagreement: boolean;
};

export type ContextCompletionFn = (input: {
  extraction: FeedExtractionResult;
  contextPack: ContextPack;
  triggerSources: SupportingSource[];
}) => Promise<ContextResolution>;

/** Default mock: never invents items; returns insufficient. */
export async function mockContextCompletion(): Promise<ContextResolution> {
  return {
    status: "insufficient",
    items: [],
    supportingSources: [],
    calculations: [],
  };
}

function normalizeContextRequest(
  raw: FeedExtractionResult["contextRequest"],
): ContextRequest {
  if (!raw) return emptyContextRequest();
  return {
    ...emptyContextRequest(),
    ...raw,
    triggerEvidence: raw.triggerEvidence ?? null,
    confidence: raw.confidence ?? 0,
  };
}

function shouldSkipContext(extraction: FeedExtractionResult): boolean {
  const cls = extraction.threadClassification;
  if (cls === "marketing" || cls === "system") return true;
  const nature = extraction.communicationNature;
  if (
    nature === "marketing" ||
    nature === "cold_outreach" ||
    nature === "verification_solicitation" ||
    nature === "system_notification"
  ) {
    return true;
  }
  return false;
}

function baseResult(
  extraction: FeedExtractionResult,
  over: Partial<ExtractWithContextResult>,
): ExtractWithContextResult {
  return {
    extraction,
    stage1Items: extraction.items,
    contextRequest: normalizeContextRequest(extraction.contextRequest),
    contextStatus: "not_needed",
    contextPack: null,
    searchQuery: null,
    mappedCount: 0,
    totalHits: 0,
    staleExcluded: 0,
    filteredReasons: {},
    searchCalled: false,
    completionCalled: false,
    searchLatencyMs: 0,
    completion: null,
    openaiLiveCalls: 0,
    onyxLiveCalls: 0,
    dbWrites: 0,
    resolution: null,
    dependencySignals: [],
    gateDisagreement: false,
    ...over,
  };
}

async function runSearchAndMap(opts: {
  userId: string;
  mailAccountId: string;
  threadId: string;
  query: string;
  searchFn: typeof searchDocuments;
  mapFn: typeof mapSearchHitsToOwnedThreads;
  currentOccurredAt?: string | null;
}): Promise<{
  search: Awaited<ReturnType<typeof searchDocuments>>;
  mapped: Awaited<ReturnType<typeof mapSearchHitsToOwnedThreads>>;
  staleExcluded: number;
} | { error: true }> {
  try {
    const search = await opts.searchFn({
      query: opts.query,
      maxResults: 20,
      skipQueryExpansion: true,
    });
    const mapped = await opts.mapFn({
      hits: search.hits,
      userId: opts.userId,
      mailAccountId: opts.mailAccountId,
      currentThreadId: opts.threadId,
      requireIngestionSourceType: true,
      excludeStale: true,
      currentOccurredAt: opts.currentOccurredAt,
    });
    return {
      search,
      mapped,
      staleExcluded: mapped.stats.filtered.stale_context_excluded ?? 0,
    };
  } catch {
    return { error: true };
  }
}

/**
 * Optional cross-thread orchestration after Stage 1 extraction.
 * Stage 1 items are always preserved on Search/Completion failure.
 */
export async function extractWithOptionalCrossThreadContext(opts: {
  userId: string;
  mailAccountId: string;
  threadId: string;
  extraction: FeedExtractionResult;
  extractFn?: (ctx: FeedThreadContext) => Promise<FeedOpenAiCallResult>;
  searchFn?: typeof searchDocuments;
  mapFn?: typeof mapSearchHitsToOwnedThreads;
  /** When omitted and flag on, uses live Context Completion. */
  completionFn?: ContextCompletionFn;
  useLiveCompletion?: boolean;
  currentMessageCleanText?: string;
  subject?: string;
  participants?: Array<{ email?: string | null; name?: string | null }>;
  currentOccurredAt?: string | null;
  /** Prior messages in CURRENT thread only (for deterministic signals). */
  currentThreadHistoryText?: string | null;
}): Promise<ExtractWithContextResult> {
  const extraction = opts.extraction;
  const contextRequest = normalizeContextRequest(extraction.contextRequest);
  const searchFn = opts.searchFn ?? searchDocuments;
  const mapFn = opts.mapFn ?? mapSearchHitsToOwnedThreads;

  const dependencySignals = detectCrossThreadDependencySignals({
    subject: opts.subject,
    currentMessageCleanText: opts.currentMessageCleanText,
    currentThreadHistoryText: opts.currentThreadHistoryText,
    referenceIdsFromModel: contextRequest.referenceIds,
  });
  const strongSignals = hasStrongCrossThreadDependencySignals(dependencySignals);

  if (!isCrossThreadContextEnabled()) {
    return baseResult(extraction, {
      contextRequest,
      contextStatus: "flag_disabled",
      dependencySignals,
    });
  }

  if (shouldSkipContext(extraction)) {
    return baseResult(extraction, {
      contextRequest,
      contextStatus: "not_needed",
      dependencySignals,
    });
  }

  const modelNeeds = contextRequest.needed === true;
  const disagreement = !modelNeeds && strongSignals;

  // Model says not needed and no strong structural signals → skip.
  if (!modelNeeds && !disagreement) {
    return baseResult(extraction, {
      contextRequest,
      contextStatus: "not_needed",
      dependencySignals,
      gateDisagreement: false,
    });
  }

  const query = buildCrossThreadSearchQuery({
    subject: opts.subject,
    currentMessageCleanText: opts.currentMessageCleanText,
    participants: opts.participants,
    referenceIdentifiers: contextRequest.referenceIds,
    currentThreadId: opts.threadId,
  });

  const searched = await runSearchAndMap({
    userId: opts.userId,
    mailAccountId: opts.mailAccountId,
    threadId: opts.threadId,
    query,
    searchFn,
    mapFn,
    currentOccurredAt: opts.currentOccurredAt,
  });

  if ("error" in searched) {
    return baseResult(extraction, {
      contextRequest,
      contextStatus: disagreement ? "candidate_gate_disagreement" : "failed",
      searchQuery: query,
      searchCalled: true,
      onyxLiveCalls: 1,
      dependencySignals,
      gateDisagreement: disagreement,
      resolution: {
        status: "insufficient",
        items: [],
        supportingSources: [],
        calculations: [],
      },
    });
  }

  const { search, mapped, staleExcluded } = searched;

  // Safety-net path: Search only, never Completion.
  if (disagreement) {
    if (mapped.mapped.length === 0) {
      return baseResult(extraction, {
        contextRequest,
        contextStatus: "not_needed",
        searchQuery: query,
        mappedCount: 0,
        totalHits: mapped.stats.totalHits,
        staleExcluded,
        filteredReasons: mapped.stats.filtered,
        searchCalled: true,
        searchLatencyMs: search.latencyMs,
        onyxLiveCalls: 1,
        dependencySignals,
        gateDisagreement: true,
        resolution: {
          status: "insufficient",
          items: [],
          supportingSources: [],
          calculations: [],
        },
      });
    }
    const sources: ContextSource[] = mapped.mapped.map((m) => ({
      threadId: m.threadId,
      documentId: m.onyxDocumentId,
      occurredAt: m.occurredAt,
      participants: [],
      subject: null,
      excerpt: m.content,
      sourceLink: m.sourceLink,
    }));
    const contextPack = buildContextPack(sources);
    return baseResult(extraction, {
      contextRequest,
      contextStatus: "needs_context_review",
      contextPack,
      searchQuery: query,
      mappedCount: mapped.stats.mappedHits,
      totalHits: mapped.stats.totalHits,
      staleExcluded,
      filteredReasons: mapped.stats.filtered,
      searchCalled: true,
      completionCalled: false,
      searchLatencyMs: search.latencyMs,
      onyxLiveCalls: 1,
      dependencySignals,
      gateDisagreement: true,
      resolution: null,
    });
  }

  // Model needed=true → full Search + optional Completion.
  if (mapped.mapped.length === 0) {
    return baseResult(extraction, {
      contextRequest,
      contextStatus:
        staleExcluded > 0 ? "stale_only" : "insufficient_context",
      searchQuery: query,
      mappedCount: mapped.stats.mappedHits,
      totalHits: mapped.stats.totalHits,
      staleExcluded,
      filteredReasons: mapped.stats.filtered,
      searchCalled: true,
      searchLatencyMs: search.latencyMs,
      onyxLiveCalls: 1,
      dependencySignals,
      resolution: {
        status: "insufficient",
        items: [],
        supportingSources: [],
        calculations: [],
      },
    });
  }

  const sources: ContextSource[] = mapped.mapped.map((m) => ({
    threadId: m.threadId,
    documentId: m.onyxDocumentId,
    occurredAt: m.occurredAt,
    participants: [],
    subject: null,
    excerpt: m.content,
    sourceLink: m.sourceLink,
  }));
  const contextPack = buildContextPack(sources);

  const triggerSources: SupportingSource[] = [
    {
      threadId: opts.threadId,
      messageId: extraction.items[0]?.sourceMessageId ?? null,
      occurredAt:
        opts.currentOccurredAt ?? extraction.items[0]?.occurredAt ?? null,
      evidence:
        extraction.items[0]?.evidenceText ??
        opts.currentMessageCleanText ??
        "",
      role: "trigger",
    },
  ];

  const useLive = opts.useLiveCompletion === true && !opts.completionFn;

  if (useLive) {
    const completion = await completeContextResolutionLive({
      extraction,
      contextPack,
      triggerSources,
      currentSubject: opts.subject,
      currentMessageCleanText: opts.currentMessageCleanText,
    });
    if (!completion.ok || !completion.resolution) {
      return baseResult(extraction, {
        contextRequest,
        contextStatus: "failed",
        contextPack,
        searchQuery: query,
        mappedCount: mapped.stats.mappedHits,
        totalHits: mapped.stats.totalHits,
        staleExcluded,
        filteredReasons: mapped.stats.filtered,
        searchCalled: true,
        completionCalled: true,
        searchLatencyMs: search.latencyMs,
        completion,
        openaiLiveCalls: 1,
        onyxLiveCalls: 1,
        dependencySignals,
        resolution: {
          status: "insufficient",
          items: [],
          supportingSources: [],
          calculations: [],
        },
      });
    }
    const status: ContextStatus =
      completion.resolution.status === "resolved"
        ? "resolved"
        : completion.resolution.status === "conflicting"
          ? "conflicting"
          : "insufficient_context";
    return baseResult(extraction, {
      contextRequest,
      contextStatus: status,
      contextPack,
      searchQuery: query,
      mappedCount: mapped.stats.mappedHits,
      totalHits: mapped.stats.totalHits,
      staleExcluded,
      filteredReasons: mapped.stats.filtered,
      searchCalled: true,
      completionCalled: true,
      searchLatencyMs: search.latencyMs,
      completion,
      openaiLiveCalls: 1,
      onyxLiveCalls: 1,
      dependencySignals,
      resolution: completion.resolution,
    });
  }

  const completionFn = opts.completionFn ?? mockContextCompletion;
  let resolution: ContextResolution;
  try {
    resolution = await completionFn({
      extraction,
      contextPack,
      triggerSources,
    });
  } catch {
    return baseResult(extraction, {
      contextRequest,
      contextStatus: "failed",
      contextPack,
      searchQuery: query,
      mappedCount: mapped.stats.mappedHits,
      totalHits: mapped.stats.totalHits,
      staleExcluded,
      filteredReasons: mapped.stats.filtered,
      searchCalled: true,
      completionCalled: true,
      searchLatencyMs: search.latencyMs,
      onyxLiveCalls: 1,
      dependencySignals,
      resolution: {
        status: "insufficient",
        items: [],
        supportingSources: [],
        calculations: [],
      },
    });
  }

  return baseResult(extraction, {
    contextRequest,
    contextStatus: "pack_ready",
    contextPack,
    searchQuery: query,
    mappedCount: mapped.stats.mappedHits,
    totalHits: mapped.stats.totalHits,
    staleExcluded,
    filteredReasons: mapped.stats.filtered,
    searchCalled: true,
    completionCalled: true,
    searchLatencyMs: search.latencyMs,
    onyxLiveCalls: 1,
    dependencySignals,
    resolution,
  });
}

export {
  assertAttributionBoundaries,
  historicalCannotCreateActionWithoutCurrentSpeechAct,
} from "./extract-with-context-guards";

export type { SupportedCalculation };
