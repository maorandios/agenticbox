import { NextResponse } from "next/server";
import { processBackfillQueue } from "@/server/mail/sync/worker";

/**
 * Optional internal worker (CRON_SECRET). Phase 2B Settings uses /api/mail/sync/process.
 */
export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await processBackfillQueue({ maxJobs: 3 });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
