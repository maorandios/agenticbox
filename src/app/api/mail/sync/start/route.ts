import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/require-user";
import { getMailAccountForUser } from "@/server/mail/account-service";
import { startBackfillForAccount } from "@/server/mail/sync/backfill";
import { processBackfillQueue } from "@/server/mail/sync/worker";
import { assertNoSecretLeak } from "@/server/mail/account-dto";

export async function POST() {
  const { user } = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const account = await getMailAccountForUser(user.id);
    if (!account || account.syncStatus === "disconnected") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (account.syncStatus === "syncing") {
      return NextResponse.json({ error: "already_syncing" }, { status: 409 });
    }

    await startBackfillForAccount({
      userId: user.id,
      mailAccountId: account.id,
      resume: false,
    });

    // Process first page immediately so Settings shows progress without cron.
    await processBackfillQueue({ maxJobs: 1, onlyUserId: user.id });

    const refreshed = await getMailAccountForUser(user.id);
    const body = { account: refreshed };
    assertNoSecretLeak(body);
    return NextResponse.json(body);
  } catch {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
