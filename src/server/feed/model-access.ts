import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getFeedConfig } from "./config";
import {
  isCircuitBreakerError,
  mapOpenAiHttpError,
  tripFeedCircuit,
} from "./circuit";
import { getFeedOpenAiClient } from "./openai-client";

export type ModelAccessProbeResult =
  | {
      ok: true;
      model: string;
      actualModel: string;
      latencyMs: number;
    }
  | {
      ok: false;
      errorCode: string;
      model: string;
      latencyMs: number;
    };

/**
 * Non-generative access check (models.retrieve). Documented as a separate API call.
 * Does not consume generation tokens. Excluded from daily extraction attempt counts.
 * On failure: trips circuit breaker and stops the batch. No model fallback.
 */
export async function probeFeedModelAccess(opts: {
  userId: string;
  mailAccountId: string;
}): Promise<ModelAccessProbeResult> {
  const config = getFeedConfig();
  const model = config.model;
  const started = Date.now();
  const admin = createAdminClient();
  const now = new Date().toISOString();

  // Record attempt before the call so failures still count toward the daily limit.
  const { data: run, error: insertError } = await admin
    .from("feed_extraction_runs")
    .insert({
      user_id: opts.userId,
      mail_account_id: opts.mailAccountId,
      thread_id: null,
      status: "processing",
      model,
      extraction_version: config.extractionVersion,
      prefilter_skipped: false,
      eligibility_classification: "model_probe",
      started_at: now,
    })
    .select("id")
    .maybeSingle();

  if (insertError) {
    throw new Error(`feed_model_probe_insert_failed:${insertError.message}`);
  }
  const runId = run!.id as string;

  try {
    const client = getFeedOpenAiClient();
    const retrieved = await client.models.retrieve(model);
    const latencyMs = Date.now() - started;
    const actualModel =
      typeof retrieved?.id === "string" && retrieved.id.trim()
        ? retrieved.id.trim()
        : model;

    await admin
      .from("feed_extraction_runs")
      .update({
        status: "completed",
        actual_model: actualModel,
        latency_ms: latencyMs,
        completed_at: new Date().toISOString(),
        candidate_count: 0,
        accepted_count: 0,
        rejected_count: 0,
      })
      .eq("id", runId)
      .eq("user_id", opts.userId);

    return { ok: true, model, actualModel, latencyMs };
  } catch (error) {
    const latencyMs = Date.now() - started;
    const status =
      error && typeof error === "object" && "status" in error
        ? Number((error as { status?: number }).status)
        : null;
    const message = error instanceof Error ? error.message : "unknown";
    const errorCode = mapOpenAiHttpError({ status, message });

    await admin
      .from("feed_extraction_runs")
      .update({
        status: "failed",
        error_code: errorCode,
        latency_ms: latencyMs,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId)
      .eq("user_id", opts.userId);

    if (isCircuitBreakerError(errorCode)) {
      tripFeedCircuit(errorCode);
    } else {
      // Any probe failure still stops the batch — do not try the model on threads.
      tripFeedCircuit(errorCode);
    }

    return { ok: false, errorCode, model, latencyMs };
  }
}
