import "server-only";

export {
  ask,
  deleteDocument,
  healthCheck,
  normalizeAnswer,
  normalizeCitations,
  upsertDocument,
  OnyxError,
} from "./adapter";

export { searchDocuments } from "./search";
export type {
  OnyxSearchHit,
  OnyxSearchResult,
  OnyxLiveSearchHit,
  OnyxLiveSearchResult,
  SearchDocumentsInput,
} from "./search";

export { getOnyxConfig, isOnyxEnabled, requireOnyxEnabled } from "./config";
export type { OnyxConfig } from "./config";

export type {
  OnyxAskResult,
  OnyxAskStatus,
  OnyxDeleteResult,
  OnyxHealthResult,
  OnyxSourceRef,
  OnyxUpsertResult,
} from "./types";

export type { OnyxAskInput, OnyxUpsertDocumentInput } from "./schemas";
export { ONYX_INTERNAL_SEARCH_TOOL_ID } from "./chat";
