"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { MailAccountDto } from "@/types/mail-account";
import { isMockEmailDataSource } from "@/lib/email-data-source/mode";

type LoadState = "loading" | "ready" | "unauthorized" | "error";

function statusLabel(status: MailAccountDto["syncStatus"]) {
  switch (status) {
    case "ready":
      return "הושלם";
    case "pending":
      return "ממתין לסנכרון";
    case "syncing":
      return "מסנכרן";
    case "needs_reconnect":
      return "נדרש חיבור מחדש";
    case "error":
      return "נכשל";
    case "disconnected":
      return "מנותק";
    default:
      return status;
  }
}

/** Maps terminal sync status to the Settings action banner (or null). */
export function syncTerminalBanner(
  status: MailAccountDto["syncStatus"],
): string | null {
  if (status === "ready") return "הסנכרון הושלם.";
  if (status === "error") return "הסנכרון נכשל. ניתן לנסות שוב.";
  return null;
}

export const ACTION_BANNER_AUTO_DISMISS_MS = 5000;

function reasonMessage(reason: string | null) {
  switch (reason) {
    case "state_expired":
      return "פג תוקף לקישור ההתחברות. נסו שוב.";
    case "state_used":
      return "קישור ההתחברות כבר נוצל. נסו שוב.";
    case "state_user_mismatch":
    case "session":
      return "ההתחברות נדחתה: אין התאמה למשתמש המחובר.";
    case "state_invalid":
      return "בקשת ההתחברות אינה תקפה.";
    case "nylas_config":
      return "Nylas אינו מוגדר בשרת.";
    case "exchange_failed":
      return "החלפת הקוד מול Nylas נכשלה.";
    case "missing_code":
      return "חסר קוד אימות מהספק.";
    default:
      return reason ? `שגיאה: ${reason}` : "אירעה שגיאה בחיבור המייל.";
  }
}

