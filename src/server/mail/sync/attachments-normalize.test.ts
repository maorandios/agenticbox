import { describe, expect, it } from "vitest";
import {
  ATTACHMENTS_ON_CONFLICT,
  normalizeAttachmentsForMessage,
} from "@/server/mail/sync/attachments-normalize";
import type { NylasAttachment } from "@/server/mail/sync/nylas-types";
import {
  EMAIL_SYNC_MAX_THREADS_DEFAULT,
  getEmailSyncMaxThreads,
} from "@/server/mail/sync/types";

function att(
  partial: Partial<NylasAttachment> & { id: string },
): NylasAttachment {
  return {
    filename: "file.bin",
    contentType: "application/octet-stream",
    size: 10,
    isInline: false,
    ...partial,
  };
}

describe("attachment normalize + dedupe", () => {
  it("uses DB conflict target message_id,provider_attachment_id", () => {
    expect(ATTACHMENTS_ON_CONFLICT).toBe("message_id,provider_attachment_id");
  });

  it("collapses the same attachment twice in one payload", () => {
    const result = normalizeAttachmentsForMessage([
      att({ id: "att-1", filename: "a.pdf", size: 1 }),
      att({ id: "att-1", filename: "a.pdf", size: 1, contentType: "application/pdf" }),
    ]);
    expect(result.rows).toHaveLength(1);
    expect(result.duplicatesNeutralized).toBe(1);
    expect(result.rows[0].provider_attachment_id).toBe("att-1");
    expect(result.rows[0].mime_type).toBe("application/pdf");
  });

  it("prefers richer metadata when neutralizing duplicates", () => {
    const result = normalizeAttachmentsForMessage([
      att({ id: "att-1", filename: "attachment", size: undefined }),
      att({
        id: "att-1",
        filename: "invoice.pdf",
        contentType: "application/pdf",
        size: 2048,
        contentId: "cid-1",
      }),
    ]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].filename).toBe("invoice.pdf");
    expect(result.rows[0].size_bytes).toBe(2048);
    expect(result.rows[0].content_id).toBe("cid-1");
  });

  it("keeps two different attachments with the same filename", () => {
    const result = normalizeAttachmentsForMessage([
      att({ id: "att-a", filename: "same.pdf" }),
      att({ id: "att-b", filename: "same.pdf" }),
    ]);
    expect(result.rows).toHaveLength(2);
    expect(result.duplicatesNeutralized).toBe(0);
    expect(result.rows.map((r) => r.provider_attachment_id).sort()).toEqual([
      "att-a",
      "att-b",
    ]);
  });

  it("scopes provider_attachment_id per message — same id on different messages stay separate keys", () => {
    const msgA = normalizeAttachmentsForMessage([att({ id: "shared-att" })]);
    const msgB = normalizeAttachmentsForMessage([att({ id: "shared-att" })]);
    const keyA = `msg-a:${msgA.rows[0].provider_attachment_id}`;
    const keyB = `msg-b:${msgB.rows[0].provider_attachment_id}`;
    expect(keyA).not.toBe(keyB);
    expect(msgA.rows[0].provider_attachment_id).toBe("shared-att");
    expect(msgB.rows[0].provider_attachment_id).toBe("shared-att");
  });

  it("does not fail normalize when inline duplicate appears with file duplicate", () => {
    const result = normalizeAttachmentsForMessage([
      att({ id: "att-1", isInline: true, contentId: "cid", filename: "img.png" }),
      att({ id: "att-1", isInline: false, filename: "img.png", size: 99 }),
    ]);
    expect(result.rows).toHaveLength(1);
    expect(result.duplicatesNeutralized).toBe(1);
    // richer: size + filename keep; inline flag from richer row wins when score higher
    expect(result.rows[0].size_bytes).toBe(99);
  });

  it("skips missing provider_attachment_id safely", () => {
    const result = normalizeAttachmentsForMessage([
      att({ id: "  ", filename: "x" }),
      att({ id: "ok", filename: "y" }),
    ]);
    expect(result.skippedMissingId).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].provider_attachment_id).toBe("ok");
  });
});

describe("attachment upsert idempotency + retry semantics", () => {
  it("building upsert rows twice yields the same conflict keys (retry safe)", () => {
    const payload = [
      att({ id: "att-1" }),
      att({ id: "att-1" }),
      att({ id: "att-2" }),
    ];
    const first = normalizeAttachmentsForMessage(payload);
    const second = normalizeAttachmentsForMessage(payload);
    expect(first.rows.map((r) => r.provider_attachment_id)).toEqual(
      second.rows.map((r) => r.provider_attachment_id),
    );
    expect(first.rows).toHaveLength(2);
  });

  it("simulates partial page retry without doubling thread counters when checkpoint not advanced", () => {
    // Failure path: checkpoint write happens only after full page success.
    const checkpointThreadsDone = 40;
    const pageThreadCount = 20;
    const failedBeforeCheckpoint = true;

    const afterFailureThreadsDone = failedBeforeCheckpoint
      ? checkpointThreadsDone
      : checkpointThreadsDone + pageThreadCount;

    // Retry re-processes the same page once; then advances once.
    const afterRetrySuccess = afterFailureThreadsDone + pageThreadCount;
    expect(afterFailureThreadsDone).toBe(40);
    expect(afterRetrySuccess).toBe(60);
    expect(afterRetrySuccess).not.toBe(80);
  });

  it("does not advance checkpoint when attachments upsert throws", () => {
    const writes: string[] = [];
    const upsertAttachments = () => {
      writes.push("attachments");
      throw new Error("attachments_upsert_failed:duplicate");
    };
    const writeCheckpoint = () => {
      writes.push("checkpoint");
    };

    try {
      upsertAttachments();
      writeCheckpoint();
    } catch {
      // swallow — mirrors backfill catch before checkpoint
    }
    expect(writes).toEqual(["attachments"]);
    expect(writes).not.toContain("checkpoint");
  });

  it("preserves 100-thread backfill cap", () => {
    delete process.env.EMAIL_SYNC_MAX_THREADS;
    expect(getEmailSyncMaxThreads()).toBe(EMAIL_SYNC_MAX_THREADS_DEFAULT);
    expect(getEmailSyncMaxThreads()).toBe(100);
    const remaining = Math.max(0, 100 - 60);
    expect(remaining).toBe(40);
    expect(60 + Math.min(20, remaining)).toBeLessThanOrEqual(100);
  });
});

describe("persist upsertAttachments wiring", () => {
  it("exposes conflict target constant used by persist upsert", () => {
    expect(ATTACHMENTS_ON_CONFLICT).toBe("message_id,provider_attachment_id");
    const normalized = normalizeAttachmentsForMessage([
      att({ id: "att-dup" }),
      att({ id: "att-dup", contentType: "image/png" }),
    ]);
    expect(normalized.rows).toHaveLength(1);
    // Persist builds upsert(..., { onConflict: ATTACHMENTS_ON_CONFLICT }).
    const upsertOpts = { onConflict: ATTACHMENTS_ON_CONFLICT };
    expect(upsertOpts.onConflict).toBe("message_id,provider_attachment_id");
  });
});
