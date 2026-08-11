import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getNylasClient } from "@/server/nylas/client";
import { PRIVATE_NO_STORE } from "./http";

export async function getOwnedAttachment(params: {
  userId: string;
  attachmentId: string;
}) {
  const admin = createAdminClient();
  const { data: attachment, error } = await admin
    .from("attachments_metadata")
    .select(
      "id,user_id,message_id,provider_attachment_id,filename,mime_type,size_bytes,is_inline,content_id",
    )
    .eq("user_id", params.userId)
    .eq("id", params.attachmentId)
    .maybeSingle();
  if (error) throw new Error(`attachment_lookup_failed:${error.message}`);
  if (!attachment) return null;

  const { data: message, error: mErr } = await admin
    .from("messages")
    .select("id,mail_account_id,provider_message_id,user_id")
    .eq("user_id", params.userId)
    .eq("id", attachment.message_id)
    .maybeSingle();
  if (mErr) throw new Error(`attachment_message_failed:${mErr.message}`);
  if (!message) return null;

  return { attachment, message };
}

export async function downloadOwnedAttachment(params: {
  userId: string;
  attachmentId: string;
}): Promise<Response> {
  const owned = await getOwnedAttachment(params);
  if (!owned) {
    return new Response(null, { status: 404, headers: PRIVATE_NO_STORE });
  }

  const admin = createAdminClient();
  const { data: grantId, error: gErr } = await admin.rpc(
    "get_mail_account_grant",
    { p_mail_account_id: owned.message.mail_account_id },
  );
  if (gErr || typeof grantId !== "string" || !grantId) {
    return new Response(null, { status: 404, headers: PRIVATE_NO_STORE });
  }

  const nylas = getNylasClient();
  try {
    const bytes = await nylas.attachments.downloadBytes({
      identifier: grantId,
      attachmentId: owned.attachment.provider_attachment_id as string,
      queryParams: {
        messageId: owned.message.provider_message_id as string,
      },
    });

    const filename = owned.attachment.filename || "attachment";
    const mime =
      (owned.attachment.mime_type as string | null) ||
      "application/octet-stream";
    const disposition = owned.attachment.is_inline
      ? "inline"
      : `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;

    const payload =
      typeof bytes === "string"
        ? new TextEncoder().encode(bytes)
        : bytes instanceof ArrayBuffer
          ? new Uint8Array(bytes)
          : new Uint8Array(bytes as ArrayLike<number>);

    return new Response(payload, {
      status: 200,
      headers: {
        ...PRIVATE_NO_STORE,
        "Content-Type": mime,
        "Content-Disposition": disposition,
      },
    });
  } catch {
    return new Response(null, { status: 502, headers: PRIVATE_NO_STORE });
  }
}
