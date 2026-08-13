/**
 * O5C.1.1 — Map Onyx Search hits via internal source links + Supabase ownership.
 * onyxDocumentId always from onyx_index_state — never invented from Search.
 */

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseInternalThreadSourceLink } from "./internal-source-link";
import type { OnyxSearchHit } from "@/server/onyx/search";

export type MappedContextHit = {
  threadId: string;
  onyxDocumentId: string;
  citationId: number | string | null;
  content: string;
  sourceLink: string;
  occurredAt: string | null;
};

export type MapSearchHitsResult = {
  mapped: MappedContextHit[];
  stats: {
    totalHits: number;
    validInternalLinks: number;
    ownershipVerified: number;
    mappedHits: number;
    filtered: Record<string, number>;
  };
};

const MAX_THREADS = 5;
const MAX_EXCERPTS_PER_THREAD = 2;
/** Auto Context Pack: indexed only. stale is reported and excluded. */
const AUTO_PACK_STATUSES = new Set(["indexed"]);
const KNOWN_INDEX_STATUSES = new Set([
  "indexed",
  "stale",
  "pending",
  "processing",
  "failed",
  "deleting",
  "deleted",
]);

function bump(filtered: Record<string, number>, reason: string) {
  filtered[reason] = (filtered[reason] ?? 0) + 1;
}

