import "server-only";
import { z } from "zod";

export const IntelligenceFactSchema = z.object({
  topicKey: z.string().min(1).max(120),
  text: z.string().min(1).max(400),
  sourceMessageId: z.string().min(1),
  evidenceText: z.string().min(1).max(500),
  actorName: z.string().nullable(),
  actorEmail: z.string().nullable(),
  occurredAt: z.string().min(1),
  dueAt: z.string().nullable(),
  status: z.enum(["current", "resolved", "superseded"]),
});

export type IntelligenceFact = z.infer<typeof IntelligenceFactSchema>;

export const ThreadIntelligenceStateSchema = z.object({
  openActions: z.array(IntelligenceFactSchema),
  decisions: z.array(IntelligenceFactSchema),
  deadlines: z.array(IntelligenceFactSchema),
  currentFacts: z.array(IntelligenceFactSchema),
  resolvedItems: z.array(IntelligenceFactSchema),
});

export type ThreadIntelligenceState = z.infer<
  typeof ThreadIntelligenceStateSchema
>;

export const ResponsibilityScopeSchema = z.enum([
  "account_owner",
  "account_owner_team",
  "external_person",
  "unknown",
]);

export type ResponsibilityScope = z.infer<typeof ResponsibilityScopeSchema>;

/** @deprecated use ResponsibilityScopeSchema */
export const ActionOwnerSchema = ResponsibilityScopeSchema;
export type ActionOwner = ResponsibilityScope;

export const ExtractedPartySchema = z.object({
  name: z.string().nullable(),
  email: z.string().nullable(),
  evidenceText: z.string().min(1).max(500),
});

export type ExtractedParty = z.infer<typeof ExtractedPartySchema>;

export const RequestParticipantSchema = z.object({
  name: z.string().nullable(),
  email: z.string().nullable(),
  roleEvidenceText: z.string().max(500).nullable(),
});

export type RequestParticipant = z.infer<typeof RequestParticipantSchema>;

export const RequestEvidenceSchema = z.object({
  sourceMessageId: z.string().min(1),
  evidenceText: z.string().min(1).max(500),
  evidenceType: z.enum([
    "request",
    "assignee",
    "business_object",
    "deadline",
    "context",
  ]),
  fromCurrentMessage: z.boolean(),
});

export type RequestEvidence = z.infer<typeof RequestEvidenceSchema>;

export const RequestModalitySchema = z.enum([
  "direct_request",
  "implicit_request",
  "commitment",
  "suggestion",
  "conditional_request",
  "information_only",
]);

export type RequestModality = z.infer<typeof RequestModalitySchema>;

/** Model may omit; server always recomputes before persist. */
export const RequestSpeechActSchema = z.enum([
  "directive",
  "permission_request",
  "approval_request",
  "review_request",
  "response_request",
  "implicit_missing_item_request",
  "commitment",
  "status_change",
  "information",
  "uncertain",
]);

export type RequestSpeechAct = z.infer<typeof RequestSpeechActSchema>;

export const CommunicationNatureSchema = z.enum([
  "business_request",
  "business_decision",
  "business_change",
  "transactional_notice",
  "system_notification",
  "marketing",
  "cold_outreach",
  "verification_solicitation",
  "legal_or_security_claim",
  "informational",
  "uncertain",
]);

export type CommunicationNature = z.infer<typeof CommunicationNatureSchema>;

export const FeedDispositionSchema = z.enum([
  "create_action",
  "create_change",
  "create_decision",
  "create_alert",
  "suppress",
]);

export type FeedDisposition = z.infer<typeof FeedDispositionSchema>;

export const ActionStateSchema = z.enum([
  "requested",
  "committed",
  "completed",
  "already_sent",
  "informational",
  "uncertain",
]);

export type ActionState = z.infer<typeof ActionStateSchema>;

export const AlertCategorySchema = z.enum([
  "legal",
  "security",
  "payment",
  "service",
  "operational",
  "suspicious_sender",
]);

export type AlertCategory = z.infer<typeof AlertCategorySchema>;

export const AlertVerificationStateSchema = z.enum([
  "unverified",
  "verified",
  "not_required",
]);

export type AlertVerificationState = z.infer<
  typeof AlertVerificationStateSchema
>;

export const RequestDirectionSchema = z.enum([
  "requested_from_account_owner",
  "sent_by_account_owner",
  "external_to_external",
  "self_commitment",
  "team_request",
  "unknown",
]);

