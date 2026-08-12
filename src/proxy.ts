import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isMockEmailDataSource } from "@/lib/email-data-source/mode";

/**
 * Next.js 16 network boundary (replaces middleware.ts).
 * Mock mode: pass-through so local UI works without Auth.
 * API mode: require Supabase session except public routes.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublic =
    pathname === "/login" ||
    pathname.startsWith("/api/mail/webhooks/") ||
    pathname.startsWith("/api/internal/mail/worker") ||
    pathname.startsWith("/api/internal/onyx/worker") ||
    pathname.startsWith("/api/mail/oauth/callback");

  if (isMockEmailDataSource()) {
    return NextResponse.next({ request });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    if (isPublic) {
      return NextResponse.next({ request });
    }
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.searchParams.set("error", "config");
    return NextResponse.redirect(login);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublic) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "unauthorized" },
        {
          status: 401,
          headers: { "Cache-Control": "private, no-store" },
        },
      );
    }
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  if (user && pathname === "/login") {
    const next = request.nextUrl.clone();
    next.pathname = "/inbox";
    next.search = "";
    return NextResponse.redirect(next);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
