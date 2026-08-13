/**
 * Deterministic blind thread selection — hash seed, not recency/content cherry-pick.
 */
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanFeedMessageBody } from "../clean-content";
import { FEED_PREFILTER_SCAN_CAP } from "../config";
import {
  classifyFeedThreadEligibility,
  type EligibilityMessageInput,
  type FeedThreadEligibility,
} from "../eligibility";
import {
  O5A4_EXCLUDED_THREAD_IDS,
  O5A4_HARD_CAP,
  O5A4_SELECTION_SEED,
} from "./constants";
import { maskUuid, selectionHash, shortHash } from "./engine-hash";

export type BlindPrefilterCounts = Record<FeedThreadEligibility, number>;

export type BlindSelectedThread = {
  threadId: string;
  threadIdMasked: string;
  selectionHash: string;
  selectionHashShort: string;
  prefilterClassification: FeedThreadEligibility;
};

export type BlindSelectionResult = {
  selectionSeed: string;
  scanned: number;
  previouslySeenRemoved: number;
  goldenExcluded: number;
  prefilterCounts: BlindPrefilterCounts;
  eligibleUnseen: number;
  selected: BlindSelectedThread[];
  sampleSmallerThanCap: boolean;
};

function emptyCounts(): BlindPrefilterCounts {
  return {
    business_conversation: 0,
    important_transactional: 0,
    bulk_marketing: 0,
    system_notification: 0,
    insufficient_content: 0,
    unknown: 0,
  };
}

async function loadEligibilityMessages(opts: {
  userId: string;
  threadId: string;
}): Promise<EligibilityMessageInput[]> {
  const admin = createAdminClient();
  const { data: messageRows, error } = await admin
    .from("messages")
    .select("id,subject,plain_text,clean_conversation,direction")
    .eq("user_id", opts.userId)
    .eq("thread_id", opts.threadId)
    .order("provider_date_at", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true });
  if (error) throw new Error(`o5a4_messages_failed:${error.message}`);

  const rows = messageRows ?? [];
  const messageIds = rows.map((r) => r.id as string);
  const participantsByMessage = new Map<
    string,
    Array<{ role: string; email: string; name: string | null }>
  >();

  if (messageIds.length > 0) {
    const { data: parts, error: partsError } = await admin
      .from("message_participants")
      .select("message_id,role,email,name")
      .eq("user_id", opts.userId)
      .in("message_id", messageIds);
    if (partsError) {
      throw new Error(`o5a4_parts_failed:${partsError.message}`);
    }
    for (const p of parts ?? []) {
      const mid = p.message_id as string;
      const list = participantsByMessage.get(mid) ?? [];
      list.push({
        role: String(p.role),
        email: String(p.email ?? ""),
        name: (p.name as string | null) ?? null,
      });
      participantsByMessage.set(mid, list);
    }
  }

  return rows.map((row) => {
    const parts = participantsByMessage.get(row.id as string) ?? [];
    const from = parts.find((p) => p.role === "from");
    const raw =
      String(row.clean_conversation ?? "").trim() ||
      String(row.plain_text ?? "").trim();
    return {
      subject: (row.subject as string | null) ?? null,
      fromEmail: from?.email || null,
      fromName: from?.name ?? null,
      toEmails: parts
        .filter((p) => p.role === "to" || p.role === "cc")
        .map((p) => p.email)
        .filter(Boolean),
      direction: (row.direction === "outbound" ? "outbound" : "inbound") as
        | "inbound"
        | "outbound",
      body: cleanFeedMessageBody(raw).cleanText,
    };
  });
}

/**
 * Pure selection from already-classified eligible unseen threads.
 * Used by live path and unit tests (determinism / hard cap / no replace).
 */
export function selectBlindThreadsDeterministic(opts: {
  seed: string;
  eligible: Array<{
    threadId: string;
    classification: FeedThreadEligibility;
  }>;
  hardCap?: number;
}): BlindSelectedThread[] {
  const cap = opts.hardCap ?? O5A4_HARD_CAP;
  const ranked = opts.eligible
    .map((t) => {
      const hash = selectionHash(opts.seed, t.threadId);
      return {
        threadId: t.threadId,
        threadIdMasked: maskUuid(t.threadId),
        selectionHash: hash,
        selectionHashShort: shortHash(hash),
        prefilterClassification: t.classification,
      };
    })
    .sort((a, b) => {
      if (a.selectionHash < b.selectionHash) return -1;
      if (a.selectionHash > b.selectionHash) return 1;
      return a.threadId.localeCompare(b.threadId);
    });
  return ranked.slice(0, cap);
}

