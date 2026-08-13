import { NextResponse } from "next/server";
import { isOnyxEnabled } from "@/server/onyx/config";
import { processOnyxQueue } from "@/server/onyx/index/worker";

/**
 * Internal Onyx index worker. Auth: CRON_SECRET bearer.
 * Never returns document bodies.
 */
export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!isOnyxEnabled()) {
    return NextResponse.json(
      { error: "onyx_disabled", processed: 0 },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  try {
    const result = await processOnyxQueue({ maxJobs: 3 });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
