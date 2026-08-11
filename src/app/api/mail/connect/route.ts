import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/require-user";
import { isNylasConfigured } from "@/server/nylas/config";
import {
  buildGmailAuthUrl,
  createOauthNonce,
  persistOauthState,
} from "@/server/nylas/oauth";

export async function GET() {
  const { user } = await requireUser();
  if (!user) {
    return NextResponse.redirect(
      new URL("/login?next=/settings", process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
    );
  }

  if (!isNylasConfigured()) {
    return NextResponse.redirect(
      new URL(
        "/settings?mail=error&reason=nylas_config",
        process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
      ),
    );
  }

  try {
    const nonce = createOauthNonce();
    await persistOauthState({
      userId: user.id,
      nonce,
      redirectPath: "/settings",
    });
    const authUrl = buildGmailAuthUrl(nonce);
    return NextResponse.redirect(authUrl);
  } catch {
    return NextResponse.redirect(
      new URL(
        "/settings?mail=error&reason=connect_start",
        process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
      ),
    );
  }
}
