/**
 * O5A.4 Blind Generalization Evaluation — constants (no golden content).
 */

export const O5A4_EVALUATION_VERSION = "o5a4_blind_v1";
export const O5A4_SELECTION_SEED = "o5a4-blind-2026-08-13-v1";
export const O5A4_MODEL = "gpt-4o-mini";
export const O5A4_HARD_CAP = 20;
export const O5A4_PERSIST_MODE = "dry_run" as const;

/** Golden / calibration threads — excluded from blind candidate pool. */
export const O5A4_EXCLUDED_THREAD_IDS = [
  "1c76595c-a0ae-4008-aefc-99cbade18ec3",
  "e9867a8c-45b2-41a6-94bc-32dceb84f781",
  "36fd19e1-2301-4c94-8eaf-3534b559dae6",
  "0ef69e6c-4ce5-4349-a359-1cb4789c9bb2",
] as const;

/** Engine files hashed for freeze (relative to repo root). */
export const O5A4_ENGINE_FILES = [
  "src/server/feed/prompt.ts",
  "src/server/feed/schemas.ts",
  "src/server/feed/validate.ts",
  "src/server/feed/speech-act.ts",
  "src/server/feed/eligibility.ts",
  "src/server/feed/identity.ts",
  "src/server/feed/context.ts",
  "src/server/feed/clean-content.ts",
  "src/server/feed/extract.ts",
  "src/server/feed/process.ts",
  "src/server/feed/compose.ts",
] as const;
