import { ApiEmailDataSource } from "./api-email-data-source";
import { MockEmailDataSource } from "./mock-email-data-source";
import { getEmailDataSourceMode } from "./mode";
import type { EmailDataSource } from "./types";

let singleton: EmailDataSource | null = null;

export function createEmailDataSource(): EmailDataSource {
  return getEmailDataSourceMode() === "api"
    ? new ApiEmailDataSource()
    : new MockEmailDataSource();
}

/** Process-wide factory for client/server callers. */
export function getEmailDataSource(): EmailDataSource {
  if (!singleton) {
    singleton = createEmailDataSource();
  }
  return singleton;
}

/** Test helper — resets singleton between cases. */
export function resetEmailDataSourceForTests() {
  singleton = null;
}

export type { EmailDataSource, ThreadListPage, MailAccountSummary } from "./types";
export { MockEmailDataSource } from "./mock-email-data-source";
export { ApiEmailDataSource } from "./api-email-data-source";
export {
  getEmailDataSourceMode,
  isApiEmailDataSource,
  isMockEmailDataSource,
} from "./mode";
