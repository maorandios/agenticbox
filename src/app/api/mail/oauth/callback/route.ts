import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth/require-user";
import { upsertMailAccountFromGrant } from "@/server/mail/account-service";
import { consumeOauthState, exchangeOauthCode } from "@/server/nylas/oauth";

function appUrl(path: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return new URL(path, base);
}

export async function GET(request: NextRequest) {
  const { user } = await requireUser();
  if (!user) {
    return NextResponse.redirect(
      appUrl("/login?next=/settings&error=session"),
    );
  }

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const oauthError = request.nextUrl.searchParams.get("error");

  if (oauthError) {
    return NextResponse.redirect(
      appUrl(`/settings?mail=error&reason=provider_${oauthError}`),
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      appUrl("/settings?mail=error&reason=missing_code"),
    );
  }

  const consumed = await consumeOauthState({
    nonce: state,
    userId: user.id,
  });

  if (!consumed.ok) {
    return NextResponse.redirect(
      appUrl(`/settings?mail=error&reason=state_${consumed.reason}`),
    );
  }

  try {
    const token = await exchangeOauthCode(code);
    if (!token.grantId || !token.email) {
      return NextResponse.redirect(
        appUrl("/settings?mail=error&reason=token_incomplete"),
      );
    }

    await upsertMailAccountFromGrant({
      userId: user.id,
      grantId: token.grantId,
      email: token.email,
      provider: "google",
    });

    const redirectPath = consumed.redirectPath.startsWith("/")
      ? consumed.redirectPath
      : "/settings";
    return NextResponse.redirect(
      appUrl(`${redirectPath}?mail=connected`),
    );
  } catch {
    return NextResponse.redirect(
      appUrl("/settings?mail=error&reason=exchange_failed"),
    );
  }
}
