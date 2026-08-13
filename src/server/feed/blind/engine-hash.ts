import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { O5A4_ENGINE_FILES } from "./constants";

export type EngineHashSnapshot = {
  files: Record<string, string>;
  promptHash: string;
  schemaHash: string;
  validatorHash: string;
  combinedHash: string;
};

function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function hashFileRelative(relPath: string): string {
  const abs = path.resolve(process.cwd(), relPath);
  return sha256Text(readFileSync(abs, "utf8"));
}

export function freezeExtractionEngineHashes(): EngineHashSnapshot {
  const files: Record<string, string> = {};
  for (const rel of O5A4_ENGINE_FILES) {
    files[rel] = hashFileRelative(rel);
  }
  const promptHash = files["src/server/feed/prompt.ts"]!;
  const schemaHash = files["src/server/feed/schemas.ts"]!;
  const validatorHash = files["src/server/feed/validate.ts"]!;
  const combinedHash = sha256Text(
    O5A4_ENGINE_FILES.map((f) => `${f}:${files[f]}`).join("\n"),
  );
  return {
    files,
    promptHash,
    schemaHash,
    validatorHash,
    combinedHash,
  };
}

export function assertEngineHashesUnchanged(
  before: EngineHashSnapshot,
  after: EngineHashSnapshot,
): { ok: true } | { ok: false; changed: string[] } {
  const changed: string[] = [];
  for (const rel of O5A4_ENGINE_FILES) {
    if (before.files[rel] !== after.files[rel]) changed.push(rel);
  }
  if (before.combinedHash !== after.combinedHash) {
    if (!changed.includes("combined")) changed.push("combined");
  }
  return changed.length === 0 ? { ok: true } : { ok: false, changed };
}

export function selectionHash(seed: string, threadId: string): string {
  return sha256Text(`${seed}:${threadId}`);
}

export function maskUuid(id: string): string {
  if (id.length < 12) return "***";
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

export function maskAccountId(id: string): string {
  return maskUuid(id);
}

export function shortHash(hex: string, n = 12): string {
  return hex.slice(0, n);
}