/**
 * After selection is locked, failures must not swap in alternates.
 */
export function resolveBlindBatchThreads(opts: {
  lockedThreadIds: string[];
  failedThreadIds: string[];
  alternatePool: string[];
}): string[] {
  void opts.failedThreadIds;
  void opts.alternatePool;
  return [...opts.lockedThreadIds];
}

export async function buildBlindSelection(opts: {
  userId: string;
  mailAccountId: string;
  seed?: string;
  hardCap?: number;
}): Promise<BlindSelectionResult> {
  const admin = createAdminClient();
  const seed = opts.seed ?? O5A4_SELECTION_SEED;
  const hardCap = opts.hardCap ?? O5A4_HARD_CAP;
  const prefilterCounts = emptyCounts();
  const excluded = new Set<string>(O5A4_EXCLUDED_THREAD_IDS);

  const { data: account } = await admin
    .from("mail_accounts")
    .select("id,sync_status,email")
    .eq("user_id", opts.userId)
    .eq("id", opts.mailAccountId)
    .maybeSingle();
  if (!account || account.sync_status === "disconnected") {
    throw new Error("o5a4_account_unavailable");
  }
  const accountEmail = String(account.email ?? "")
    .trim()
    .toLowerCase();

  const { data: threads, error } = await admin
    .from("threads")
    .select("id,subject")
    .eq("user_id", opts.userId)
    .eq("mail_account_id", opts.mailAccountId)
    .order("latest_message_at", { ascending: false, nullsFirst: false })
    .limit(FEED_PREFILTER_SCAN_CAP);
  if (error) throw new Error(`o5a4_threads_failed:${error.message}`);

  const scannedThreads = threads ?? [];
  const scannedIds = scannedThreads.map((t) => t.id as string);

  const { data: seenRows, error: seenErr } = await admin
    .from("feed_extraction_runs")
    .select("thread_id")
    .eq("user_id", opts.userId)
    .eq("mail_account_id", opts.mailAccountId)
    .not("thread_id", "is", null);
  if (seenErr) throw new Error(`o5a4_seen_failed:${seenErr.message}`);

  const seen = new Set(
    (seenRows ?? [])
      .map((r) => r.thread_id as string | null)
      .filter((id): id is string => Boolean(id)),
  );

  let previouslySeenRemoved = 0;
  let goldenExcluded = 0;
  const unseen: Array<{ id: string; subject: string | null }> = [];

  for (const t of scannedThreads) {
    const id = t.id as string;
    if (excluded.has(id)) {
      goldenExcluded += 1;
      continue;
    }
    if (seen.has(id)) {
      previouslySeenRemoved += 1;
      continue;
    }
    unseen.push({
      id,
      subject: (t.subject as string | null) ?? null,
    });
  }

  // Count golden/seen that were in the scan window for reporting accuracy.
  for (const id of scannedIds) {
    if (excluded.has(id) && seen.has(id)) {
      // counted as golden already
    }
  }

  const eligible: Array<{
    threadId: string;
    classification: FeedThreadEligibility;
  }> = [];

  for (const thread of unseen) {
    const messages = await loadEligibilityMessages({
      userId: opts.userId,
      threadId: thread.id,
    });
    const eligibility = classifyFeedThreadEligibility({
      subject: thread.subject,
      accountEmail,
      messages,
    });
    prefilterCounts[eligibility.classification] += 1;
    if (
      eligibility.classification !== "business_conversation" &&
      eligibility.classification !== "important_transactional"
    ) {
      continue;
    }
    if (!eligibility.eligibleForExtraction) continue;
    eligible.push({
      threadId: thread.id,
      classification: eligibility.classification,
    });
  }

  const selected = selectBlindThreadsDeterministic({
    seed,
    eligible,
    hardCap,
  });

  return {
    selectionSeed: seed,
    scanned: scannedThreads.length,
    previouslySeenRemoved,
    goldenExcluded,
    prefilterCounts,
    eligibleUnseen: eligible.length,
    selected,
    sampleSmallerThanCap: selected.length < hardCap,
  };
}

export function filterPreviouslySeenThreads(opts: {
  threadIds: string[];
  seenThreadIds: string[];
  excludedThreadIds?: string[];
}): string[] {
  const seen = new Set(opts.seenThreadIds);
  const excluded = new Set(opts.excludedThreadIds ?? O5A4_EXCLUDED_THREAD_IDS);
  return opts.threadIds.filter((id) => !seen.has(id) && !excluded.has(id));
}