export type RequestDirection = z.infer<typeof RequestDirectionSchema>;

export const RelationToMailboxSchema = z.enum([
  "requested_from_me",
  "sent_by_me",
  "my_commitment",
  "external_to_external",
  "unknown",
]);

export type RelationToMailbox = z.infer<typeof RelationToMailboxSchema>;

export const FeedCandidateSchema = z.object({
  type: z.enum(["action", "change", "decision", "alert"]),
  /** Model draft only — server overwrites with composed card headline. */
  headline: z.string().min(1).max(160),
  context: z.string().max(320).nullable(),
  /** Legacy actor fields — prefer requester for actions. */
  actorName: z.string().nullable(),
  actorEmail: z.string().nullable(),
  sourceMessageId: z.string().min(1),
  evidenceText: z.string().min(1).max(500),
  /** Model candidate only — recomputed in code before persist. */
  actionOwner: ResponsibilityScopeSchema.nullable(),
  responsibilityScope: ResponsibilityScopeSchema.nullable(),
  requestDirection: RequestDirectionSchema.nullable(),
  relationToMailbox: RelationToMailboxSchema.nullable(),
  requestedAction: z.string().max(240).nullable(),
  actionVerb: z.string().max(80).nullable(),
  actionObject: z.string().max(160).nullable(),
  actionPurpose: z.string().max(160).nullable(),
  requester: ExtractedPartySchema.nullable(),
  assignee: ExtractedPartySchema.nullable(),
  beneficiary: ExtractedPartySchema.nullable(),
  responseRecipient: ExtractedPartySchema.nullable(),
  requestModality: RequestModalitySchema.nullable(),
  /** Server-authoritative; model draft ignored. */
  requestSpeechAct: RequestSpeechActSchema.nullable(),
  communicationNature: CommunicationNatureSchema.nullable(),
  disposition: FeedDispositionSchema.nullable(),
  actionState: ActionStateSchema.nullable(),
  alertCategory: AlertCategorySchema.nullable(),
  alertVerificationState: AlertVerificationStateSchema.nullable(),
  attributionConfidence: z.number().min(0).max(1).nullable(),
  semanticPrecisionConfidence: z.number().min(0).max(1).nullable(),
  requestEvidence: RequestEvidenceSchema.nullable(),
  subjectEvidence: RequestEvidenceSchema.nullable(),
  contextEvidence: RequestEvidenceSchema.nullable(),
  businessObjectEvidence: RequestEvidenceSchema.nullable(),
  supportingEvidence: z.array(RequestEvidenceSchema).max(8),
  businessObject: z.string().nullable(),
  previousValue: z.string().nullable(),
  currentValue: z.string().nullable(),
  occurredAt: z.string().min(1),
  requestedAt: z.string().nullable(),
  dueAt: z.string().nullable(),
  dueEvidenceText: z.string().max(500).nullable(),
  dueSourceMessageId: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  businessRelevanceConfidence: z.number().min(0).max(1),
  topicKey: z.string().min(1).max(120),
  replacesSourceMessageId: z.string().nullable(),
});

export const FeedExtractionResultSchema = z.object({
  threadClassification: z.enum([
    "business",
    "marketing",
    "system",
    "informational",
    "uncertain",
  ]),
  communicationNature: CommunicationNatureSchema.nullable(),
  disposition: FeedDispositionSchema.nullable(),
  skipReason: z.string().nullable(),
  items: z.array(FeedCandidateSchema).max(5),
  nextState: ThreadIntelligenceStateSchema,
});

export type FeedCandidate = z.infer<typeof FeedCandidateSchema>;
export type FeedExtractionResult = z.infer<typeof FeedExtractionResultSchema>;

export const FeedExtractThreadJobSchema = z.object({
  type: z.literal("feed_extract_thread"),
  userId: z.string().uuid(),
  mailAccountId: z.string().uuid(),
  threadId: z.string().uuid(),
  triggerMessageId: z.string().uuid().nullable(),
});

export type FeedExtractThreadJob = z.infer<typeof FeedExtractThreadJobSchema>;

export function emptyIntelligenceState(): ThreadIntelligenceState {
  return {
    openActions: [],
    decisions: [],
    deadlines: [],
    currentFacts: [],
    resolvedItems: [],
  };
}
