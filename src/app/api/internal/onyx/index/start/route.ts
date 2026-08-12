import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/require-user";
import { enqueueAccountIndex } from "@/server/onyx/index/enqueue";
import { getIndexProgress } from "@/server/onyx/index/progress";
import { clampPilotLimit, PILOT_INDEX_LIMIT_MAX } from "@/server/onyx/index/types";
import { isOnyxEnabled } from "@/server/onyx/config";

type Body = {
  mailAccountId?: string;
  limit?: number;
};

/**
 * Authenticated pilot trigger. Server clamps limit to 10.
 * Does not accept arbitrary userId from client.
 */
export async function POST(request: Request) {
  const { user } = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!isOnyxEnabled()) {
    return NextResponse.json({ error: "onyx_disabled" }, { status: 503 });
  }

  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    body = {};
  }

  const mailAccountId = body.mailAccountId?.trim();
  if (!mailAccountId) {
    return NextResponse.json({ error: "mail_account_id_required" }, { status: 400 });
  }

  const limit = clampPilotLimit(body.limit);

  try {
    const enqueued = await enqueueAccountIndex({
      userId: user.id,
      mailAccountId,
      limit,
    });
    const progress = await getIndexProgress({
      userId: user.id,
      mailAccountId,
    });

    return NextResponse.json(
      {
        ok: true,
        limit,
        limitMax: PILOT_INDEX_LIMIT_MAX,
        ...enqueued,
        progress,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed";
    if (message === "account_not_found") {
      return NextResponse.json({ error: "account_not_found" }, { status: 404 });
    }
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
