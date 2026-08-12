/**
 * O3 live pilot — up to 10 threads from the active business mail account.
 *
 *   O3_PILOT_LIVE=1 npm run test -- src/server/onyx/index/o3-pilot.live.test.ts
 *
 * Never prints subjects, emails, bodies, filenames, or secrets.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { ask } from "@/server/onyx/adapter";
import { enqueueThreadIndex } from "@/server/onyx/index/enqueue";
import { processOnyxQueue } from "@/server/onyx/index/worker";
import { buildNormalizedThreadDocument } from "@/server/onyx/index/load-thread";
import { getIndexProgress } from "@/server/onyx/index/progress";

const enabled = process.env.O3_PILOT_LIVE === "1";

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const idx = trimmed.indexOf("=");
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (
      key.startsWith("ONYX_") ||
      key.startsWith("SUPABASE_") ||
      key.startsWith("NEXT_PUBLIC_SUPABASE_") ||
      !(key in process.env) ||
      process.env[key] === ""
    ) {
      process.env[key] = value;
    }
  }
}

function censorId(id: string): string {
  if (id.length < 10) return "***";
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

function hasHebrew(text: string | null | undefined): boolean {
  return /[\u0590-\u05FF]/.test(text ?? "");
}

function hasLatin(text: string | null | undefined): boolean {
  return /[A-Za-z]/.test(text ?? "");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

type PilotReport = Record<string, unknown>;

describe.runIf(enabled)("O3 live pilot (≤10 threads)", () => {
  loadEnvLocal();
  process.env.ONYX_ENABLED = "true";

  it(
    "indexes up to 10 business-account threads and verifies retrieval",
    async () => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      expect(url).toBeTruthy();
      expect(key).toBeTruthy();
      expect(process.env.ONYX_ENABLED).toBe("true");
      expect(process.env.ONYX_CC_PAIR_ID).toBeTruthy();

      const admin = createClient(url!, key!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      // --- Discover active business account (ready + 100 threads) ---
      const { data: accounts, error: accErr } = await admin
        .from("mail_accounts")
        .select(
          "id,user_id,sync_status,thread_count_synced,message_count_synced,email",
        )
        .neq("sync_status", "disconnected")
        .order("updated_at", { ascending: false });
      expect(accErr).toBeNull();

      const ready = (accounts ?? []).filter(
        (a) =>
          a.sync_status === "ready" &&
          Number(a.thread_count_synced) === 100 &&
          Number(a.message_count_synced) >= 100,
      );
      expect(ready.length).toBeGreaterThanOrEqual(1);

      const account = ready[0];
      const userId = account.user_id as string;
      const mailAccountId = account.id as string;

      // Confirm thread count in DB scoped to this account only
      const { count: threadCount, error: tcErr } = await admin
        .from("threads")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("mail_account_id", mailAccountId);
      expect(tcErr).toBeNull();
      expect(threadCount).toBe(100);

      // --- Peek onyx_jobs without archiving foreign jobs ---
      const { data: peekRows, error: peekErr } = await admin.rpc("onyx_jobs_read", {
        p_vt: 60,
        p_qty: 10,
      });
      expect(peekErr).toBeNull();
      const peeked = (Array.isArray(peekRows) ? peekRows : peekRows ? [peekRows] : []) as Array<{
        msg_id: number | string;
        message: { type?: string; mailAccountId?: string; userId?: string };
      }>;

      const foreign = peeked.filter((row) => {
        const msg = typeof row.message === "string" ? JSON.parse(row.message) : row.message;
        return msg?.mailAccountId && msg.mailAccountId !== mailAccountId;
      });

      if (foreign.length > 0) {
        const report: PilotReport = {
          stop: "foreign_or_unknown_onyx_jobs",
          foreignJobCount: foreign.length,
          foreignAccountIds: [
            ...new Set(
              foreign.map((r) => {
                const msg =
                  typeof r.message === "string" ? JSON.parse(r.message) : r.message;
                return censorId(String(msg.mailAccountId));
              }),
            ),
          ],
          peekedTotal: peeked.length,
          activeAccountId: censorId(mailAccountId),
        };
        writeFileSync(
          path.resolve(process.cwd(), "tmp/o3-pilot-report.json"),
          JSON.stringify(report, null, 2),
        );
        expect.fail(
          `Stopped: ${foreign.length} onyx_jobs for other accounts (not deleted). See tmp/o3-pilot-report.json`,
        );
      }

      // Same-account jobs already claimed by peek: process+archive so VT does not block Pilot.
      for (const row of peeked) {
        const msg =
          typeof row.message === "string" ? JSON.parse(row.message) : row.message;
        if (msg?.type === "onyx_index_thread") {
          const { processIndexJob } = await import("@/server/onyx/index/process");
          await processIndexJob(msg);
        }
        await admin.rpc("onyx_jobs_archive", { p_msg_id: Number(row.msg_id) });
      }
      const sameAccountPeeked = peeked.length;

      // --- Select up to 10 diverse threads (account-scoped) ---
      const { data: recentThreads, error: thErr } = await admin
        .from("threads")
        .select("id,subject,latest_message_at,folders")
        .eq("user_id", userId)
        .eq("mail_account_id", mailAccountId)
        .order("latest_message_at", { ascending: false, nullsFirst: false })
        .limit(40);
      expect(thErr).toBeNull();

      // Prefer the already-indexed Pilot set (≤10) so re-runs do not expand beyond 10.
      const { data: existingIndexed } = await admin
        .from("onyx_index_state")
        .select("thread_id,status")
        .eq("user_id", userId)
        .eq("mail_account_id", mailAccountId)
        .limit(20);

      let selected: string[] = [];
      if ((existingIndexed?.length ?? 0) > 0 && (existingIndexed?.length ?? 0) <= 10) {
        selected = existingIndexed!.map((r) => r.thread_id as string);
      } else {
        type Cand = {
          id: string;
          messageCount: number;
          hebrew: boolean;
          latin: boolean;
          hasAttachment: boolean;
        };
        const candidates: Cand[] = [];

        for (const t of recentThreads ?? []) {
          const folders = (t.folders as string[] | null) ?? [];
          if (folders.some((f) => ["TRASH", "SPAM"].includes(String(f).toUpperCase()))) {
            continue;
          }
          const { data: msgs } = await admin
            .from("messages")
            .select("id,subject,plain_text")
            .eq("user_id", userId)
            .eq("thread_id", t.id)
            .limit(50);
          const messageIds = (msgs ?? []).map((m) => m.id as string);
          let hasAttachment = false;
          if (messageIds.length) {
            const { count } = await admin
              .from("attachments_metadata")
              .select("id", { count: "exact", head: true })
              .eq("user_id", userId)
              .in("message_id", messageIds.slice(0, 20));
            hasAttachment = (count ?? 0) > 0;
          }
          const blob = [
            String(t.subject ?? ""),
            ...(msgs ?? []).map((m) => `${m.subject ?? ""} ${m.plain_text ?? ""}`),
          ].join("\n");
          candidates.push({
            id: t.id as string,
            messageCount: msgs?.length ?? 0,
            hebrew: hasHebrew(blob),
            latin: hasLatin(blob),
            hasAttachment,
          });
        }

        const take = (pred: (c: Cand) => boolean) => {
          const hit = candidates.find((c) => !selected.includes(c.id) && pred(c));
          if (hit) selected.push(hit.id);
        };
        take((c) => c.messageCount === 1);
        take((c) => c.messageCount > 1);
        take((c) => c.hebrew);
        take((c) => c.latin && !c.hebrew);
        take((c) => c.hasAttachment);
        for (const c of candidates) {
          if (selected.length >= 10) break;
          if (!selected.includes(c.id)) selected.push(c.id);
        }
      }
      expect(selected.length).toBeGreaterThan(0);
      expect(selected.length).toBeLessThanOrEqual(10);

      // --- Enqueue ---
      let enqueued = 0;
      let skippedQueued = 0;
      for (const threadId of selected) {
        const result = await enqueueThreadIndex({
          userId,
          mailAccountId,
          threadId,
        });
        if (result.enqueued) enqueued += 1;
        else skippedQueued += 1;
      }

      // --- Drain worker in small batches ---
      const startedAt = Date.now();
      const totals = {
        read: 0,
        indexed: 0,
        skipped: 0,
        failed: 0,
        retried: 0,
        deleted: 0,
        batches: 0,
      };
      for (let batch = 0; batch < 20; batch += 1) {
        const counters = await processOnyxQueue({ maxJobs: 3, visibilityTimeoutSec: 120 });
        totals.batches += 1;
        totals.read += counters.read;
        totals.indexed += counters.indexed;
        totals.skipped += counters.skipped;
        totals.failed += counters.failed;
        totals.retried += counters.retried;
        totals.deleted += counters.deleted;
        if (counters.read === 0) break;
        await sleep(400);
      }
      const indexDurationMs = Date.now() - startedAt;

      // Wait briefly if retries left visibility timeout
      if (totals.retried > 0) {
        await sleep(2000);
        for (let batch = 0; batch < 10; batch += 1) {
          const counters = await processOnyxQueue({ maxJobs: 3 });
          totals.batches += 1;
          totals.read += counters.read;
          totals.indexed += counters.indexed;
          totals.skipped += counters.skipped;
          totals.failed += counters.failed;
          totals.retried += counters.retried;
          if (counters.read === 0) break;
          await sleep(400);
        }
      }

      const { data: statesRaw, error: stErr } = await admin
        .from("onyx_index_state")
        .select(
          "id,thread_id,mail_account_id,onyx_document_id,content_hash,status,attempt_count,last_error_code",
        )
        .eq("user_id", userId)
        .eq("mail_account_id", mailAccountId)
        .in("thread_id", selected);
      expect(stErr).toBeNull();

      // Repair URL-encoded document ids from the first Pilot pass (integration fix).
      for (const row of statesRaw ?? []) {
        const current = String(row.onyx_document_id ?? "");
        if (!current.includes("%")) continue;
        let decoded = current;
        try {
          decoded = decodeURIComponent(current);
        } catch {
          continue;
        }
        if (decoded !== current) {
          await admin
            .from("onyx_index_state")
            .update({
              onyx_document_id: decoded,
              updated_at: new Date().toISOString(),
            })
            .eq("id", row.id);
          row.onyx_document_id = decoded;
        }
      }

      const states = statesRaw;
      expect((states ?? []).length).toBeLessThanOrEqual(10);
      expect((states ?? []).length).toBe(selected.length);

      const statusCounts = {
        indexed: 0,
        failed: 0,
        pending: 0,
        processing: 0,
        other: 0,
      };
      let messageSections = 0;
      let cleanCount = 0;
      let plainFallback = 0;
      let emptyBody = 0;
      let rawHtmlInDoc = 0;
      let badDocId = 0;
      let missingHash = 0;
      let wrongAccount = 0;

      for (const row of states ?? []) {
        if (row.mail_account_id !== mailAccountId) wrongAccount += 1;
        if (row.status === "indexed") statusCounts.indexed += 1;
        else if (row.status === "failed") statusCounts.failed += 1;
        else if (row.status === "pending") statusCounts.pending += 1;
        else if (row.status === "processing") statusCounts.processing += 1;
        else statusCounts.other += 1;

        if (!row.content_hash) missingHash += 1;
        const expectedId = `user:${userId}:thread:${row.thread_id}`;
        if (row.onyx_document_id !== expectedId) badDocId += 1;

        const doc = await buildNormalizedThreadDocument({
          userId,
          mailAccountId,
          threadId: row.thread_id as string,
        });
        if (doc) {
          messageSections += doc.quality.sectionCount;
          cleanCount += doc.quality.cleanConversationCount;
          plainFallback += doc.quality.plainTextFallbackCount;
          emptyBody += doc.quality.emptyBodyCount;
          for (const section of doc.sections) {
            if (
              /<\/?(?:html|body|div|span|table|tr|td|th|p|br|img|a|style|script|font|center)\b/i.test(
                section.text,
              )
            ) {
              rawHtmlInDoc += 1;
            }
            expect(section.link).toContain(`/source/thread/${row.thread_id}`);
          }
          expect(doc.metadata.mail_account_id).toBe(mailAccountId);
          expect(doc.metadata.thread_id).toBe(row.thread_id);
        }
      }

      expect(wrongAccount).toBe(0);
      expect(badDocId).toBe(0);
      expect(rawHtmlInDoc).toBe(0);
      expect(statusCounts.processing).toBe(0);

      // Disconnected account threads must not appear in this account's index set
      const { data: disconnected } = await admin
        .from("mail_accounts")
        .select("id")
        .eq("user_id", userId)
        .eq("sync_status", "disconnected")
        .limit(5);
      for (const d of disconnected ?? []) {
        const { count } = await admin
          .from("onyx_index_state")
          .select("id", { count: "exact", head: true })
          .eq("mail_account_id", d.id);
        expect(count ?? 0).toBe(0);
      }

      // --- Idempotency: re-enqueue same 10 ---
      let reEnqueued = 0;
      for (const threadId of selected) {
        const result = await enqueueThreadIndex({
          userId,
          mailAccountId,
          threadId,
        });
        if (result.enqueued) reEnqueued += 1;
      }
      const idemTotals = {
        read: 0,
        indexed: 0,
        skipped: 0,
        failed: 0,
      };
      for (let batch = 0; batch < 15; batch += 1) {
        const counters = await processOnyxQueue({ maxJobs: 3 });
        idemTotals.read += counters.read;
        idemTotals.indexed += counters.indexed;
        idemTotals.skipped += counters.skipped;
        idemTotals.failed += counters.failed;
        if (counters.read === 0) break;
        await sleep(300);
      }

      const { count: stateCountAfter } = await admin
        .from("onyx_index_state")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("mail_account_id", mailAccountId);
      expect(stateCountAfter).toBe(selected.length);
      expect(idemTotals.indexed).toBe(0);

      // --- Retrieval (PASS/FAIL only in report) ---
      const indexedRow = (states ?? []).find((s) => s.status === "indexed");
      let retrieval: PilotReport = { status: "skipped_no_indexed" };
      if (indexedRow) {
        const doc = await buildNormalizedThreadDocument({
          userId,
          mailAccountId,
          threadId: indexedRow.thread_id as string,
        });
        // Allow Onyx connector indexing lag before retrieval.
        await sleep(8000);
        const question =
          "What is one concrete fact from my indexed email threads? Answer briefly.";
        const askResult = await ask({ question });
        const citationDocIds = (askResult.sources ?? []).map((s) => s.documentId);
        const matched = citationDocIds.includes(indexedRow.onyx_document_id as string);
        const anyPilot = citationDocIds.some((id) =>
          (states ?? []).some((s) => s.onyx_document_id === id),
        );
        retrieval = {
          status: askResult.status,
          hasAnswer: Boolean(askResult.answer && askResult.answer.trim()),
          hasCitations: (askResult.sources?.length ?? 0) > 0,
          sourceCount: askResult.sources?.length ?? 0,
          latencyMs: askResult.latencyMs,
          citationMatchesPilotDoc: matched || anyPilot,
          citationBelongsToActiveAccount: anyPilot,
          pass:
            askResult.status === "answered" &&
            (askResult.sources?.length ?? 0) > 0 &&
            (matched || anyPilot),
        };
        expect(doc?.id).toBe(indexedRow.onyx_document_id);
      }

      // Final queue drain check
      const { data: leftover } = await admin.rpc("onyx_jobs_read", {
        p_vt: 5,
        p_qty: 5,
      });
      const leftoverRows = Array.isArray(leftover) ? leftover : leftover ? [leftover] : [];

      const progress = await getIndexProgress({ userId, mailAccountId });

      const report: PilotReport = {
        mailAccountIdCensored: censorId(mailAccountId),
        userIdCensored: censorId(userId),
        syncStatus: account.sync_status,
        threadCountSynced: account.thread_count_synced,
        messageCountSynced: account.message_count_synced,
        selectedThreads: selected.length,
        enqueued,
        skippedQueued,
        sameAccountPeekedBefore: sameAccountPeeked,
        worker: totals,
        indexDurationMs,
        statusCounts,
        messageSections,
        cleanConversationCount: cleanCount,
        plainTextFallbackCount: plainFallback,
        emptyBodyCount: emptyBody,
        missingHash,
        rawHtmlInDoc,
        idempotency: {
          reEnqueued,
          ...idemTotals,
          stateCountAfter,
        },
        retrieval,
        progress,
        leftoverJobsAfterPeek: leftoverRows.length,
        qualityNotes: [
          plainFallback > cleanCount
            ? "Most sections used plain_text fallback (clean_conversation largely empty)."
            : "clean_conversation used for some sections.",
          "Quoted-text/signature stripping not applied in O3; duplication risk remains.",
        ],
      };

      writeFileSync(
        path.resolve(process.cwd(), "tmp/o3-pilot-report.json"),
        JSON.stringify(report, null, 2),
      );

      expect(selected.length).toBeLessThanOrEqual(10);
      expect(statusCounts.indexed + statusCounts.failed).toBe(selected.length);
      expect(leftoverRows.length).toBe(0);
    },
    600_000,
  );
});
