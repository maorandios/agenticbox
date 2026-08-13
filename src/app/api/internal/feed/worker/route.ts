import { NextResponse } from "next/server";
import { processFeedQueue } from "@/server/feed/worker";

/**
 * Internal Feed worker. Auth: CRON_SECRET bearer.
 * Never returns email bodies or OpenAI payloads.
 */
export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await processFeedQueue({ maxJobs: 3 });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
