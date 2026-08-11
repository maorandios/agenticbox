import "server-only";
import { z } from "zod";

export const onyxMetadataSchema = z.record(
  z.string(),
  z.union([z.string(), z.array(z.string())]),
);

export const onyxTextSectionSchema = z.object({
  text: z.string().min(1),
  link: z.string().optional().nullable(),
  type: z.literal("text").optional(),
});

export const onyxUpsertDocumentInputSchema = z.object({
  id: z.string().min(1),
  semanticIdentifier: z.string().min(1),
  title: z.string().optional().nullable(),
  sections: z.array(onyxTextSectionSchema).min(1),
  metadata: onyxMetadataSchema.optional(),
});

export const onyxIngestionResultSchema = z.object({
  document_id: z.string(),
  already_existed: z.boolean(),
});

export const onyxHealthSchema = z.object({
  success: z.boolean(),
  message: z.string().nullable().optional(),
  data: z.unknown().optional(),
});

export const onyxCitationInfoSchema = z.object({
  citation_number: z.number().optional().nullable(),
  document_id: z.string(),
  type: z.string().optional().nullable(),
});

export const onyxSearchDocSchema = z.object({
  document_id: z.string(),
  semantic_identifier: z.string().optional().nullable(),
  blurb: z.string().optional().nullable(),
  link: z.string().optional().nullable(),
  source_type: z.string().optional().nullable(),
  metadata: onyxMetadataSchema.optional().nullable(),
  chunk_ind: z.number().optional().nullable(),
  boost: z.number().optional().nullable(),
  hidden: z.boolean().optional().nullable(),
  match_highlights: z.array(z.string()).optional().nullable(),
});

export const onyxChatFullResponseSchema = z.object({
  answer: z.string(),
  answer_citationless: z.string().optional().nullable(),
  citation_info: z.array(onyxCitationInfoSchema).default([]),
  top_documents: z.array(onyxSearchDocSchema).default([]),
  message_id: z.union([z.number(), z.string()]).optional().nullable(),
  chat_session_id: z.string().nullable().optional(),
  error_msg: z.string().nullable().optional(),
  tool_calls: z.array(z.unknown()).optional().nullable(),
  pre_answer_reasoning: z.string().nullable().optional(),
});

export const onyxAskInputSchema = z.object({
  question: z.string().min(1),
  chatSessionId: z.string().nullable().optional(),
});

export type OnyxUpsertDocumentInput = z.infer<typeof onyxUpsertDocumentInputSchema>;
export type OnyxAskInput = z.infer<typeof onyxAskInputSchema>;
export type OnyxChatFullResponse = z.infer<typeof onyxChatFullResponseSchema>;
export type OnyxIngestionResult = z.infer<typeof onyxIngestionResultSchema>;
