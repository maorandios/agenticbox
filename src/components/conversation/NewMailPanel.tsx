"use client";

import * as React from "react";
import { toast } from "sonner";
import { Composer } from "@/components/conversation/Composer";
import { useWorkspace } from "@/state/workspace";

/** New-mail surface — reuses Composer in forward mode (empty To / Cc / Bcc). */
export function NewMailPanel() {
  const { state, dispatch } = useWorkspace();
  const booted = React.useRef(false);

  React.useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    if (!state.composer.composeNew) {
      dispatch({ type: "START_COMPOSE_NEW" });
    }
    dispatch({ type: "SAVE_DRAFT" });
  }, [dispatch, state.composer.composeNew]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="border-b border-[var(--border)] px-8 py-4">
        <h2 className="text-[16px] font-semibold tracking-tight text-[var(--text-primary)]">
          מייל חדש
        </h2>
        <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
          טיוטה נשמרת אוטומטית בתיקיית טיוטות
        </p>
      </div>
      <div className="min-h-0 flex-1" />
      <Composer
        threadId="thr-compose-new"
        onSend={async () => {
          toast.success("ההודעה נשלחה (מדומה)");
          dispatch({ type: "CLEAR_COMPOSE_NEW" });
        }}
      />
    </div>
  );
}
