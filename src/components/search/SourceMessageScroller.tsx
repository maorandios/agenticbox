"use client";

import { useEffect } from "react";

/** Scrolls to ?message= on Source Viewer when present. */
export function SourceMessageScroller({ messageId }: { messageId?: string }) {
  useEffect(() => {
    if (!messageId) return;
    const el = document.getElementById(`message-${messageId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [messageId]);
  return null;
}
