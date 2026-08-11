import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/require-user";
import { disconnectMailAccountForUser } from "@/server/mail/account-service";
import { assertNoSecretLeak } from "@/server/mail/account-dto";

export async function POST() {
  const { user } = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await disconnectMailAccountForUser(user.id);
    if (!result.ok) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const body = { account: result.account };
    assertNoSecretLeak(body);
    return NextResponse.json(body);
  } catch {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
