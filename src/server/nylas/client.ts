import "server-only";
import Nylas from "nylas";
import { getNylasConfig } from "./config";

let client: Nylas | null = null;

export function getNylasClient() {
  if (!client) {
    const { apiKey, apiUri } = getNylasConfig();
    client = new Nylas({ apiKey, apiUri });
  }
  return client;
}

/** Test helper */
export function resetNylasClientForTests() {
  client = null;
}
