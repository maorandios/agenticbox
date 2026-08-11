import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getOnyxConfig, isOnyxEnabled, requireOnyxEnabled } from "@/server/onyx/config";
import { OnyxError } from "@/server/onyx/errors";

const ENV_KEYS = [
  "ONYX_ENABLED",
  "ONYX_BASE_URL",
  "ONYX_INGESTION_API_KEY",
  "ONYX_CHAT_API_KEY",
  "ONYX_PERSONA_ID",
  "ONYX_CC_PAIR_ID",
  "ONYX_TIMEOUT_MS",
  "ONYX_MAX_RETRIES",
] as const;

const snapshot: Record<string, string | undefined> = {};

function rememberEnv() {
  for (const key of ENV_KEYS) snapshot[key] = process.env[key];
}

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function clearOnyxEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

describe("onyx config", () => {
  rememberEnv();
  afterEach(() => {
    restoreEnv();
  });

  it("treats missing ONYX_ENABLED as disabled", () => {
    clearOnyxEnv();
    expect(isOnyxEnabled()).toBe(false);
    const config = getOnyxConfig("t1");
    expect(config.enabled).toBe(false);
  });

  it("requireOnyxEnabled throws disabled when flag off", () => {
    clearOnyxEnv();
    process.env.ONYX_ENABLED = "false";
    expect(() => requireOnyxEnabled("t2")).toThrow(OnyxError);
    try {
      requireOnyxEnabled("t2");
    } catch (error) {
      expect(error).toBeInstanceOf(OnyxError);
      expect((error as OnyxError).code).toBe("disabled");
    }
  });

  it("requires keys and cc_pair when enabled", () => {
    clearOnyxEnv();
    process.env.ONYX_ENABLED = "true";
    process.env.ONYX_BASE_URL = "https://cloud.onyx.app/api";
    process.env.ONYX_INGESTION_API_KEY = "ingest-key";
    process.env.ONYX_CHAT_API_KEY = "chat-key";
    expect(() => getOnyxConfig("t3")).toThrow(/ONYX_CC_PAIR_ID/);

    process.env.ONYX_CC_PAIR_ID = "2";
    const config = getOnyxConfig("t3");
    expect(config.enabled).toBe(true);
    expect(config.ccPairId).toBe(2);
    expect(config.ingestionApiKey).toBe("ingest-key");
    expect(config.chatApiKey).toBe("chat-key");
    expect(config.ingestionApiKey).not.toBe(config.chatApiKey);
  });

  it("keeps ingestion and chat keys distinct in config", () => {
    clearOnyxEnv();
    process.env.ONYX_ENABLED = "true";
    process.env.ONYX_BASE_URL = "https://example.test/api";
    process.env.ONYX_INGESTION_API_KEY = "admin-secret";
    process.env.ONYX_CHAT_API_KEY = "basic-secret";
    process.env.ONYX_CC_PAIR_ID = "2";
    process.env.ONYX_PERSONA_ID = "0";
    const config = getOnyxConfig("t4");
    expect(config.ingestionApiKey).toBe("admin-secret");
    expect(config.chatApiKey).toBe("basic-secret");
  });
});
