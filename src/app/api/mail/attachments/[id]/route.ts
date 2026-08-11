import { requireUser } from "@/server/auth/require-user";
import { PRIVATE_NO_STORE } from "@/server/mail/read/http";
import { downloadOwnedAttachment } from "@/server/mail/read/attachments";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { user } = await requireUser();
  if (!user) {
    return new Response(null, { status: 401, headers: PRIVATE_NO_STORE });
  }

  const { id } = await context.params;
  if (!id) {
    return new Response(null, { status: 404, headers: PRIVATE_NO_STORE });
  }

  return downloadOwnedAttachment({ userId: user.id, attachmentId: id });
}
