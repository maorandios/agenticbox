import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/require-user";
import { getMailAccountForUser } from "@/server/mail/account-service";
import { assertNoSecretLeak } from "@/server/mail/account-dto";
import { PRIVATE_NO_STORE } from "@/server/mail/read/http";
import { getEmailSyncMaxThreads } from "@/server/mail/sync/types";

export async function GET() {
  const { user } = await requireUser();
  if (!user) {
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401, headers: PRIVATE_NO_STORE },
    );
  }

  try {
    const account = await getMailAccountForUser(user.id);
    const body = {
      account,
      backfillMaxThreads: getEmailSyncMaxThreads(),
    };
    assertNoSecretLeak(body);
    return NextResponse.json(body, { headers: PRIVATE_NO_STORE });
  } catch {
    return NextResponse.json(
      { error: "failed" },
      { status: 500, headers: PRIVATE_NO_STORE },
    );
  }
}