export async function mapSearchHitsToOwnedThreads(opts: {
  hits: OnyxSearchHit[];
  userId: string;
  mailAccountId: string;
  currentThreadId: string;
  /** Optional hardening; never sole ownership signal. */
  requireIngestionSourceType?: boolean;
  /** When set, historical sources must be strictly earlier. */
  currentOccurredAt?: string | null;
  /** Default true for O5C.2 auto pack. */
  excludeStale?: boolean;
}): Promise<MapSearchHitsResult> {
  const excludeStale = opts.excludeStale !== false;
  const currentTs = opts.currentOccurredAt
    ? Date.parse(opts.currentOccurredAt)
    : NaN;
  const filtered: Record<string, number> = {};
  const candidates: Array<{
    threadId: string;
    hit: OnyxSearchHit;
    sourceLink: string;
  }> = [];

  for (const hit of opts.hits) {
    if (
      opts.requireIngestionSourceType &&
      hit.sourceType &&
      hit.sourceType !== "ingestion_api"
    ) {
      bump(filtered, "source_type_mismatch");
      continue;
    }
    const threadId = parseInternalThreadSourceLink(hit.link);
    if (!threadId) {
      bump(filtered, "invalid_or_missing_internal_link");
      continue;
    }
    if (threadId === opts.currentThreadId.toLowerCase()) {
      bump(filtered, "current_thread");
      continue;
    }
    candidates.push({
      threadId,
      hit,
      sourceLink: hit.link!.trim(),
    });
  }

  const validInternalLinks = candidates.length;
  if (candidates.length === 0) {
    return {
      mapped: [],
      stats: {
        totalHits: opts.hits.length,
        validInternalLinks: 0,
        ownershipVerified: 0,
        mappedHits: 0,
        filtered,
      },
    };
  }

  const admin = createAdminClient();
  const threadIds = [...new Set(candidates.map((c) => c.threadId))];

  const { data: account } = await admin
    .from("mail_accounts")
    .select("id,user_id,sync_status")
    .eq("id", opts.mailAccountId)
    .eq("user_id", opts.userId)
    .maybeSingle();

  if (!account?.id) {
    bump(filtered, "mail_account_not_owned");
    filtered.mail_account_not_owned = candidates.length;
    return {
      mapped: [],
      stats: {
        totalHits: opts.hits.length,
        validInternalLinks,
        ownershipVerified: 0,
        mappedHits: 0,
        filtered,
      },
    };
  }
  if (account.sync_status === "disconnected") {
    filtered.mail_account_inactive = candidates.length;
    return {
      mapped: [],
      stats: {
        totalHits: opts.hits.length,
        validInternalLinks,
        ownershipVerified: 0,
        mappedHits: 0,
        filtered,
      },
    };
  }

  const { data: threads } = await admin
    .from("threads")
    .select("id,user_id,mail_account_id")
    .eq("user_id", opts.userId)
    .eq("mail_account_id", opts.mailAccountId)
    .in("id", threadIds);

  const ownedThreadIds = new Set(
    (threads ?? []).map((t) => String(t.id).toLowerCase()),
  );

  const { data: indexRows } = await admin
    .from("onyx_index_state")
    .select("thread_id,onyx_document_id,status,user_id,mail_account_id")
    .eq("user_id", opts.userId)
    .eq("mail_account_id", opts.mailAccountId)
    .in("thread_id", threadIds);

  const indexByThread = new Map(
    (indexRows ?? []).map((r) => [String(r.thread_id).toLowerCase(), r]),
  );

  /** Email timeline from DB — never use Onyx hit.updatedAt (reindex time). */
  const occurredByThread = new Map<string, string | null>();
  if (Number.isFinite(currentTs) || ownedThreadIds.size > 0) {
    const { data: msgDates } = await admin
      .from("messages")
      .select("thread_id,provider_date_at")
      .eq("user_id", opts.userId)
      .in("thread_id", threadIds)
      .order("provider_date_at", { ascending: false });
    for (const row of msgDates ?? []) {
      const tid = String(row.thread_id).toLowerCase();
      if (occurredByThread.has(tid)) continue;
      occurredByThread.set(
        tid,
        (row.provider_date_at as string | null) ?? null,
      );
    }
  }

  const byThread = new Map<string, MappedContextHit>();
  let ownershipVerified = 0;

  for (const c of candidates) {
    if (!ownedThreadIds.has(c.threadId)) {
      // Distinguish other-user vs other-account would need broader queries;
      // both fail the exact ownership join → blocked.
      bump(filtered, "thread_ownership_denied");
      continue;
    }
    const idx = indexByThread.get(c.threadId);
    if (!idx) {
      bump(filtered, "missing_onyx_index_state");
      continue;
    }
    if (
      String(idx.user_id) !== opts.userId ||
      String(idx.mail_account_id) !== opts.mailAccountId
    ) {
      bump(filtered, "index_state_ownership_mismatch");
      continue;
    }
    if (!KNOWN_INDEX_STATUSES.has(String(idx.status))) {
      bump(filtered, "index_status_not_ready");
      continue;
    }
    if (String(idx.status) === "stale") {
      bump(filtered, "stale_context_excluded");
      if (excludeStale) continue;
    } else if (!AUTO_PACK_STATUSES.has(String(idx.status))) {
      bump(filtered, "index_status_not_ready");
      continue;
    }
    const occurredAt = occurredByThread.get(c.threadId) ?? null;
    if (
      Number.isFinite(currentTs) &&
      occurredAt &&
      Number.isFinite(Date.parse(occurredAt)) &&
      Date.parse(occurredAt) >= currentTs
    ) {
      bump(filtered, "not_earlier_than_trigger");
      continue;
    }
    const onyxDocumentId = String(idx.onyx_document_id ?? "").trim();
    if (!onyxDocumentId) {
      bump(filtered, "missing_onyx_document_id");
      continue;
    }

    ownershipVerified += 1;
    const existing = byThread.get(c.threadId);
    const excerpt = c.hit.content.slice(0, 2_400);
    if (!existing) {
      if (byThread.size >= MAX_THREADS) {
        bump(filtered, "thread_limit");
        continue;
      }
      byThread.set(c.threadId, {
        threadId: c.threadId,
        onyxDocumentId,
        citationId: c.hit.citationId,
        content: excerpt,
        sourceLink: `/source/thread/${c.threadId}`,
        occurredAt,
      });
    } else {
      // Up to 2 excerpts per thread — append lightly if room.
      const parts = existing.content.split("\n---\n");
      if (parts.length < MAX_EXCERPTS_PER_THREAD) {
        existing.content = `${existing.content}\n---\n${excerpt}`.slice(
          0,
          4_800,
        );
      } else {
        bump(filtered, "excerpt_cap");
      }
    }
  }

  const mapped = [...byThread.values()];
  return {
    mapped,
    stats: {
      totalHits: opts.hits.length,
      validInternalLinks,
      ownershipVerified,
      mappedHits: mapped.length,
      filtered,
    },
  };
}
