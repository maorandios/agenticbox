import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/require-user";
import { getMailAccountForUser } from "@/server/mail/account-service";
import { processBackfillQueue } from "@/server/mail/sync/worker";
import { assertNoSecretLeak } from "@/server/mail/account-dto";

/**
 * Authenticated tick: processes one backfill job for the current user.
 * Used by Settings polling while sync_status === syncing (no cron required).
 */
export async function POST() {
  const { user } = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await processBackfillQueue({
      maxJobs: 1,
      onlyUserId: user.id,
    });
    const account = await getMailAccountForUser(user.id);
    const body = { account, ...result };
    assertNoSecretLeak(body);
    return NextResponse.json(body);
  } catch {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
