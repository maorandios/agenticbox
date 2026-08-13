export type FeedItemType = "action" | "change" | "decision" | "due";

export type FeedItemStatus =
  | "new"
  | "open"
  | "scheduled"
  | "handled"
  | "irrelevant"
  | "cancelled"
  | "superseded"
  | "needs_replacement";

export type FeedResponsibilityScope =
  | "account_owner"
  | "account_owner_team"
  | "external_person"
  | "unknown";

export type FeedRequestDirection =
  | "requested_from_account_owner"
  | "sent_by_account_owner"
  | "external_to_external"
  | "self_commitment"
  | "team_request"
  | "unknown";

export type FeedRelationToMailbox =
  | "requested_from_me"
  | "sent_by_me"
  | "my_commitment"
  | "external_to_external"
  | "unknown";

export type FeedCardDto = {
  id: string;
  type: FeedItemType;
  typeLabel: string;
  headline: string;
  context: string | null;
  actorName: string | null;
  actorEmail: string | null;
  occurredAt: string;
  dueAt: string | null;
  status: FeedItemStatus;
  threadId: string;
  sourceUrl: string;
  responsibilityScope: FeedResponsibilityScope | null;
  requestDirection: FeedRequestDirection | null;
  relationToMailbox: FeedRelationToMailbox | null;
  requesterName: string | null;
  requesterEmail: string | null;
  assigneeName: string | null;
  assigneeEmail: string | null;
  requestedAt: string | null;
  attributionLine: string | null;
  waitingLine: string | null;
  /** Single ask line for inbound requests — includes requestedAt once. */
  askLine: string | null;
  canMarkHandled: boolean;
};

export type FeedListResponse = {
  items: FeedCardDto[];
  nextCursor: string | null;
};
