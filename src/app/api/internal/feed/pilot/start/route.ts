import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/require-user";
import { getMailAccountForUser } from "@/server/mail/account-service";
import {
  clampPilotLimit,
  FEED_PILOT_HARD_CAP,
  isFeedAiEnabled,
} from "@/server/feed/config";
import { resetFeedCircuit } from "@/server/feed/circuit";
import { enqueueFeedPilot } from "@/server/feed/enqueue";
import { probeFeedModelAccess } from "@/server/feed/model-access";
import { supersedeLegacyO5aPilotItems } from "@/server/feed/supersede";

type Body = {
  limit?: number;
  supersedeLegacy?: boolean;
};

/**
 * Authenticated Feed pilot trigger. Server clamps limit to 20.
 * Probes model access once before enqueue; no fallback model.
 */
export async function POST(request: Request) {
  const { user } = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!isFeedAiEnabled()) {
    return NextResponse.json({ error: "feed_ai_disabled" }, { status: 503 });
  }

  if (!process.env.OPENAI_API_KEY?.trim()) {
    return NextResponse.json({ error: "openai_api_key_missing" }, { status: 503 });
  }

  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    body = {};
  }

  const account = await getMailAccountForUser(user.id);
  if (!account || account.syncStatus === "disconnected") {
    return NextResponse.json({ error: "no_account" }, { status: 404 });
  }

  const limit = clampPilotLimit(body.limit);

  // Fresh batch — clear any prior in-process trip from a previous request.
  resetFeedCircuit();

  try {
    let superseded = 0;
    if (body.supersedeLegacy) {
      const result = await supersedeLegacyO5aPilotItems({
        userId: user.id,
        mailAccountId: account.id,
      });
      superseded = result.superseded;
    }

    const probe = await probeFeedModelAccess({
      userId: user.id,
      mailAccountId: account.id,
    });
    if (!probe.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "model_access_failed",
          errorCode: probe.errorCode,
          model: probe.model,
          superseded,
          enqueued: 0,
        },
        { status: 503, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const result = await enqueueFeedPilot({
      userId: user.id,
      mailAccountId: account.id,
      limit,
    });
    return NextResponse.json(
      {
        ok: true,
        ...result,
        superseded,
        actualModel: probe.actualModel,
        limitMax: FEED_PILOT_HARD_CAP,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed";
    if (message === "account_not_found") {
      return NextResponse.json({ error: "account_not_found" }, { status: 404 });
    }
    if (message.startsWith("feed_supersede_refused")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