export function MailAccountSettings() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [account, setAccount] = useState<MailAccountDto | null>(null);
  const [backfillMaxThreads, setBackfillMaxThreads] = useState(100);
  const [busy, setBusy] = useState(false);
  const [actionBanner, setActionBanner] = useState<string | null>(null);
  const mockMode = isMockEmailDataSource();

  const mailParam = searchParams.get("mail");
  const reasonParam = searchParams.get("reason");
  const urlBanner =
    mailParam === "connected"
      ? "חשבון Gmail חובר בהצלחה. ניתן להתחיל סנכרון."
      : mailParam === "error"
        ? reasonMessage(reasonParam)
        : null;
  const banner = actionBanner ?? urlBanner;

  const showActionBanner = useCallback((message: string) => {
    setActionBanner(message);
  }, []);

  // actionBanner is session-only React state — never restored after refresh.
  useEffect(() => {
    if (!actionBanner) return;
    const id = window.setTimeout(() => {
      setActionBanner(null);
    }, ACTION_BANNER_AUTO_DISMISS_MS);
    return () => {
      window.clearTimeout(id);
    };
  }, [actionBanner]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/mail/account", { cache: "no-store" });
      if (res.status === 401) {
        setAccount(null);
        setLoadState("unauthorized");
        return;
      }
      if (!res.ok) {
        setLoadState("error");
        return;
      }
      const data = (await res.json()) as {
        account: MailAccountDto | null;
        backfillMaxThreads?: number;
      };
      setAccount(data.account);
      if (
        typeof data.backfillMaxThreads === "number" &&
        data.backfillMaxThreads > 0
      ) {
        setBackfillMaxThreads(data.backfillMaxThreads);
      }
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      void refresh();
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  // Poll + process queue while syncing (no cron in Phase 2B).
  useEffect(() => {
    if (account?.syncStatus !== "syncing") return;
    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch("/api/mail/sync/process", { method: "POST" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { account: MailAccountDto | null };
        if (cancelled || !data.account) return;
        setAccount(data.account);
        const terminal = syncTerminalBanner(data.account.syncStatus);
        if (terminal) showActionBanner(terminal);
      } catch {
        // ignore transient tick errors
      }
    };

    void tick();
    const id = window.setInterval(() => {
      void tick();
    }, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [account?.syncStatus, showActionBanner]);

  async function onDisconnect() {
    setBusy(true);
    setActionBanner(null);
    try {
      const res = await fetch("/api/mail/disconnect", { method: "POST" });
      if (!res.ok) {
        showActionBanner("ניתוק החשבון נכשל.");
        return;
      }
      setAccount(null);
      showActionBanner("החשבון נותק וההרשאה בוטלה. הנתונים הישנים נשמרו ולא יוצגו.");
    } catch {
      showActionBanner("ניתוק החשבון נכשל.");
    } finally {
      setBusy(false);
    }
  }

  async function onStartSync() {
    setBusy(true);
    setActionBanner(null);
    try {
      const res = await fetch("/api/mail/sync/start", { method: "POST" });
      if (!res.ok) {
        showActionBanner("התחלת הסנכרון נכשלה.");
        return;
      }
      const data = (await res.json()) as { account: MailAccountDto };
      setAccount(data.account);
      showActionBanner("הסנכרון התחיל.");
    } catch {
      showActionBanner("התחלת הסנכרון נכשלה.");
    } finally {
      setBusy(false);
    }
  }

  async function onRetrySync() {
    setBusy(true);
    setActionBanner(null);
    try {
      const res = await fetch("/api/mail/sync/retry", { method: "POST" });
      if (!res.ok) {
        showActionBanner("ניסיון הסנכרון נכשל.");
        return;
      }
      const data = (await res.json()) as { account: MailAccountDto };
      setAccount(data.account);
      showActionBanner("ממשיכים מה-checkpoint.");
    } catch {
      showActionBanner("ניסיון הסנכרון נכשל.");
    } finally {
      setBusy(false);
    }
  }

  const linked = Boolean(account) && account!.syncStatus !== "disconnected";
  const needsReconnect = account?.syncStatus === "needs_reconnect";

  return (
    <section className="mx-auto w-full max-w-lg rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-6 text-start">
      <h2 className="text-[16px] font-semibold text-[var(--text-primary)]">
        חשבון מייל
      </h2>
      <p className="mt-1 text-[13px] leading-5 text-[var(--text-secondary)]">
        חיבור Gmail לקריאה בלבד וסנכרון ל-Database. התיבה הראשית עדיין במצב Mock.
      </p>

      {mockMode ? (
        <p className="mt-3 text-[12px] text-[var(--text-secondary)]">
          Mock Mode פעיל ל-Inbox. הסנכרון שומר ל-Supabase בלבד.
        </p>
      ) : null}

      {banner ? (
        <p
          className="mt-4 rounded-[12px] border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-[13px] text-[var(--text-primary)]"
          role="status"
        >
          {banner}
        </p>
      ) : null}

      {loadState === "loading" ? (
        <p className="mt-6 text-[14px] text-[var(--text-secondary)]">טוען…</p>
      ) : null}

      {loadState === "unauthorized" ? (
        <div className="mt-6 space-y-3">
          <p className="text-[14px] text-[var(--text-secondary)]">
            יש להתחבר למשתמש הפנימי לפני חיבור Gmail.
          </p>
          <button
            type="button"
            onClick={() => router.push("/login?next=/settings")}
            className="rounded-[12px] bg-[var(--action-primary)] px-4 py-2.5 text-[14px] font-medium text-[var(--action-on-primary)]"
          >
            התחברות
          </button>
        </div>
      ) : null}

      {loadState === "error" ? (
        <p className="mt-6 text-[14px] text-[var(--text-primary)]">
          לא ניתן לטעון את מצב החשבון.
        </p>
      ) : null}

      {loadState === "ready" ? (
        <div className="mt-6 space-y-4">
          {linked && account ? (
            <div className="rounded-[12px] border border-[var(--border)] px-3 py-3 space-y-1">
              <div className="text-[14px] font-medium text-[var(--text-primary)]">
                מחובר
              </div>
              <div className="text-[14px] text-[var(--text-primary)]">
                <bdi>{account.email}</bdi>
              </div>
              <div className="text-[13px] text-[var(--text-secondary)]">
                עד {backfillMaxThreads} השרשורים האחרונים
              </div>
              <div className="text-[13px] text-[var(--text-secondary)]">
                סנכרון: {statusLabel(account.syncStatus)}
              </div>
              {account.syncStatus === "syncing" ? (
                <div className="text-[13px] text-[var(--text-secondary)]">
                  מסנכרן את החשבון העסקי
                  <br />
                  {account.threadCountSynced} מתוך עד {backfillMaxThreads} שרשורים
                </div>
              ) : null}
              {account.syncStatus === "ready" ? (
                <div className="text-[13px] text-[var(--text-secondary)]">
                  הסנכרון הושלם
                  <br />
                  {account.threadCountSynced} שרשורים · {account.messageCountSynced}{" "}
                  הודעות
                </div>
              ) : null}
              {account.syncStatus !== "syncing" &&
              account.syncStatus !== "ready" ? (
                <div className="text-[13px] text-[var(--text-secondary)]">
                  שרשורים: {account.threadCountSynced} · הודעות:{" "}
                  {account.messageCountSynced}
                </div>
              ) : null}
              {account.errorMessageSafe ? (
                <div className="text-[12px] text-[var(--text-secondary)]">
                  {account.errorMessageSafe}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-[14px] text-[var(--text-secondary)]">
              אין חשבון מייל מחובר
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {!linked || needsReconnect ? (
              <a
                href="/api/mail/connect"
                className="inline-flex rounded-[12px] bg-[var(--action-primary)] px-4 py-2.5 text-[14px] font-medium text-[var(--action-on-primary)]"
              >
                חבר חשבון Gmail
              </a>
            ) : null}

            {account?.syncStatus === "pending" ||
            account?.syncStatus === "ready" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void onStartSync()}
                className="rounded-[12px] border border-[var(--border)] px-4 py-2.5 text-[14px] text-[var(--text-primary)] disabled:opacity-60"
              >
                {account.syncStatus === "ready" ? "סנכרון מחדש" : "התחל סנכרון"}
              </button>
            ) : null}

            {account?.syncStatus === "error" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void onRetrySync()}
                className="rounded-[12px] bg-[var(--action-primary)] px-4 py-2.5 text-[14px] font-medium text-[var(--action-on-primary)] disabled:opacity-60"
              >
                Retry סנכרון
              </button>
            ) : null}

            {linked ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void onDisconnect()}
                className="rounded-[12px] border border-[var(--border)] px-4 py-2.5 text-[14px] text-[var(--text-primary)] disabled:opacity-60"
              >
                {busy ? "מנתק…" : "נתק חשבון"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
