import { z } from "zod";
import { requireUser } from "@/server/auth/require-user";
import { assertNoSecretLeak } from "@/server/mail/account-dto";
import { jsonPrivate } from "@/server/mail/read/http";
import { askMailboxQuestion } from "@/server/search/ask";

export const maxDuration = 130;

const bodySchema = z.object({
  question: z.string().min(1).max(2000),
  chatSessionId: z.string().nullable().optional(),
});

export async function POST(request: Request) {
  const { user } = await requireUser();
  if (!user) {
    return jsonPrivate({ error: "unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonPrivate({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return jsonPrivate({ error: "invalid_body" }, { status: 400 });
  }

  // Reject client-supplied tenancy / Onyx internals even if present.
  const forbidden = [
    "userId",
    "user_id",
    "mailAccountId",
    "mail_account_id",
    "personaId",
    "allowedToolIds",
    "documentIds",
  ];
  if (
    json &&
    typeof json === "object" &&
    forbidden.some((k) => k in (json as Record<string, unknown>))
  ) {
    return jsonPrivate({ error: "forbidden_fields" }, { status: 400 });
  }

  try {
    const result = await askMailboxQuestion({
      userId: user.id,
      question: parsed.data.question,
      chatSessionId: parsed.data.chatSessionId ?? null,
    });
    assertNoSecretLeak(result);
    return jsonPrivate(result);
  } catch {
    return jsonPrivate(
      {
        status: "failed",
        answer: "לא הצלחתי להשלים את החיפוש כרגע. נסו שוב בעוד רגע.",
        chatSessionId: null,
        requestId: "local",
        latencyMs: 0,
        sources: [],
        errorCode: "failed",
      },
      { status: 500 },
    );
  }
}
